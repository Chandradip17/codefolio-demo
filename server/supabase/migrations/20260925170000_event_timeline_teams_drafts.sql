-- Event timeline, participation format, team sizes, theme and drafts.
--   * applications window (open / deadline, timestamptz) enforced by request_booking
--   * end date for multi-day events (hackathon "hacking ends / demos")
--   * hybrid events (mode stays Online / In-person for filters; hybrid flag on top)
--   * min / max team size (hackathons) and a theme / track
--   * status 'Draft': visible only to the host (the API filters it), not bookable

alter table public.events
  add column if not exists end_date date,
  add column if not exists applications_open_at timestamptz,
  add column if not exists applications_close_at timestamptz,
  add column if not exists hybrid boolean not null default false,
  add column if not exists team_min smallint,
  add column if not exists team_max smallint,
  add column if not exists theme text;

alter table public.events drop constraint if exists events_status_check;
alter table public.events add constraint events_status_check check (status in ('Published', 'Draft', 'Cancelled'));

alter table public.events drop constraint if exists events_end_after_start;
alter table public.events add constraint events_end_after_start check (end_date is null or end_date >= date);

alter table public.events drop constraint if exists events_application_window;
alter table public.events add constraint events_application_window
  check (applications_open_at is null or applications_close_at is null or applications_open_at < applications_close_at);

alter table public.events drop constraint if exists events_team_size;
alter table public.events add constraint events_team_size check (
  (team_min is null or team_min between 1 and 10)
  and (team_max is null or team_max between 1 and 10)
  and (team_min is null or team_max is null or team_min <= team_max)
);

alter table public.events drop constraint if exists events_theme_length;
alter table public.events add constraint events_theme_length check (theme is null or char_length(theme) <= 120);

-- Applications: respect drafts and the application window.
create or replace function public.request_booking(p_user uuid, p_event text, p_seats integer, p_answers jsonb, p_form_version integer)
returns public.bookings language plpgsql security definer set search_path = public as $$
declare ev public.events; who public.profiles; b public.bookings; q jsonb;
begin
  select * into who from public.profiles where id = p_user;
  if not found then perform public.cf_raise('auth/missing', 'Account not found.'); end if;
  if p_seats is null or p_seats < 1 or p_seats > 4 then perform public.cf_raise('booking/seats', 'You can request between 1 and 4 seats.'); end if;

  select * into ev from public.events where id = p_event;
  if not found or ev.status = 'Draft' then perform public.cf_raise('event/missing', 'This event no longer exists.'); end if;
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
revoke all on function public.request_booking(uuid, text, integer, jsonb, integer) from public, anon, authenticated;
grant execute on function public.request_booking(uuid, text, integer, jsonb, integer) to service_role;

-- Landing-page numbers ignore drafts.
create or replace function public.platform_stats()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'members', (select count(*) from public.profiles p join auth.users u on u.id = p.id
                 where p.onboarding_completed and u.last_sign_in_at is not null),
    'events_hosted', (select count(*) from public.events where not is_sample and status <> 'Draft'),
    'seats_booked', (select coalesce(sum(b.seats), 0) from public.bookings b
                      join public.events e on e.id = b.event_id
                      where not e.is_sample and b.status in ('Confirmed', 'Attended')),
    'cities', (select count(distinct city) from public.events where not is_sample and status <> 'Draft')
  );
$$;
