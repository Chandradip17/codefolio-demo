-- =====================================================================
-- Codefolio schema for Supabase (Postgres 15+)
-- Run once in the Supabase SQL editor (or `psql -f`). Safe to re-run.
--
-- Security model: the browser never talks to these tables directly.
-- RLS is enabled with NO policies, so the anon/authenticated keys can't
-- read or write anything; only the Express API (service-role key) can.
-- =====================================================================

-- gen_random_uuid() is built into Postgres 13+, no extension needed.

-- ---------- profiles (1:1 with auth.users) ----------
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  name        text not null check (char_length(name) between 2 and 80),
  email       text not null unique,
  role        text not null default 'attendee' check (role in ('attendee', 'organizer')),
  city        text not null default '',
  chapter     text not null default '',
  bio         text not null default '',
  created_at  timestamptz not null default now()
);

-- ---------- events (Codefolio-hosted; live GDG/Devfolio events are not stored) ----------
create table if not exists public.events (
  id                     text primary key default ('cf-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)),
  title                  text not null check (char_length(title) between 5 and 140),
  type                   text not null check (type in ('Event', 'Hackathon')),
  category               text not null check (category in ('hackathon', 'workshop', 'gdg')),
  mode                   text not null check (mode in ('Online', 'In-person')),
  city                   text not null,
  venue                  text not null default '',
  date                   date not null,
  start_time             time not null,
  end_time               time,
  organizer_chapter      text not null,
  capacity               integer not null check (capacity between 1 and 100000),
  available_seats        integer not null,
  description            text not null default '',
  image                  text,
  status                 text not null default 'Published' check (status in ('Published', 'Cancelled')),
  registration_deadline  date,
  requirements           text[] not null default '{}',
  learn                  text[] not null default '{}',
  tags                   text[] not null default '{}',
  is_sample              boolean not null default false,
  organizer_name         text not null default '',
  organizer_email        text not null default '',
  created_by             uuid references public.profiles (id) on delete set null,
  created_at             timestamptz not null default now(),
  constraint seats_in_range check (available_seats between 0 and capacity)
);
create index if not exists events_date_idx on public.events (date);
create index if not exists events_created_by_idx on public.events (created_by);

-- ---------- bookings ----------
create table if not exists public.bookings (
  id               uuid primary key default gen_random_uuid(),
  booking_id       text not null unique,
  user_id          uuid not null references public.profiles (id) on delete cascade,
  event_id         text references public.events (id) on delete set null,
  seats            integer not null check (seats between 1 and 4),
  status           text not null default 'Confirmed' check (status in ('Confirmed', 'Cancelled', 'Attended')),
  attendee_name    text not null,
  attendee_email   text not null,
  event_snapshot   jsonb not null,           -- what the attendee booked, survives event deletion
  booked_at        timestamptz not null default now()
);
create index if not exists bookings_user_idx on public.bookings (user_id);
create index if not exists bookings_event_idx on public.bookings (event_id);
-- One active booking per attendee per event (duplicate-booking guard).
create unique index if not exists bookings_one_active_per_user
  on public.bookings (user_id, event_id) where status = 'Confirmed';

alter table public.profiles enable row level security;
alter table public.events   enable row level security;
alter table public.bookings enable row level security;

-- ---------- auto-create a profile when a Supabase Auth user is created ----------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, name, email, role, city, chapter, bio)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'name', ''), split_part(new.email, '@', 1)),
    new.email,
    case when new.raw_user_meta_data ->> 'role' = 'organizer' then 'organizer' else 'attendee' end,
    coalesce(new.raw_user_meta_data ->> 'city', ''),
    coalesce(new.raw_user_meta_data ->> 'chapter', ''),
    coalesce(new.raw_user_meta_data ->> 'bio', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- helpers ----------
-- Errors carry a machine-readable code in HINT (e.g. 'booking/soldout');
-- the API maps it to an HTTP status.
create or replace function public.cf_raise(p_code text, p_message text)
returns void language plpgsql as $$
begin
  raise exception using errcode = 'P0001', message = p_message, hint = p_code;
end;
$$;

create or replace function public.cf_booking_code()
returns text language plpgsql as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  code text;
begin
  loop
    code := 'CF-';
    for i in 1..6 loop
      code := code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.bookings where booking_id = code);
  end loop;
  return code;
end;
$$;

create or replace function public.cf_event_snapshot(e public.events)
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'title', e.title, 'type', e.type, 'category', e.category,
    'date', to_char(e.date, 'YYYY-MM-DD'), 'time', to_char(e.start_time, 'HH24:MI'),
    'venue', e.venue, 'city', e.city, 'mode', e.mode,
    'organizerChapter', e.organizer_chapter, 'image', e.image
  );
$$;

-- ---------- book seats (atomic) ----------
-- Locks the event row, so concurrent bookings can never oversell.
create or replace function public.book_seats(p_user uuid, p_event text, p_seats integer)
returns public.bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  ev   public.events;
  who  public.profiles;
  dup  public.bookings;
  b    public.bookings;
begin
  select * into who from public.profiles where id = p_user;
  if not found then perform public.cf_raise('auth/missing', 'Account not found.'); end if;
  if who.role <> 'attendee' then perform public.cf_raise('booking/role', 'Only attendee accounts can book seats.'); end if;

  if p_seats is null or p_seats < 1 or p_seats > 4 then
    perform public.cf_raise('booking/seats', 'You can book between 1 and 4 seats.');
  end if;

  select * into ev from public.events where id = p_event for update;
  if not found then perform public.cf_raise('event/missing', 'This event no longer exists.'); end if;
  if ev.status = 'Cancelled' then perform public.cf_raise('event/cancelled', 'This event has been cancelled.'); end if;
  if ev.date < current_date then perform public.cf_raise('event/past', 'This event has already happened.'); end if;
  if ev.registration_deadline is not null and ev.registration_deadline < current_date then
    perform public.cf_raise('event/closed', 'Registration for this event has closed.');
  end if;

  select * into dup from public.bookings
   where user_id = p_user and event_id = p_event and status = 'Confirmed';
  if found then
    perform public.cf_raise('booking/duplicate', format('You already have a seat for this event (%s).', dup.booking_id));
  end if;

  if ev.available_seats <= 0 then perform public.cf_raise('booking/soldout', 'Sorry, this event is sold out.'); end if;
  if p_seats > ev.available_seats then
    perform public.cf_raise('booking/insufficient', format('Only %s seat(s) left.', ev.available_seats));
  end if;

  update public.events set available_seats = available_seats - p_seats where id = p_event
  returning * into ev;

  insert into public.bookings (booking_id, user_id, event_id, seats, status, attendee_name, attendee_email, event_snapshot)
  values (public.cf_booking_code(), p_user, p_event, p_seats, 'Confirmed', who.name, who.email, public.cf_event_snapshot(ev))
  returning * into b;

  return b;
end;
$$;

-- ---------- cancel a booking (atomic seat release) ----------
create or replace function public.cancel_booking(p_user uuid, p_booking uuid)
returns public.bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.bookings;
begin
  select * into b from public.bookings where id = p_booking and user_id = p_user for update;
  if not found then perform public.cf_raise('booking/missing', 'Booking not found.'); end if;
  if b.status <> 'Confirmed' then perform public.cf_raise('booking/inactive', 'This booking is not active.'); end if;

  update public.bookings set status = 'Cancelled' where id = b.id returning * into b;

  if b.event_id is not null then
    update public.events
       set available_seats = least(capacity, available_seats + b.seats)
     where id = b.event_id;
  end if;
  return b;
end;
$$;

-- ---------- change capacity without losing track of booked seats ----------
create or replace function public.set_event_capacity(p_event text, p_capacity integer)
returns public.events
language plpgsql
security definer
set search_path = public
as $$
declare
  ev public.events;
  booked integer;
begin
  select * into ev from public.events where id = p_event for update;
  if not found then perform public.cf_raise('event/missing', 'Event not found.'); end if;
  booked := ev.capacity - ev.available_seats;
  if p_capacity < booked then
    perform public.cf_raise('event/capacity', format('Capacity can''t be lower than the %s seats already booked.', booked));
  end if;
  update public.events set capacity = p_capacity, available_seats = p_capacity - booked
   where id = p_event returning * into ev;
  return ev;
end;
$$;

-- ---------- delete an event; active bookings become Cancelled ----------
create or replace function public.delete_event(p_event text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform 1 from public.events where id = p_event for update;
  if not found then perform public.cf_raise('event/missing', 'Event not found.'); end if;
  update public.bookings set status = 'Cancelled' where event_id = p_event and status = 'Confirmed';
  delete from public.events where id = p_event;
end;
$$;

-- Keep booking snapshots in sync when an organizer edits an event.
create or replace function public.sync_booking_snapshots()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (new.title, new.date, new.start_time, new.venue, new.city, new.mode, new.organizer_chapter, new.image, new.category)
     is distinct from
     (old.title, old.date, old.start_time, old.venue, old.city, old.mode, old.organizer_chapter, old.image, old.category) then
    update public.bookings set event_snapshot = public.cf_event_snapshot(new) where event_id = new.id;
  end if;
  return new;
end;
$$;
drop trigger if exists events_sync_snapshots on public.events;
create trigger events_sync_snapshots after update on public.events
  for each row execute function public.sync_booking_snapshots();

-- Only the service role may call the RPCs.
revoke all on function public.book_seats(uuid, text, integer)      from public, anon, authenticated;
revoke all on function public.cancel_booking(uuid, uuid)           from public, anon, authenticated;
revoke all on function public.set_event_capacity(text, integer)    from public, anon, authenticated;
revoke all on function public.delete_event(text)                   from public, anon, authenticated;
grant execute on function public.book_seats(uuid, text, integer)   to service_role;
grant execute on function public.cancel_booking(uuid, uuid)        to service_role;
grant execute on function public.set_event_capacity(text, integer) to service_role;
grant execute on function public.delete_event(text)                to service_role;
