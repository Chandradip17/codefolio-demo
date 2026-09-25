-- =====================================================================
-- Host approval · booking approval (applications) · form builder · QR check-in
-- Additive; existing rows keep their meaning. Idempotent.
--
-- All tables here are server-only (RLS on, no policies): the API calls these
-- functions with the service role and passes the verified user id. Every rule
-- (ownership, status transitions, seats, one-time check-in) lives in SQL so it
-- holds no matter which client calls it.
-- =====================================================================

-- ---------- bookings become applications ----------
-- Pending → (host) Confirmed | Rejected;  Confirmed → Removed (host) | Cancelled (attendee) | Attended (check-in)
alter table public.bookings drop constraint if exists bookings_status_check;
alter table public.bookings add constraint bookings_status_check
  check (status in ('Pending', 'Confirmed', 'Rejected', 'Removed', 'Cancelled', 'Attended'));
alter table public.bookings
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by uuid references public.profiles (id) on delete set null,
  add column if not exists review_note text;

-- One live application per member per event (pending, approved or attended).
drop index if exists public.bookings_one_active_per_user;
create unique index if not exists bookings_one_live_per_user
  on public.bookings (user_id, event_id) where status in ('Pending', 'Confirmed', 'Attended');
create index if not exists bookings_status_idx on public.bookings (event_id, status);

-- ---------- host requests ----------
create table if not exists public.host_requests (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles (id) on delete cascade,
  requested_type  text not null check (requested_type in ('event', 'hackathon', 'both')),
  organization    text not null check (char_length(organization) between 2 and 120),
  city            text not null default '',
  reason          text not null check (char_length(reason) between 20 and 1000),
  status          text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  review_note     text,
  reviewed_by     uuid references public.profiles (id) on delete set null,
  reviewed_at     timestamptz,
  created_at      timestamptz not null default now()
);
create unique index if not exists host_requests_one_pending on public.host_requests (user_id) where status = 'pending';
create index if not exists host_requests_status_idx on public.host_requests (status, created_at desc);
alter table public.host_requests enable row level security;

-- ---------- application forms (structured, versioned) + answers ----------
-- schema = { "questions": [ { "id", "type", "label", "required", "options"?, "help"? } ] }
create table if not exists public.event_forms (
  event_id    text primary key references public.events (id) on delete cascade,
  version     integer not null default 1,
  schema      jsonb not null,
  updated_at  timestamptz not null default now(),
  constraint schema_has_questions check (jsonb_typeof(schema -> 'questions') = 'array')
);
alter table public.event_forms enable row level security;

create table if not exists public.booking_answers (
  id           uuid primary key default gen_random_uuid(),
  booking_id   uuid not null references public.bookings (id) on delete cascade,
  question_id  text not null,
  answer       jsonb not null,
  form_version integer not null default 1,
  unique (booking_id, question_id)
);
alter table public.booking_answers enable row level security;

-- ---------- QR credentials + attendance ----------
create table if not exists public.check_in_tokens (
  id            uuid primary key default gen_random_uuid(),
  booking_id    uuid not null references public.bookings (id) on delete cascade,
  token         text not null unique,      -- 64 hex chars from two v4 UUIDs (~244 random bits); goes in the QR
  manual_code   text not null unique,      -- 10 chars (~50 bits) for "Enter code manually"
  status        text not null default 'active' check (status in ('active', 'revoked')),
  generated_at  timestamptz not null default now(),
  revoked_at    timestamptz
);
create unique index if not exists check_in_tokens_one_active on public.check_in_tokens (booking_id) where status = 'active';
alter table public.check_in_tokens enable row level security;

create table if not exists public.attendance (
  id             uuid primary key default gen_random_uuid(),
  booking_id     uuid not null unique references public.bookings (id) on delete cascade, -- attendance happens once
  event_id       text references public.events (id) on delete set null,
  token_id       uuid references public.check_in_tokens (id) on delete set null,
  checked_in_at  timestamptz not null default now(),
  checked_in_by  uuid references public.profiles (id) on delete set null
);
create index if not exists attendance_event_idx on public.attendance (event_id, checked_in_at desc);
alter table public.attendance enable row level security;

-- ---------- helpers ----------
-- Secure random material without pgcrypto: gen_random_uuid() uses the strong RNG.
create or replace function public.cf_random_hex()
returns text language sql volatile set search_path = public as $$
  select replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
$$;

create or replace function public.cf_manual_code()
returns text language plpgsql volatile set search_path = public as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  bytes bytea;
  code text;
begin
  loop
    bytes := decode(replace(gen_random_uuid()::text, '-', ''), 'hex');
    code := '';
    for i in 0..9 loop
      code := code || substr(alphabet, 1 + (get_byte(bytes, i) % 32), 1);
    end loop;
    exit when not exists (select 1 from public.check_in_tokens where manual_code = code);
  end loop;
  return code;
end;
$$;

create or replace function public.cf_is_admin(p_user uuid)
returns boolean language sql stable set search_path = public as $$
  select exists (select 1 from public.profiles where id = p_user and platform_role = 'admin');
$$;

-- Host of an event = its creator (co-hosts come later) or a platform admin.
create or replace function public.cf_can_manage_event(p_user uuid, p_event text)
returns boolean language sql stable set search_path = public as $$
  select exists (select 1 from public.events where id = p_event and created_by = p_user) or public.cf_is_admin(p_user);
$$;

create or replace function public.cf_issue_token(p_booking uuid)
returns public.check_in_tokens language plpgsql volatile set search_path = public as $$
declare t public.check_in_tokens;
begin
  update public.check_in_tokens set status = 'revoked', revoked_at = now() where booking_id = p_booking and status = 'active';
  insert into public.check_in_tokens (booking_id, token, manual_code)
  values (p_booking, public.cf_random_hex(), public.cf_manual_code())
  returning * into t;
  return t;
end;
$$;

-- ---------- host requests ----------
create or replace function public.request_host(p_user uuid, p_type text, p_org text, p_city text, p_reason text)
returns public.host_requests language plpgsql security definer set search_path = public as $$
declare r public.host_requests; who public.profiles;
begin
  select * into who from public.profiles where id = p_user;
  if not found then perform public.cf_raise('auth/missing', 'Account not found.'); end if;
  if who.role = 'organizer' then perform public.cf_raise('host/already', 'You are already an approved host.'); end if;
  if exists (select 1 from public.host_requests where user_id = p_user and status = 'pending') then
    perform public.cf_raise('host/pending', 'You already have a request waiting for review.');
  end if;
  insert into public.host_requests (user_id, requested_type, organization, city, reason)
  values (p_user, p_type, trim(p_org), coalesce(trim(p_city), ''), trim(p_reason))
  returning * into r;
  return r;
end;
$$;

create or replace function public.review_host_request(p_admin uuid, p_request uuid, p_decision text, p_note text)
returns public.host_requests language plpgsql security definer set search_path = public as $$
declare r public.host_requests;
begin
  if not public.cf_is_admin(p_admin) then perform public.cf_raise('auth/forbidden', 'Only platform admins can review host requests.'); end if;
  select * into r from public.host_requests where id = p_request for update;
  if not found then perform public.cf_raise('host/missing', 'Host request not found.'); end if;
  if r.status <> 'pending' then perform public.cf_raise('host/reviewed', format('This request was already %s.', r.status)); end if;
  if r.user_id = p_admin then perform public.cf_raise('host/self', 'You can’t review your own request.'); end if;
  if p_decision not in ('approved', 'rejected') then perform public.cf_raise('host/decision', 'Decision must be approved or rejected.'); end if;

  update public.host_requests
     set status = p_decision, review_note = nullif(trim(p_note), ''), reviewed_by = p_admin, reviewed_at = now()
   where id = p_request returning * into r;

  if p_decision = 'approved' then
    update public.profiles
       set role = 'organizer',
           chapter = case when coalesce(chapter, '') = '' then r.organization else chapter end,
           city = case when coalesce(city, '') = '' then r.city else city end
     where id = r.user_id;
  end if;
  return r;
end;
$$;

-- ---------- applications (bookings) ----------
create or replace function public.request_booking(p_user uuid, p_event text, p_seats integer, p_answers jsonb, p_form_version integer)
returns public.bookings language plpgsql security definer set search_path = public as $$
declare ev public.events; who public.profiles; b public.bookings; q jsonb;
begin
  select * into who from public.profiles where id = p_user;
  if not found then perform public.cf_raise('auth/missing', 'Account not found.'); end if;
  if p_seats is null or p_seats < 1 or p_seats > 4 then perform public.cf_raise('booking/seats', 'You can request between 1 and 4 seats.'); end if;

  select * into ev from public.events where id = p_event;
  if not found then perform public.cf_raise('event/missing', 'This event no longer exists.'); end if;
  if ev.created_by = p_user then perform public.cf_raise('booking/own', 'You can’t book your own event.'); end if;
  if ev.status = 'Cancelled' then perform public.cf_raise('event/cancelled', 'This event has been cancelled.'); end if;
  if ev.date < current_date then perform public.cf_raise('event/past', 'This event has already happened.'); end if;
  if ev.registration_deadline is not null and ev.registration_deadline < current_date then
    perform public.cf_raise('event/closed', 'Registration for this event has closed.');
  end if;
  if exists (select 1 from public.bookings where user_id = p_user and event_id = p_event and status in ('Pending', 'Confirmed', 'Attended')) then
    perform public.cf_raise('booking/duplicate', 'You already have a request or seat for this event.');
  end if;
  if ev.available_seats <= 0 then perform public.cf_raise('booking/soldout', 'Sorry, this event is full.'); end if;
  if p_seats > ev.available_seats then perform public.cf_raise('booking/insufficient', format('Only %s seat(s) left.', ev.available_seats)); end if;

  insert into public.bookings (booking_id, user_id, event_id, seats, status, attendee_name, attendee_email, event_snapshot)
  values (public.cf_booking_code(), p_user, p_event, p_seats, 'Pending', who.name, who.email, public.cf_event_snapshot(ev))
  returning * into b;

  if p_answers is not null and jsonb_typeof(p_answers) = 'object' then
    for q in select jsonb_build_object('k', key, 'v', value) from jsonb_each(p_answers) loop
      insert into public.booking_answers (booking_id, question_id, answer, form_version)
      values (b.id, q ->> 'k', q -> 'v', coalesce(p_form_version, 1));
    end loop;
  end if;
  return b;
end;
$$;

create or replace function public.review_booking(p_host uuid, p_booking uuid, p_decision text, p_note text)
returns public.bookings language plpgsql security definer set search_path = public as $$
declare b public.bookings; ev public.events;
begin
  select * into b from public.bookings where id = p_booking for update;
  if not found then perform public.cf_raise('booking/missing', 'Booking not found.'); end if;
  if b.event_id is null or not public.cf_can_manage_event(p_host, b.event_id) then
    perform public.cf_raise('auth/forbidden', 'You can only manage bookings for events you host.');
  end if;
  if b.user_id = p_host then perform public.cf_raise('booking/self', 'You can’t review your own booking.'); end if;
  select * into ev from public.events where id = b.event_id for update;

  if p_decision = 'approve' then
    if b.status <> 'Pending' then perform public.cf_raise('booking/state', format('Only pending requests can be approved (this one is %s).', b.status)); end if;
    if ev.status = 'Cancelled' then perform public.cf_raise('event/cancelled', 'This event has been cancelled.'); end if;
    if ev.available_seats < b.seats then
      perform public.cf_raise('booking/insufficient', format('Not enough seats left (%s available, %s requested).', ev.available_seats, b.seats));
    end if;
    update public.events set available_seats = available_seats - b.seats where id = ev.id;
    update public.bookings set status = 'Confirmed', reviewed_by = p_host, reviewed_at = now(), review_note = nullif(trim(p_note), '')
     where id = b.id returning * into b;
    perform public.cf_issue_token(b.id);            -- QR only exists after approval
  elsif p_decision = 'reject' then
    if b.status <> 'Pending' then perform public.cf_raise('booking/state', format('Only pending requests can be rejected (this one is %s).', b.status)); end if;
    update public.bookings set status = 'Rejected', reviewed_by = p_host, reviewed_at = now(), review_note = nullif(trim(p_note), '')
     where id = b.id returning * into b;
  elsif p_decision = 'remove' then
    if b.status <> 'Confirmed' then perform public.cf_raise('booking/state', format('Only approved participants can be removed (this one is %s).', b.status)); end if;
    update public.events set available_seats = least(capacity, available_seats + b.seats) where id = ev.id;
    update public.bookings set status = 'Removed', reviewed_by = p_host, reviewed_at = now(), review_note = nullif(trim(p_note), '')
     where id = b.id returning * into b;
    update public.check_in_tokens set status = 'revoked', revoked_at = now() where booking_id = b.id and status = 'active';
  else
    perform public.cf_raise('booking/decision', 'Unknown action.');
  end if;
  return b;
end;
$$;

-- Attendee cancels their own request or seat.
create or replace function public.cancel_booking(p_user uuid, p_booking uuid)
returns public.bookings language plpgsql security definer set search_path = public as $$
declare b public.bookings;
begin
  select * into b from public.bookings where id = p_booking and user_id = p_user for update;
  if not found then perform public.cf_raise('booking/missing', 'Booking not found.'); end if;
  if b.status not in ('Pending', 'Confirmed') then perform public.cf_raise('booking/inactive', 'This booking is not active.'); end if;
  if b.status = 'Confirmed' and b.event_id is not null then
    update public.events set available_seats = least(capacity, available_seats + b.seats) where id = b.event_id;
  end if;
  update public.bookings set status = 'Cancelled' where id = b.id returning * into b;
  update public.check_in_tokens set status = 'revoked', revoked_at = now() where booking_id = b.id and status = 'active';
  return b;
end;
$$;

-- Participant (or host) gets the active QR credential; issued lazily for
-- bookings approved before QR existed, regenerated on request if compromised.
create or replace function public.booking_credential(p_actor uuid, p_booking uuid, p_regenerate boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b public.bookings; t public.check_in_tokens; a public.attendance;
begin
  select * into b from public.bookings where id = p_booking for update;
  if not found then perform public.cf_raise('booking/missing', 'Booking not found.'); end if;
  if b.user_id <> p_actor and not (b.event_id is not null and public.cf_can_manage_event(p_actor, b.event_id)) then
    perform public.cf_raise('booking/missing', 'Booking not found.');
  end if;
  select * into a from public.attendance where booking_id = b.id;
  if b.status not in ('Confirmed', 'Attended') then
    perform public.cf_raise('qr/not_approved', 'Your check-in QR appears once the organizer approves your booking.');
  end if;
  select * into t from public.check_in_tokens where booking_id = b.id and status = 'active';
  if b.status = 'Confirmed' and (t.id is null or p_regenerate) then
    t := public.cf_issue_token(b.id);
  end if;
  return jsonb_build_object(
    'token', case when b.status = 'Confirmed' then t.token end,
    'manualCode', case when b.status = 'Confirmed' then t.manual_code end,
    'generatedAt', t.generated_at,
    'checkedInAt', a.checked_in_at,
    'status', b.status
  );
end;
$$;

-- Host scans a QR (token) or types a manual code. Exactly-once, irreversible.
create or replace function public.check_in(p_host uuid, p_event text, p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare t public.check_in_tokens; b public.bookings; ev public.events; a public.attendance; code text;
begin
  if not public.cf_can_manage_event(p_host, p_event) then
    perform public.cf_raise('auth/forbidden', 'You can only check people in to events you host.');
  end if;
  select * into ev from public.events where id = p_event;
  if not found then perform public.cf_raise('event/missing', 'Event not found.'); end if;
  if ev.status = 'Cancelled' then perform public.cf_raise('checkin/event_closed', 'This event was cancelled, so check-in is closed.'); end if;

  code := trim(coalesce(p_code, ''));
  code := regexp_replace(code, '^codefolio:ci:', '');
  select * into t from public.check_in_tokens where token = code or manual_code = upper(regexp_replace(code, '[^A-Za-z0-9]', '', 'g'));
  if not found then perform public.cf_raise('checkin/invalid', 'Invalid QR: this code isn’t recognised.'); end if;

  select * into b from public.bookings where id = t.booking_id for update;
  if not found then perform public.cf_raise('checkin/not_found', 'Registration not found.'); end if;
  if b.event_id is distinct from p_event then perform public.cf_raise('checkin/wrong_event', 'Wrong event: this QR belongs to a different event.'); end if;

  select * into a from public.attendance where booking_id = b.id;
  if found then
    perform public.cf_raise('checkin/already', format('Already checked in at %s.', to_char(a.checked_in_at at time zone 'Asia/Kolkata', 'DD Mon, HH12:MI AM')));
  end if;
  if t.status = 'revoked' then perform public.cf_raise('checkin/revoked', 'QR revoked: the participant has a newer code. Ask them to open it again.'); end if;
  if b.status <> 'Confirmed' then
    perform public.cf_raise('checkin/not_approved', format('Not approved: this registration is %s.', lower(b.status)));
  end if;

  insert into public.attendance (booking_id, event_id, token_id, checked_in_by)
  values (b.id, b.event_id, t.id, p_host)
  returning * into a;                               -- unique(booking_id) blocks a concurrent duplicate
  update public.bookings set status = 'Attended' where id = b.id returning * into b;

  return jsonb_build_object(
    'bookingDbId', b.id, 'bookingId', b.booking_id, 'attendeeName', b.attendee_name,
    'seats', b.seats, 'checkedInAt', a.checked_in_at, 'eventTitle', ev.title
  );
end;
$$;

-- Deleting an event cancels live applications and revokes their QRs.
create or replace function public.delete_event(p_event text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform 1 from public.events where id = p_event for update;
  if not found then perform public.cf_raise('event/missing', 'Event not found.'); end if;
  update public.check_in_tokens set status = 'revoked', revoked_at = now()
   where status = 'active' and booking_id in (select id from public.bookings where event_id = p_event);
  update public.bookings set status = 'Cancelled' where event_id = p_event and status in ('Pending', 'Confirmed');
  delete from public.events where id = p_event;
end;
$$;

-- Instant booking is gone: seats are only taken when a host approves.
drop function if exists public.book_seats(uuid, text, integer);

-- Service role only (the API). Never callable from the browser.
do $$
declare f text;
begin
  foreach f in array array[
    'public.cf_random_hex()', 'public.cf_manual_code()', 'public.cf_is_admin(uuid)', 'public.cf_can_manage_event(uuid, text)',
    'public.cf_issue_token(uuid)', 'public.request_host(uuid, text, text, text, text)',
    'public.review_host_request(uuid, uuid, text, text)', 'public.request_booking(uuid, text, integer, jsonb, integer)',
    'public.review_booking(uuid, uuid, text, text)', 'public.cancel_booking(uuid, uuid)',
    'public.booking_credential(uuid, uuid, boolean)', 'public.check_in(uuid, text, text)', 'public.delete_event(text)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

-- ---------- private storage for application file answers ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('application-files', 'application-files', false, 5 * 1024 * 1024,
        array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'application/zip', 'text/plain'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
