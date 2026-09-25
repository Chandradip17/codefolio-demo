-- Hackathon teams: apply solo, create a team (get a unique code) or join one by code.
--   * Each member still sends their own application (booking, 1 seat each).
--   * Solo is refused when the hackathon's minimum team size is above 1;
--     teams are refused when the maximum is 1. Team size never exceeds the maximum.
--   * Leaving (withdraw / rejected / removed) frees the slot; an empty team is deleted,
--     and if the leader leaves the longest-standing member becomes leader.
-- Hackathons without team settings behave as teams of 1–4.

create table if not exists public.teams (
  id          uuid primary key default gen_random_uuid(),
  event_id    text not null references public.events (id) on delete cascade,
  name        text not null check (char_length(btrim(name)) between 2 and 60),
  code        text not null unique,
  leader_id   uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);
create unique index if not exists teams_event_name_key on public.teams (event_id, lower(btrim(name)));
alter table public.teams enable row level security;

alter table public.bookings
  add column if not exists participation text check (participation in ('solo', 'team')),
  add column if not exists team_id uuid references public.teams (id) on delete set null;

create table if not exists public.team_members (
  team_id     uuid not null references public.teams (id) on delete cascade,
  event_id    text not null references public.events (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  booking_id  uuid not null unique references public.bookings (id) on delete cascade,
  joined_at   timestamptz not null default now(),
  primary key (team_id, user_id),
  unique (event_id, user_id)
);
create index if not exists team_members_team_idx on public.team_members (team_id);
alter table public.team_members enable row level security;

-- 6-character code from an unambiguous alphabet (no 0/O, 1/I/L).
create or replace function public.cf_team_code()
returns text language plpgsql volatile set search_path = public as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  bytes bytea;
  v_code text;
begin
  loop
    bytes := decode(replace(gen_random_uuid()::text, '-', ''), 'hex');
    v_code := '';
    for i in 0..5 loop
      v_code := v_code || substr(alphabet, 1 + (get_byte(bytes, i) % 31), 1);
    end loop;
    exit when not exists (select 1 from public.teams t where t.code = v_code);
  end loop;
  return v_code;
end;
$$;

-- request_booking gains participation (solo | team_create | team_join) + team name / code.
drop function if exists public.request_booking(uuid, text, integer, jsonb, integer);
create or replace function public.request_booking(
  p_user uuid, p_event text, p_seats integer, p_answers jsonb, p_form_version integer,
  p_participation text default null, p_team_name text default null, p_team_code text default null
)
returns public.bookings language plpgsql security definer set search_path = public as $$
declare
  ev public.events; who public.profiles; b public.bookings; q jsonb;
  t public.teams; tmin int; tmax int; n int; clean_code text; clean_name text;
  is_hack boolean;
begin
  select * into who from public.profiles where id = p_user;
  if not found then perform public.cf_raise('auth/missing', 'Account not found.'); end if;

  select * into ev from public.events where id = p_event;
  if not found or ev.status = 'Draft' then perform public.cf_raise('event/missing', 'This event no longer exists.'); end if;
  is_hack := ev.category = 'hackathon';
  -- Hackathon participants apply one person at a time.
  if is_hack then p_seats := 1; end if;
  if p_seats is null or p_seats < 1 or p_seats > 4 then perform public.cf_raise('booking/seats', 'You can request between 1 and 4 seats.'); end if;

  if ev.created_by = p_user then perform public.cf_raise('booking/own', 'You can’t book your own event.'); end if;
  if ev.status = 'Cancelled' then perform public.cf_raise('event/cancelled', 'This event has been cancelled.'); end if;
  if coalesce(ev.end_date, ev.date) < current_date then perform public.cf_raise('event/past', 'This event has already happened.'); end if;
  if ev.applications_open_at is not null and now() < ev.applications_open_at then
    perform public.cf_raise('event/not_open', format('Applications open on %s.',
      to_char(ev.applications_open_at at time zone 'Asia/Kolkata', 'DD Mon YYYY, HH12:MI AM')));
  end if;
  if ev.applications_close_at is not null and now() > ev.applications_close_at then
    perform public.cf_raise('event/closed', 'Applications for this event have closed.');
  end if;
  if ev.applications_close_at is null and ev.registration_deadline is not null and ev.registration_deadline < current_date then
    perform public.cf_raise('event/closed', 'Registration for this event has closed.');
  end if;
  if exists (select 1 from public.bookings where user_id = p_user and event_id = p_event and status in ('Pending', 'Confirmed', 'Attended')) then
    perform public.cf_raise('booking/duplicate', 'You already have a request or seat for this event.');
  end if;
  if ev.available_seats <= 0 then perform public.cf_raise('booking/soldout', 'Sorry, this event is full.'); end if;
  if p_seats > ev.available_seats then perform public.cf_raise('booking/insufficient', format('Only %s seat(s) left.', ev.available_seats)); end if;

  -- ---- participation (hackathons only) ----
  if is_hack then
    tmin := coalesce(ev.team_min, 1);
    tmax := coalesce(ev.team_max, 4);
    if p_participation is null or p_participation not in ('solo', 'team_create', 'team_join') then
      perform public.cf_raise('team/choice', 'Choose how you’re taking part: solo, create a team or join a team.');
    end if;
    if p_participation = 'solo' and tmin > 1 then
      perform public.cf_raise('team/solo_disabled', format('Solo participation isn’t allowed: teams need at least %s members.', tmin));
    end if;
    if p_participation <> 'solo' and tmax < 2 then
      perform public.cf_raise('team/solo_only', 'This hackathon is solo only.');
    end if;
    if exists (select 1 from public.team_members where event_id = p_event and user_id = p_user) then
      perform public.cf_raise('team/already', 'You’re already in a team for this hackathon.');
    end if;

    if p_participation = 'team_create' then
      clean_name := regexp_replace(btrim(coalesce(p_team_name, '')), '\s+', ' ', 'g');
      if char_length(clean_name) < 2 or char_length(clean_name) > 60 then
        perform public.cf_raise('team/name', 'Team name must be 2–60 characters.');
      end if;
      if exists (select 1 from public.teams where event_id = p_event and lower(btrim(name)) = lower(clean_name)) then
        perform public.cf_raise('team/name_taken', 'That team name is already taken for this hackathon.');
      end if;
      insert into public.teams (event_id, name, code, leader_id)
      values (p_event, clean_name, public.cf_team_code(), p_user)
      returning * into t;
    elsif p_participation = 'team_join' then
      clean_code := upper(regexp_replace(coalesce(p_team_code, ''), '[^A-Za-z0-9]', '', 'g'));
      -- Lock the team so two people can't take its last slot at once.
      select * into t from public.teams where code = clean_code for update;
      if not found then perform public.cf_raise('team/not_found', 'No team found with that code. Check it with your team leader.'); end if;
      if t.event_id <> p_event then perform public.cf_raise('team/wrong_event', 'That team code belongs to a different hackathon.'); end if;
      select count(*) into n from public.team_members where team_id = t.id;
      if n >= tmax then perform public.cf_raise('team/full', format('%s is full (%s of %s members).', t.name, n, tmax)); end if;
    end if;
  end if;

  insert into public.bookings (booking_id, user_id, event_id, seats, status, attendee_name, attendee_email, event_snapshot, participation, team_id)
  values (public.cf_booking_code(), p_user, p_event, p_seats, 'Pending', who.name, who.email, public.cf_event_snapshot(ev),
          case when not is_hack then null when p_participation = 'solo' then 'solo' else 'team' end,
          t.id)
  returning * into b;

  if t.id is not null then
    insert into public.team_members (team_id, event_id, user_id, booking_id) values (t.id, p_event, p_user, b.id);
  end if;

  if p_answers is not null and jsonb_typeof(p_answers) = 'object' then
    for q in select jsonb_build_object('k', key, 'v', value) from jsonb_each(p_answers) loop
      insert into public.booking_answers (booking_id, question_id, answer, form_version)
      values (b.id, q ->> 'k', q -> 'v', coalesce(p_form_version, 1));
    end loop;
  end if;
  return b;
end;
$$;

-- Leaving a team: withdrawn, rejected or removed applications give up their slot.
create or replace function public.cf_team_on_booking_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare t public.teams; next_leader uuid;
begin
  if new.team_id is null or new.status is not distinct from old.status or new.status not in ('Cancelled', 'Rejected', 'Removed') then
    return new;
  end if;
  delete from public.team_members where booking_id = new.id;
  select * into t from public.teams where id = new.team_id for update;
  if found then
    if not exists (select 1 from public.team_members where team_id = t.id) then
      delete from public.teams where id = t.id;
    elsif t.leader_id = new.user_id then
      select user_id into next_leader from public.team_members where team_id = t.id order by joined_at limit 1;
      update public.teams set leader_id = next_leader where id = t.id;
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists bookings_team_leave on public.bookings;
create trigger bookings_team_leave after update of status on public.bookings
  for each row execute function public.cf_team_on_booking_change();

revoke all on function public.cf_team_code() from public, anon, authenticated;
revoke all on function public.cf_team_on_booking_change() from public, anon, authenticated;
revoke all on function public.request_booking(uuid, text, integer, jsonb, integer, text, text, text) from public, anon, authenticated;
grant execute on function public.request_booking(uuid, text, integer, jsonb, integer, text, text, text) to service_role;
revoke all on public.teams, public.team_members from anon, authenticated;
