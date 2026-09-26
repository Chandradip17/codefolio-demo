-- AI Idea Assistant · Hackathon Communication Center · Organizer Analytics
--
-- Same security model as the rest of Codefolio: RLS on, no policies, no browser
-- privileges on any table below. The API (service role) reads/writes; every
-- visibility / permission rule lives in the SECURITY DEFINER functions here
-- (service_role only). Nothing existing is dropped or rewritten.

-- =====================================================================
-- AI Idea Assistant: saved ideas (private to their author)
-- =====================================================================
create table if not exists public.hackathon_ideas (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references public.profiles (id) on delete cascade,
  event_id            text not null references public.events (id) on delete cascade,
  title               text not null check (char_length(title) between 1 and 120),
  problem_statement   text not null default '' check (char_length(problem_statement) <= 2000),
  solution            text not null default '' check (char_length(solution) <= 3000),
  target_users        text not null default '' check (char_length(target_users) <= 1000),
  features            jsonb not null default '[]' check (jsonb_typeof(features) = 'array'),
  tech_stack          jsonb not null default '[]' check (jsonb_typeof(tech_stack) = 'array'),
  mvp_scope           text not null default '' check (char_length(mvp_scope) <= 3000),
  roadmap             jsonb not null default '[]' check (jsonb_typeof(roadmap) = 'array'),
  challenges          jsonb not null default '[]' check (jsonb_typeof(challenges) = 'array'),
  future_improvements jsonb not null default '[]' check (jsonb_typeof(future_improvements) = 'array'),
  assumptions         jsonb not null default '[]' check (jsonb_typeof(assumptions) = 'array'),
  inputs              jsonb not null default '{}' check (jsonb_typeof(inputs) = 'object'),
  model               text,
  raw_ai_response     jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists hackathon_ideas_owner on public.hackathon_ideas (user_id, event_id, updated_at desc);
alter table public.hackathon_ideas enable row level security;

-- =====================================================================
-- Communication Center
-- =====================================================================
create table if not exists public.hackathon_announcements (
  id             uuid primary key default gen_random_uuid(),
  event_id       text not null references public.events (id) on delete cascade,
  created_by     uuid references public.profiles (id) on delete set null,
  title          text not null check (char_length(title) between 3 and 140),
  message        text not null check (char_length(message) between 1 and 5000),
  audience_type  text not null default 'all' check (audience_type in ('all', 'participants', 'judges', 'team')),
  team_id        uuid references public.teams (id) on delete cascade,
  is_important   boolean not null default false,
  is_pinned      boolean not null default false,
  publish_at     timestamptz not null default now(),
  notified_at    timestamptz,
  archived_at    timestamptz,
  edited_at      timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  check ((audience_type = 'team') = (team_id is not null))
);
create index if not exists hackathon_announcements_feed on public.hackathon_announcements (event_id, publish_at desc) where archived_at is null;
create index if not exists hackathon_announcements_due on public.hackathon_announcements (publish_at) where notified_at is null and archived_at is null;
alter table public.hackathon_announcements enable row level security;

create table if not exists public.announcement_reads (
  announcement_id uuid not null references public.hackathon_announcements (id) on delete cascade,
  user_id         uuid not null references public.profiles (id) on delete cascade,
  read_at         timestamptz not null default now(),
  primary key (announcement_id, user_id)
);
create index if not exists announcement_reads_user on public.announcement_reads (user_id);
alter table public.announcement_reads enable row level security;

-- A member's relationship to a hackathon (all derived from the database, never from the client).
create or replace function public.cf_event_role(p_user uuid, p_event text)
returns table (manager boolean, judge boolean, participant boolean, team_id uuid)
language sql stable security definer set search_path = public as $$
  select public.cf_can_manage_event(p_user, p_event),
         exists (select 1 from public.judge_assignments j where j.event_id = p_event and j.judge_id = p_user),
         exists (select 1 from public.bookings b where b.event_id = p_event and b.user_id = p_user and b.status in ('Pending', 'Confirmed', 'Attended')),
         (select m.team_id from public.team_members m
            join public.bookings b on b.id = m.booking_id and b.status in ('Pending', 'Confirmed', 'Attended')
           where m.event_id = p_event and m.user_id = p_user limit 1)
$$;

-- Can this user see this announcement? (published, not archived, audience matches)
create or replace function public.cf_can_see_announcement(p_user uuid, a public.hackathon_announcements)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare r record;
begin
  select * into r from public.cf_event_role(p_user, a.event_id);
  if r.manager then return true; end if;                          -- organizers see everything, incl. scheduled
  if a.archived_at is not null or a.publish_at > now() then return false; end if;
  return case a.audience_type
    when 'all' then r.participant or r.judge
    when 'participants' then r.participant
    when 'judges' then r.judge
    when 'team' then r.participant and r.team_id = a.team_id
    else false
  end;
end;
$$;

create or replace function public.save_announcement(
  p_actor uuid, p_event text, p_id uuid, p_title text, p_message text, p_audience text, p_team uuid,
  p_important boolean, p_pinned boolean, p_publish_at timestamptz
)
returns public.hackathon_announcements language plpgsql security definer set search_path = public as $$
declare ev public.events; a public.hackathon_announcements; t timestamptz := now();
begin
  select * into ev from public.events where id = p_event;
  if not found or ev.category <> 'hackathon' then perform public.cf_raise('event/missing', 'Hackathon not found.'); end if;
  if not public.cf_can_manage_event(p_actor, p_event) then
    perform public.cf_raise('auth/forbidden', 'Only this hackathon’s organizer can post announcements.');
  end if;
  if coalesce(p_audience, '') not in ('all', 'participants', 'judges', 'team') then
    perform public.cf_raise('announce/audience', 'Choose who should see this announcement.');
  end if;
  if p_audience = 'team' and not exists (select 1 from public.teams where id = p_team and event_id = p_event) then
    perform public.cf_raise('announce/team', 'That team isn’t part of this hackathon.');
  end if;
  if p_publish_at is not null and p_publish_at > t + interval '60 days' then
    perform public.cf_raise('announce/schedule', 'Schedule announcements at most 60 days ahead.');
  end if;

  if p_id is null then
    insert into public.hackathon_announcements (event_id, created_by, title, message, audience_type, team_id, is_important, is_pinned, publish_at)
    values (p_event, p_actor, btrim(p_title), btrim(p_message), p_audience, case when p_audience = 'team' then p_team end,
            coalesce(p_important, false), coalesce(p_pinned, false), greatest(coalesce(p_publish_at, t), t))
    returning * into a;
  else
    select * into a from public.hackathon_announcements where id = p_id and event_id = p_event for update;
    if not found then perform public.cf_raise('announce/missing', 'Announcement not found.'); end if;
    if a.archived_at is not null then perform public.cf_raise('announce/archived', 'This announcement was archived.'); end if;
    update public.hackathon_announcements set
      title = btrim(p_title), message = btrim(p_message), audience_type = p_audience,
      team_id = case when p_audience = 'team' then p_team end,
      is_important = coalesce(p_important, false), is_pinned = coalesce(p_pinned, false),
      -- Only a still-scheduled announcement can be rescheduled.
      publish_at = case when a.publish_at > t then greatest(coalesce(p_publish_at, t), t) else a.publish_at end,
      edited_at = case when a.publish_at <= t then t else null end,
      updated_at = t
     where id = p_id returning * into a;
  end if;
  return a;
end;
$$;

create or replace function public.archive_announcement(p_actor uuid, p_id uuid)
returns public.hackathon_announcements language plpgsql security definer set search_path = public as $$
declare a public.hackathon_announcements;
begin
  select * into a from public.hackathon_announcements where id = p_id for update;
  if not found then perform public.cf_raise('announce/missing', 'Announcement not found.'); end if;
  if not public.cf_can_manage_event(p_actor, a.event_id) then
    perform public.cf_raise('auth/forbidden', 'Only this hackathon’s organizer can archive announcements.');
  end if;
  update public.hackathon_announcements set archived_at = coalesce(archived_at, now()), is_pinned = false, updated_at = now()
   where id = p_id returning * into a;
  return a;
end;
$$;

-- The feed a member is allowed to see (newest first, pinned first on page 1).
create or replace function public.announcements_for(p_user uuid, p_event text, p_limit integer, p_before timestamptz)
returns table (
  id uuid, event_id text, title text, message text, audience_type text, team_id uuid, team_name text,
  is_important boolean, is_pinned boolean, publish_at timestamptz, edited_at timestamptz, archived_at timestamptz,
  created_by_name text, is_read boolean, scheduled boolean
)
language sql stable security definer set search_path = public as $$
  select a.id, a.event_id, a.title, a.message, a.audience_type, a.team_id, t.name, a.is_important, a.is_pinned,
         a.publish_at, a.edited_at, a.archived_at, p.name,
         exists (select 1 from public.announcement_reads r where r.announcement_id = a.id and r.user_id = p_user),
         a.publish_at > now()
    from public.hackathon_announcements a
    left join public.teams t on t.id = a.team_id
    left join public.profiles p on p.id = a.created_by
   where a.event_id = p_event
     and public.cf_can_see_announcement(p_user, a)
     and (p_before is null or a.publish_at < p_before)
   order by (p_before is null and a.is_pinned and a.archived_at is null) desc, a.publish_at desc
   limit least(greatest(coalesce(p_limit, 20), 1), 50)
$$;

-- Who should be notified when an announcement goes live.
create or replace function public.announcement_audience(p_id uuid)
returns setof uuid language sql stable security definer set search_path = public as $$
  with a as (select * from public.hackathon_announcements where id = p_id and archived_at is null)
  select distinct u from (
    select b.user_id u from a join public.bookings b on b.event_id = a.event_id and b.status in ('Pending', 'Confirmed', 'Attended')
     where a.audience_type in ('all', 'participants')
    union all
    select j.judge_id from a join public.judge_assignments j on j.event_id = a.event_id where a.audience_type in ('all', 'judges')
    union all
    select m.user_id from a join public.team_members m on m.team_id = a.team_id
      join public.bookings b on b.id = m.booking_id and b.status in ('Pending', 'Confirmed', 'Attended')
     where a.audience_type = 'team'
  ) x where u is not null
$$;

-- Mark read: only announcements the member can actually see; duplicates are ignored.
create or replace function public.mark_announcements_read(p_user uuid, p_event text, p_ids uuid[])
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  insert into public.announcement_reads (announcement_id, user_id)
  select a.id, p_user from public.hackathon_announcements a
   where a.event_id = p_event and a.archived_at is null and a.publish_at <= now()
     and (p_ids is null or a.id = any (p_ids))
     and public.cf_can_see_announcement(p_user, a)
  on conflict do nothing;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Unread counts across the hackathons a member takes part in / judges.
create or replace function public.announcement_unread_counts(p_user uuid)
returns table (event_id text, unread integer) language sql stable security definer set search_path = public as $$
  select a.event_id, count(*)::int
    from public.hackathon_announcements a
   where a.archived_at is null and a.publish_at <= now()
     and a.event_id in (
       select b.event_id from public.bookings b where b.user_id = p_user and b.status in ('Pending', 'Confirmed', 'Attended')
       union select j.event_id from public.judge_assignments j where j.judge_id = p_user)
     and not public.cf_can_manage_event(p_user, a.event_id)
     and public.cf_can_see_announcement(p_user, a)
     and not exists (select 1 from public.announcement_reads r where r.announcement_id = a.id and r.user_id = p_user)
   group by a.event_id
$$;

-- Scheduled announcements whose time has come (claimed once, so each is pushed once).
create or replace function public.claim_due_announcements()
returns setof public.hackathon_announcements language sql security definer set search_path = public as $$
  update public.hackathon_announcements set notified_at = now()
   where notified_at is null and archived_at is null and publish_at <= now()
  returning *
$$;

-- =====================================================================
-- Organizer Analytics: one aggregated document per hackathon
-- =====================================================================
create or replace function public.hackathon_analytics(p_actor uuid, p_event text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare ev public.events; out jsonb;
begin
  select * into ev from public.events where id = p_event;
  if not found or ev.category <> 'hackathon' then perform public.cf_raise('event/missing', 'Hackathon not found.'); end if;
  if not public.cf_can_manage_event(p_actor, p_event) then
    perform public.cf_raise('auth/forbidden', 'Only this hackathon’s organizer can view its analytics.');
  end if;

  with bk as (
    select b.* from public.bookings b where b.event_id = p_event
  ), active as (
    select * from bk where status in ('Pending', 'Confirmed', 'Attended')
  ), approved as (
    select * from bk where status in ('Confirmed', 'Attended')
  ), members as (           -- approved participants and their team (if any)
    select a.user_id, m.team_id from approved a left join public.team_members m on m.booking_id = a.id
  ), team_sizes as (
    select team_id, count(*)::int size from members where team_id is not null group by team_id
  ), units as (             -- who is expected to submit: each team with an approved member, each approved solo
    select team_id as unit_team, null::uuid as unit_user from team_sizes
    union all select null, user_id from members where team_id is null
  ), proj as (
    select p.*, (select count(*) from public.project_reviews r where r.project_id = p.id)::int reviews
      from public.projects p where p.event_id = p_event
  ), judges as (
    select count(*)::int n from public.judge_assignments where event_id = p_event
  ), tech as (
    select lower(btrim(t)) k, min(btrim(t)) label, count(distinct p.id)::int n
      from public.projects p, unnest(p.tech_stack) t
     where p.event_id = p_event and btrim(t) <> ''
     group by lower(btrim(t))
  ), daily as (
    select (booked_at at time zone 'Asia/Kolkata')::date d, count(*)::int n from bk group by 1
  )
  select jsonb_build_object(
    'registrations', jsonb_build_object(
      'total', (select count(*) from bk),
      'active', (select count(*) from active),
      'approved', (select count(*) from approved),
      'byStatus', coalesce((select jsonb_object_agg(status, n) from (select status, count(*)::int n from bk group by status) s), '{}'::jsonb),
      'daily', coalesce((select jsonb_agg(jsonb_build_object('date', d, 'count', n) order by d) from daily), '[]'::jsonb)
    ),
    'teams', jsonb_build_object(
      'count', (select count(*) from team_sizes),
      'inTeams', (select count(*) from members where team_id is not null),
      'notInTeam', (select count(*) from members where team_id is null),
      'averageSize', (select round(avg(size)::numeric, 2) from team_sizes),
      'sizes', coalesce((select jsonb_object_agg(size, n) from (select size, count(*)::int n from team_sizes group by size) s), '{}'::jsonb),
      'min', coalesce(ev.team_min, 1), 'max', coalesce(ev.team_max, 4),
      'belowMinimum', (select count(*) from team_sizes where size < coalesce(ev.team_min, 1))
    ),
    'submissions', jsonb_build_object(
      'expected', (select count(*) from units),
      'submitted', (select count(*) from proj),
      'notStarted', (select count(*) from units u where not exists (
          select 1 from proj p where (u.unit_team is not null and p.team_id = u.unit_team)
                                  or (u.unit_user is not null and p.team_id is null and p.submitted_by = u.unit_user))),
      'awaitingReview', (select count(*) from proj where reviews = 0),
      'partiallyReviewed', (select count(*) from proj, judges where reviews > 0 and reviews < judges.n),
      'fullyReviewed', (select count(*) from proj, judges where judges.n > 0 and reviews >= judges.n)
    ),
    'judging', jsonb_build_object(
      'judges', (select n from judges),
      'expectedReviews', (select count(*) from proj) * (select n from judges),
      'reviews', (select count(*) from public.project_reviews where event_id = p_event)
    ),
    'tech', jsonb_build_object(
      'projects', (select count(*) from proj),
      'projectsWithTech', (select count(*) from proj where cardinality(tech_stack) > 0),
      'top', coalesce((select jsonb_agg(jsonb_build_object('label', label, 'count', n) order by n desc, k) from (select * from tech order by n desc, k limit 12) x), '[]'::jsonb)
    ),
    'timeline', jsonb_build_object(
      'applicationsOpenAt', ev.applications_open_at,
      'applicationsCloseAt', ev.applications_close_at,
      'startDate', ev.date, 'startTime', ev.start_time,
      'endDate', coalesce(ev.end_date, ev.date), 'endTime', ev.end_time,
      'firstSubmissionAt', (select min(created_at) from proj),
      'lastSubmissionAt', (select max(updated_at) from proj),
      'firstReviewAt', (select min(created_at) from public.project_reviews where event_id = p_event),
      'lastReviewAt', (select max(updated_at) from public.project_reviews where event_id = p_event),
      'demoDayStartedAt', (select started_at from public.demo_sessions where event_id = p_event),
      'demoDayEndedAt', (select ended_at from public.demo_sessions where event_id = p_event),
      'resultsPublishedAt', ev.results_published_at
    ),
    'generatedAt', now()
  ) into out;
  return out;
end;
$$;

revoke all on public.hackathon_ideas, public.hackathon_announcements, public.announcement_reads from anon, authenticated;

do $$
declare f text;
begin
  foreach f in array array[
    'public.cf_event_role(uuid, text)', 'public.cf_can_see_announcement(uuid, public.hackathon_announcements)',
    'public.save_announcement(uuid, text, uuid, text, text, text, uuid, boolean, boolean, timestamptz)',
    'public.archive_announcement(uuid, uuid)', 'public.announcements_for(uuid, text, integer, timestamptz)',
    'public.announcement_audience(uuid)', 'public.mark_announcements_read(uuid, text, uuid[])',
    'public.announcement_unread_counts(uuid)', 'public.claim_due_announcements()',
    'public.hackathon_analytics(uuid, text)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
