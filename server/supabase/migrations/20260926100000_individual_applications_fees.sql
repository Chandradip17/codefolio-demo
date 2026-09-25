-- 1. Every application is for one person (one seat). Hackathon teams are made of
--    individual applications; other events have no team option at all.
-- 2. Application fee (₹). When it's above 0 the host must give a UPI QR image,
--    UPI ID and UPI number; applicants pay and submit their UPI transaction
--    reference (12-digit UTR), plus an optional payment screenshot.

alter table public.events
  add column if not exists application_fee integer not null default 0,
  add column if not exists upi_id text,
  add column if not exists upi_number text,
  add column if not exists upi_qr_url text;

alter table public.events drop constraint if exists events_application_fee;
alter table public.events add constraint events_application_fee check (application_fee between 0 and 100000);
alter table public.events drop constraint if exists events_upi_details;
alter table public.events add constraint events_upi_details check (
  application_fee = 0
  or (coalesce(upi_id, '') ~ '^[A-Za-z0-9._-]{2,255}@[A-Za-z]{2,64}$'
      and coalesce(upi_number, '') ~ '^[6-9][0-9]{9}$'
      and coalesce(upi_qr_url, '') ~ '^https://')
);

alter table public.bookings
  add column if not exists fee_amount integer,
  add column if not exists payment_ref text,
  add column if not exists payment_proof jsonb;
create index if not exists bookings_event_payment_ref on public.bookings (event_id, payment_ref) where payment_ref is not null;

drop function if exists public.request_booking(uuid, text, integer, jsonb, integer, text, text, text);
create or replace function public.request_booking(
  p_user uuid, p_event text, p_seats integer, p_answers jsonb, p_form_version integer,
  p_participation text default null, p_team_name text default null, p_team_code text default null,
  p_payment_ref text default null, p_payment_proof jsonb default null
)
returns public.bookings language plpgsql security definer set search_path = public as $$
declare
  ev public.events; who public.profiles; b public.bookings; q jsonb;
  t public.teams; tmin int; tmax int; n int; clean_code text; clean_name text; clean_ref text;
  is_hack boolean;
begin
  select * into who from public.profiles where id = p_user;
  if not found then perform public.cf_raise('auth/missing', 'Account not found.'); end if;

  select * into ev from public.events where id = p_event;
  if not found or ev.status = 'Draft' then perform public.cf_raise('event/missing', 'This event no longer exists.'); end if;
  is_hack := ev.category = 'hackathon';
  -- One application = one person = one seat.
  p_seats := 1;

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

  -- ---- application fee ----
  if ev.application_fee > 0 then
    clean_ref := regexp_replace(coalesce(p_payment_ref, ''), '\s', '', 'g');
    if clean_ref !~ '^[0-9]{12}$' then
      perform public.cf_raise('payment/ref', format('Pay the ₹%s application fee by UPI and enter the 12-digit UPI transaction ID (UTR).', ev.application_fee));
    end if;
    if exists (select 1 from public.bookings where event_id = p_event and payment_ref = clean_ref and status in ('Pending', 'Confirmed', 'Attended')) then
      perform public.cf_raise('payment/duplicate', 'That UPI transaction ID has already been used for this event.');
    end if;
    if p_payment_proof is not null and (jsonb_typeof(p_payment_proof) <> 'object' or coalesce(p_payment_proof ->> 'path', '') not like p_user::text || '/%') then
      perform public.cf_raise('payment/proof', 'Upload the payment screenshot again.');
    end if;
  else
    clean_ref := null;
    p_payment_proof := null;
  end if;

  -- ---- participation (hackathons only; events are always individual) ----
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
      select * into t from public.teams where code = clean_code for update;
      if not found then perform public.cf_raise('team/not_found', 'No team found with that code. Check it with your team leader.'); end if;
      if t.event_id <> p_event then perform public.cf_raise('team/wrong_event', 'That team code belongs to a different hackathon.'); end if;
      select count(*) into n from public.team_members where team_id = t.id;
      if n >= tmax then perform public.cf_raise('team/full', format('%s is full (%s of %s members).', t.name, n, tmax)); end if;
    end if;
  end if;

  insert into public.bookings (booking_id, user_id, event_id, seats, status, attendee_name, attendee_email, event_snapshot,
                               participation, team_id, fee_amount, payment_ref, payment_proof)
  values (public.cf_booking_code(), p_user, p_event, p_seats, 'Pending', who.name, who.email, public.cf_event_snapshot(ev),
          case when not is_hack then null when p_participation = 'solo' then 'solo' else 'team' end,
          t.id,
          case when ev.application_fee > 0 then ev.application_fee else null end,
          clean_ref, p_payment_proof)
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
revoke all on function public.request_booking(uuid, text, integer, jsonb, integer, text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.request_booking(uuid, text, integer, jsonb, integer, text, text, text, text, jsonb) to service_role;
