-- Participant Chat (two-way, participant ↔ participant). Separate from the
-- Communication Center's announcements (one-way, organizer → audience).
--
-- Same security model as the rest of Codefolio: RLS on, no policies, no browser
-- privileges. The API (service role) calls the SECURITY DEFINER functions below,
-- which hold every rule: membership, room state, mutes, cooldown, burst limit,
-- duplicate check, reporting and moderation. Nothing existing is changed.

create table if not exists public.chat_rooms (
  id          uuid primary key default gen_random_uuid(),
  event_id    text not null references public.events (id) on delete cascade,
  room_type   text not null default 'participants' check (room_type in ('participants')),
  name        text not null default 'Participant chat' check (char_length(name) between 1 and 80),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (event_id, room_type)
);
alter table public.chat_rooms enable row level security;

create table if not exists public.chat_messages (
  id          uuid primary key default gen_random_uuid(),
  room_id     uuid not null references public.chat_rooms (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  message     text not null check (char_length(message) between 1 and 4000),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  deleted_by  uuid references public.profiles (id) on delete set null
);
create index if not exists chat_messages_room_time on public.chat_messages (room_id, created_at desc, id desc);
create index if not exists chat_messages_user_time on public.chat_messages (user_id, room_id, created_at desc);
alter table public.chat_messages enable row level security;

create table if not exists public.chat_message_reports (
  id           uuid primary key default gen_random_uuid(),
  message_id   uuid not null references public.chat_messages (id) on delete cascade,
  reported_by  uuid not null references public.profiles (id) on delete cascade,
  reason       text not null check (reason in ('spam', 'harassment', 'inappropriate', 'off_topic', 'other')),
  details      text not null default '' check (char_length(details) <= 500),
  status       text not null default 'pending' check (status in ('pending', 'reviewed', 'dismissed', 'action_taken')),
  created_at   timestamptz not null default now(),
  reviewed_at  timestamptz,
  reviewed_by  uuid references public.profiles (id) on delete set null,
  unique (message_id, reported_by)
);
create index if not exists chat_reports_status on public.chat_message_reports (status, created_at desc);
alter table public.chat_message_reports enable row level security;

-- Chat-only restriction, scoped to one hackathon (never the member's whole account).
create table if not exists public.chat_mutes (
  event_id     text not null references public.events (id) on delete cascade,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  muted_until  timestamptz not null,
  reason       text not null default '' check (char_length(reason) <= 300),
  muted_by     uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  primary key (event_id, user_id)
);
alter table public.chat_mutes enable row level security;

-- Who is in the chat: participants (applied and not rejected/cancelled — the same
-- definition as the announcement "Participants" audience) and moderators (this
-- hackathon's organizer or a platform admin). Judges are not participants.
create or replace function public.cf_chat_access(p_user uuid, p_event text)
returns table (participant boolean, moderator boolean)
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.bookings b where b.event_id = p_event and b.user_id = p_user and b.status in ('Pending', 'Confirmed', 'Attended')),
         public.cf_can_manage_event(p_user, p_event)
$$;

-- When the hackathon's hacking period is over (IST): end date + end time, or the end of the end date.
create or replace function public.cf_event_ended(ev public.events)
returns boolean language sql stable set search_path = public as $$
  select now() > case
    when ev.end_time is not null then ((coalesce(ev.end_date, ev.date) + ev.end_time) at time zone 'Asia/Kolkata')
    else ((coalesce(ev.end_date, ev.date) + 1)::timestamp at time zone 'Asia/Kolkata')
  end
$$;

-- The room for a hackathon (created on first use) + the caller's standing in it.
create or replace function public.chat_room_for(p_user uuid, p_event text, p_read_only_after_end boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare ev public.events; r public.chat_rooms; acc record; m public.chat_mutes; ended boolean;
begin
  select * into ev from public.events where id = p_event;
  if not found or ev.category <> 'hackathon' or ev.status = 'Draft' then perform public.cf_raise('chat/forbidden', 'Chat not found.'); end if;
  select * into acc from public.cf_chat_access(p_user, p_event);
  if not acc.participant and not acc.moderator then perform public.cf_raise('chat/forbidden', 'Chat not found.'); end if;
  insert into public.chat_rooms (event_id, room_type) values (p_event, 'participants') on conflict (event_id, room_type) do nothing;
  select * into r from public.chat_rooms where event_id = p_event and room_type = 'participants';
  select * into m from public.chat_mutes where event_id = p_event and user_id = p_user and muted_until > now();
  ended := public.cf_event_ended(ev);
  return jsonb_build_object(
    'roomId', r.id, 'name', r.name, 'active', r.is_active,
    'ended', ended, 'readOnly', coalesce(p_read_only_after_end, true) and ended,
    'participant', acc.participant, 'moderator', acc.moderator,
    'mutedUntil', m.muted_until,
    'lastSentAt', (select max(created_at) from public.chat_messages where room_id = r.id and user_id = p_user),
    'serverNow', now()
  );
end;
$$;

-- One message as members see it (content hidden once removed by a moderator).
create or replace function public.cf_chat_message_json(cm public.chat_messages, p_viewer uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', cm.id, 'userId', cm.user_id, 'name', p.name, 'username', p.username, 'avatarUrl', p.avatar_url,
    'message', case when cm.deleted_at is null then cm.message end,
    'deleted', cm.deleted_at is not null, 'createdAt', cm.created_at,
    'reportedByMe', exists (select 1 from public.chat_message_reports x where x.message_id = cm.id and x.reported_by = p_viewer)
  )
  from public.profiles p where p.id = cm.user_id
$$;

-- Send: every limit is enforced here, whatever the browser does. Returns
-- { ok: true, message } or { ok: false, code, message, retryAfter? }.
create or replace function public.send_chat_message(
  p_user uuid, p_event text, p_message text,
  p_cooldown_seconds integer, p_max_per_minute integer, p_max_length integer,
  p_duplicate_window_seconds integer, p_read_only_after_end boolean
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare ev public.events; r public.chat_rooms; acc record; m public.chat_mutes; txt text; last_at timestamptz;
        n integer; oldest timestamptz; wait numeric; cm public.chat_messages; t timestamptz := clock_timestamp();
begin
  select * into ev from public.events where id = p_event;
  if not found or ev.category <> 'hackathon' or ev.status = 'Draft' then
    return jsonb_build_object('ok', false, 'code', 'chat/forbidden', 'message', 'Chat not found.');
  end if;
  select * into acc from public.cf_chat_access(p_user, p_event);
  if not acc.participant then
    return jsonb_build_object('ok', false, 'code', case when acc.moderator then 'chat/not_participant' else 'chat/forbidden' end,
      'message', case when acc.moderator then 'Only participants post in the participant chat. Use announcements to reach them.' else 'Chat not found.' end);
  end if;
  -- Serialise this member's sends in this hackathon so parallel requests can't slip past the limits.
  perform pg_advisory_xact_lock(hashtext('chat:' || p_event || ':' || p_user::text));

  insert into public.chat_rooms (event_id, room_type) values (p_event, 'participants') on conflict (event_id, room_type) do nothing;
  select * into r from public.chat_rooms where event_id = p_event and room_type = 'participants';
  if not r.is_active then return jsonb_build_object('ok', false, 'code', 'chat/closed', 'message', 'Participant chat is currently closed.'); end if;
  if coalesce(p_read_only_after_end, true) and public.cf_event_ended(ev) then
    return jsonb_build_object('ok', false, 'code', 'chat/read_only', 'message', 'This hackathon has ended, so the chat is read-only.');
  end if;
  select * into m from public.chat_mutes where event_id = p_event and user_id = p_user and muted_until > t;
  if found then
    return jsonb_build_object('ok', false, 'code', 'chat/muted', 'message', 'A moderator has paused your chat messages for now.', 'mutedUntil', m.muted_until);
  end if;

  txt := btrim(regexp_replace(coalesce(p_message, ''), '\s+$', ''));
  if txt = '' then return jsonb_build_object('ok', false, 'code', 'chat/empty', 'message', 'Write a message first.'); end if;
  if char_length(txt) > least(greatest(coalesce(p_max_length, 1000), 1), 4000) then
    return jsonb_build_object('ok', false, 'code', 'chat/too_long', 'message', format('Messages can be at most %s characters.', least(greatest(coalesce(p_max_length, 1000), 1), 4000)));
  end if;

  select max(created_at) into last_at from public.chat_messages where room_id = r.id and user_id = p_user;
  if last_at is not null and coalesce(p_cooldown_seconds, 0) > 0 and t < last_at + make_interval(secs => p_cooldown_seconds) then
    wait := ceil(extract(epoch from (last_at + make_interval(secs => p_cooldown_seconds) - t)));
    return jsonb_build_object('ok', false, 'code', 'chat/cooldown', 'retryAfter', greatest(wait, 1),
      'message', format('Please wait %s second%s before sending another message.', greatest(wait, 1), case when greatest(wait, 1) = 1 then '' else 's' end));
  end if;

  if coalesce(p_max_per_minute, 0) > 0 then
    select count(*), min(created_at) into n, oldest from (
      select created_at from public.chat_messages where room_id = r.id and user_id = p_user and created_at > t - interval '1 minute'
       order by created_at desc limit p_max_per_minute) x;
    if n >= p_max_per_minute then
      wait := ceil(extract(epoch from (oldest + interval '1 minute' - t)));
      return jsonb_build_object('ok', false, 'code', 'chat/rate_limited', 'retryAfter', greatest(wait, 1),
        'message', format('You’re sending messages too quickly. Try again in %s second%s.', greatest(wait, 1), case when greatest(wait, 1) = 1 then '' else 's' end));
    end if;
  end if;

  if coalesce(p_duplicate_window_seconds, 0) > 0 and exists (
    select 1 from public.chat_messages where room_id = r.id and user_id = p_user and deleted_at is null
       and lower(message) = lower(txt) and created_at > t - make_interval(secs => p_duplicate_window_seconds)) then
    return jsonb_build_object('ok', false, 'code', 'chat/duplicate', 'message', 'You just sent that same message.');
  end if;

  insert into public.chat_messages (room_id, user_id, message, created_at, updated_at) values (r.id, p_user, txt, t, t) returning * into cm;
  return jsonb_build_object('ok', true, 'message', public.cf_chat_message_json(cm, p_user), 'roomId', r.id);
end;
$$;

-- A page of history, newest first, before an optional cursor message.
create or replace function public.chat_messages_page(p_user uuid, p_event text, p_before uuid, p_limit integer)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare acc record; r public.chat_rooms; cur public.chat_messages; lim integer := least(greatest(coalesce(p_limit, 50), 1), 100); rows jsonb;
begin
  select * into acc from public.cf_chat_access(p_user, p_event);
  if not acc.participant and not acc.moderator then perform public.cf_raise('chat/forbidden', 'Chat not found.'); end if;
  select * into r from public.chat_rooms where event_id = p_event and room_type = 'participants';
  if not found then return jsonb_build_object('messages', '[]'::jsonb, 'hasMore', false); end if;
  if p_before is not null then
    select * into cur from public.chat_messages where id = p_before and room_id = r.id;
    if not found then perform public.cf_raise('chat/cursor', 'That message isn’t in this chat.'); end if;
  end if;
  select coalesce(jsonb_agg(public.cf_chat_message_json(x, p_user) order by x.created_at desc, x.id desc), '[]'::jsonb) into rows
    from (select * from public.chat_messages
           where room_id = r.id and (p_before is null or (created_at, id) < (cur.created_at, cur.id))
           order by created_at desc, id desc limit lim + 1) x;
  return jsonb_build_object(
    'messages', (select coalesce(jsonb_agg(e order by i), '[]'::jsonb) from jsonb_array_elements(rows) with ordinality a(e, i) where i <= lim),
    'hasMore', jsonb_array_length(rows) > lim
  );
end;
$$;

-- Members who should receive live chat updates for a hackathon.
create or replace function public.chat_audience(p_event text)
returns setof uuid language sql stable security definer set search_path = public as $$
  select distinct u from (
    select b.user_id u from public.bookings b where b.event_id = p_event and b.status in ('Pending', 'Confirmed', 'Attended')
    union all select created_by from public.events where id = p_event
    union all select id from public.profiles where platform_role = 'admin'
  ) x where u is not null
$$;

create or replace function public.report_chat_message(p_user uuid, p_message uuid, p_reason text, p_details text)
returns public.chat_message_reports language plpgsql security definer set search_path = public as $$
declare cm public.chat_messages; r public.chat_rooms; acc record; rep public.chat_message_reports;
begin
  select * into cm from public.chat_messages where id = p_message;
  if not found then perform public.cf_raise('chat/missing', 'Message not found.'); end if;
  select * into r from public.chat_rooms where id = cm.room_id;
  select * into acc from public.cf_chat_access(p_user, r.event_id);
  if not acc.participant then perform public.cf_raise('chat/missing', 'Message not found.'); end if;
  if cm.user_id = p_user then perform public.cf_raise('chat/own_message', 'You can’t report your own message.'); end if;
  if cm.deleted_at is not null then perform public.cf_raise('chat/already_removed', 'A moderator has already removed this message.'); end if;
  insert into public.chat_message_reports (message_id, reported_by, reason, details)
  values (p_message, p_user, coalesce(p_reason, 'other'), left(btrim(coalesce(p_details, '')), 500))
  on conflict (message_id, reported_by) do nothing
  returning * into rep;
  if rep.id is null then perform public.cf_raise('chat/already_reported', 'You’ve already reported this message.'); end if;
  return rep;
end;
$$;

-- Moderator overview: room state, reports (with the reported content, even if removed), active mutes.
create or replace function public.chat_moderation(p_actor uuid, p_event text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r public.chat_rooms;
begin
  if not public.cf_can_manage_event(p_actor, p_event) then perform public.cf_raise('auth/forbidden', 'Only this hackathon’s organizer can moderate its chat.'); end if;
  select * into r from public.chat_rooms where event_id = p_event and room_type = 'participants';
  return jsonb_build_object(
    'room', case when r.id is null then null else jsonb_build_object('id', r.id, 'active', r.is_active) end,
    'messages', (select count(*) from public.chat_messages where room_id = r.id),
    'reports', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', rep.id, 'reason', rep.reason, 'details', rep.details, 'status', rep.status, 'createdAt', rep.created_at, 'reviewedAt', rep.reviewed_at,
        'reporter', jsonb_build_object('id', rp.id, 'name', rp.name, 'username', rp.username),
        'message', jsonb_build_object('id', cm.id, 'text', cm.message, 'createdAt', cm.created_at, 'deleted', cm.deleted_at is not null,
          'author', jsonb_build_object('id', ap.id, 'name', ap.name, 'username', ap.username)),
        'reportsOnMessage', (select count(*) from public.chat_message_reports z where z.message_id = cm.id)
      ) order by (rep.status = 'pending') desc, rep.created_at desc)
      from public.chat_message_reports rep
      join public.chat_messages cm on cm.id = rep.message_id and cm.room_id = r.id
      join public.profiles rp on rp.id = rep.reported_by
      join public.profiles ap on ap.id = cm.user_id
    ), '[]'::jsonb),
    'mutes', coalesce((
      select jsonb_agg(jsonb_build_object('userId', mu.user_id, 'name', p.name, 'username', p.username, 'mutedUntil', mu.muted_until, 'reason', mu.reason) order by mu.muted_until)
        from public.chat_mutes mu join public.profiles p on p.id = mu.user_id
       where mu.event_id = p_event and mu.muted_until > now()
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.chat_delete_message(p_actor uuid, p_message uuid)
returns public.chat_messages language plpgsql security definer set search_path = public as $$
declare cm public.chat_messages; r public.chat_rooms;
begin
  select * into cm from public.chat_messages where id = p_message for update;
  if not found then perform public.cf_raise('chat/missing', 'Message not found.'); end if;
  select * into r from public.chat_rooms where id = cm.room_id;
  if not public.cf_can_manage_event(p_actor, r.event_id) then perform public.cf_raise('auth/forbidden', 'Only this hackathon’s organizer can remove messages.'); end if;
  update public.chat_messages set deleted_at = coalesce(deleted_at, now()), deleted_by = coalesce(deleted_by, p_actor), updated_at = now()
   where id = p_message returning * into cm;
  update public.chat_message_reports set status = 'action_taken', reviewed_at = now(), reviewed_by = p_actor
   where message_id = p_message and status = 'pending';
  return cm;
end;
$$;

create or replace function public.chat_review_report(p_actor uuid, p_report uuid, p_status text)
returns public.chat_message_reports language plpgsql security definer set search_path = public as $$
declare rep public.chat_message_reports; ev text;
begin
  select * into rep from public.chat_message_reports where id = p_report for update;
  if not found then perform public.cf_raise('chat/report_missing', 'Report not found.'); end if;
  select r.event_id into ev from public.chat_messages cm join public.chat_rooms r on r.id = cm.room_id where cm.id = rep.message_id;
  if not public.cf_can_manage_event(p_actor, ev) then perform public.cf_raise('auth/forbidden', 'Only this hackathon’s organizer can review reports.'); end if;
  if p_status not in ('reviewed', 'dismissed', 'action_taken') then perform public.cf_raise('chat/status', 'Unknown report status.'); end if;
  update public.chat_message_reports set status = p_status, reviewed_at = now(), reviewed_by = p_actor where id = p_report returning * into rep;
  return rep;
end;
$$;

create or replace function public.chat_mute_user(p_actor uuid, p_event text, p_user uuid, p_until timestamptz, p_reason text)
returns public.chat_mutes language plpgsql security definer set search_path = public as $$
declare mu public.chat_mutes;
begin
  if not public.cf_can_manage_event(p_actor, p_event) then perform public.cf_raise('auth/forbidden', 'Only this hackathon’s organizer can mute chat members.'); end if;
  if p_user = p_actor then perform public.cf_raise('chat/self', 'You can’t mute yourself.'); end if;
  if not exists (select 1 from public.bookings where event_id = p_event and user_id = p_user) then
    perform public.cf_raise('chat/not_member', 'That person isn’t a participant in this hackathon.');
  end if;
  if p_until is null or p_until <= now() or p_until > now() + interval '30 days' then
    perform public.cf_raise('chat/mute_until', 'Choose a mute length between a few minutes and 30 days.');
  end if;
  insert into public.chat_mutes (event_id, user_id, muted_until, reason, muted_by)
  values (p_event, p_user, p_until, left(btrim(coalesce(p_reason, '')), 300), p_actor)
  on conflict (event_id, user_id) do update set muted_until = excluded.muted_until, reason = excluded.reason, muted_by = excluded.muted_by, created_at = now()
  returning * into mu;
  return mu;
end;
$$;

create or replace function public.chat_unmute_user(p_actor uuid, p_event text, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.cf_can_manage_event(p_actor, p_event) then perform public.cf_raise('auth/forbidden', 'Only this hackathon’s organizer can unmute chat members.'); end if;
  delete from public.chat_mutes where event_id = p_event and user_id = p_user;
end;
$$;

create or replace function public.chat_set_room_active(p_actor uuid, p_event text, p_active boolean)
returns public.chat_rooms language plpgsql security definer set search_path = public as $$
declare r public.chat_rooms;
begin
  if not public.cf_can_manage_event(p_actor, p_event) then perform public.cf_raise('auth/forbidden', 'Only this hackathon’s organizer can open or close the chat.'); end if;
  insert into public.chat_rooms (event_id, room_type) values (p_event, 'participants') on conflict (event_id, room_type) do nothing;
  update public.chat_rooms set is_active = coalesce(p_active, true), updated_at = now()
   where event_id = p_event and room_type = 'participants' returning * into r;
  return r;
end;
$$;

revoke all on public.chat_rooms, public.chat_messages, public.chat_message_reports, public.chat_mutes from anon, authenticated;

do $$
declare f text;
begin
  foreach f in array array[
    'public.cf_chat_access(uuid, text)', 'public.cf_event_ended(public.events)',
    'public.chat_room_for(uuid, text, boolean)', 'public.cf_chat_message_json(public.chat_messages, uuid)',
    'public.send_chat_message(uuid, text, text, integer, integer, integer, integer, boolean)',
    'public.chat_messages_page(uuid, text, uuid, integer)', 'public.chat_audience(text)',
    'public.report_chat_message(uuid, uuid, text, text)', 'public.chat_moderation(uuid, text)',
    'public.chat_delete_message(uuid, uuid)', 'public.chat_review_report(uuid, uuid, text)',
    'public.chat_mute_user(uuid, text, uuid, timestamptz, text)', 'public.chat_unmute_user(uuid, text, uuid)',
    'public.chat_set_room_active(uuid, text, boolean)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
