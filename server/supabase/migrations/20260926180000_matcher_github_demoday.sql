-- Team Matcher · GitHub integration · Demo Day
--
-- Same security model as the rest of Codefolio: RLS on, no policies, no browser
-- privileges on any table below. The API (service role) reads/writes; every rule
-- lives in the SECURITY DEFINER functions here (service_role only).

-- =====================================================================
-- Team Matcher
-- =====================================================================
create table if not exists public.team_preferences (
  user_id           uuid not null references public.profiles (id) on delete cascade,
  event_id          text not null references public.events (id) on delete cascade,
  skills            text[] not null default '{}' check (cardinality(skills) <= 30),
  looking_for       text[] not null default '{}' check (cardinality(looking_for) <= 15),
  experience_level  text not null check (experience_level in ('beginner', 'intermediate', 'advanced')),
  availability      text not null check (availability in ('full_time', 'part_time', 'flexible')),
  goal              text not null default 'learn' check (goal in ('win', 'learn', 'build', 'network')),
  interests         text[] not null default '{}' check (cardinality(interests) <= 15),
  about             text not null default '' check (char_length(about) <= 500),
  is_available      boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  primary key (user_id, event_id)
);
create index if not exists team_preferences_event_available on public.team_preferences (event_id) where is_available;
alter table public.team_preferences enable row level security;

create table if not exists public.team_requests (
  id            uuid primary key default gen_random_uuid(),
  event_id      text not null references public.events (id) on delete cascade,
  sender_id     uuid not null references public.profiles (id) on delete cascade,
  receiver_id   uuid not null references public.profiles (id) on delete cascade,
  message       text not null default '' check (char_length(message) <= 300),
  status        text not null default 'pending' check (status in ('pending', 'accepted', 'rejected', 'cancelled')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  responded_at  timestamptz,
  check (sender_id <> receiver_id)
);
-- At most one pending request between two people per hackathon (either direction).
create unique index if not exists team_requests_one_pending
  on public.team_requests (event_id, least(sender_id, receiver_id), greatest(sender_id, receiver_id)) where status = 'pending';
create index if not exists team_requests_receiver on public.team_requests (receiver_id, status);
create index if not exists team_requests_sender on public.team_requests (sender_id, status);
alter table public.team_requests enable row level security;

-- The member's live team in a hackathon (null if none), with size and limit.
create or replace function public.cf_member_team(p_user uuid, p_event text)
returns table (team_id uuid, size integer, max_size integer) language sql stable set search_path = public as $$
  select m.team_id,
         (select count(*)::int from public.team_members x where x.team_id = m.team_id),
         coalesce((select team_max from public.events where id = p_event), 4)::int
    from public.team_members m
   where m.user_id = p_user and m.event_id = p_event
$$;

create or replace function public.cf_team_full(p_user uuid, p_event text)
returns boolean language sql stable set search_path = public as $$
  select coalesce((select size >= max_size from public.cf_member_team(p_user, p_event)), false)
$$;

create or replace function public.save_team_preferences(
  p_user uuid, p_event text, p_skills text[], p_looking_for text[], p_experience text, p_availability text,
  p_goal text, p_interests text[], p_about text, p_available boolean
)
returns public.team_preferences language plpgsql security definer set search_path = public as $$
declare ev public.events; r public.team_preferences;
begin
  select * into ev from public.events where id = p_event;
  if not found or ev.status = 'Draft' then perform public.cf_raise('event/missing', 'Hackathon not found.'); end if;
  if ev.category <> 'hackathon' then perform public.cf_raise('project/not_hackathon', 'Team matching is only for hackathons.'); end if;
  if ev.status = 'Cancelled' or coalesce(ev.end_date, ev.date) < current_date then
    perform public.cf_raise('event/closed', 'This hackathon is over or cancelled.');
  end if;
  if coalesce(ev.team_max, 4) < 2 then perform public.cf_raise('team/solo_only', 'This hackathon is solo only.'); end if;
  insert into public.team_preferences as t (user_id, event_id, skills, looking_for, experience_level, availability, goal, interests, about, is_available)
  values (p_user, p_event, coalesce(p_skills, '{}'), coalesce(p_looking_for, '{}'), p_experience, p_availability, p_goal,
          coalesce(p_interests, '{}'), btrim(coalesce(p_about, '')), coalesce(p_available, true))
  on conflict (user_id, event_id) do update set
    skills = excluded.skills, looking_for = excluded.looking_for, experience_level = excluded.experience_level,
    availability = excluded.availability, goal = excluded.goal, interests = excluded.interests, about = excluded.about,
    is_available = excluded.is_available, updated_at = now()
  returning * into r;
  return r;
end;
$$;

-- Candidates for matching, filtered in the database: same hackathon, open to
-- matching, not me, not already my teammate, not in a full team, and no pending /
-- accepted request between us already handled elsewhere (they're shown with it).
create or replace function public.team_match_candidates(p_user uuid, p_event text, p_limit integer)
returns table (
  user_id uuid, name text, username text, avatar_url text, college text, company text,
  skills text[], looking_for text[], experience_level text, availability text, goal text, interests text[], about text,
  team_id uuid, team_size integer, team_max integer
) language sql stable security definer set search_path = public as $$
  select p.user_id, pr.name, pr.username, pr.avatar_url, pr.college, pr.company,
         p.skills, p.looking_for, p.experience_level, p.availability, p.goal, p.interests, p.about,
         mt.team_id, mt.size, coalesce(mt.max_size, coalesce((select team_max from public.events where id = p_event), 4)::int)
    from public.team_preferences p
    join public.profiles pr on pr.id = p.user_id
    left join lateral public.cf_member_team(p.user_id, p_event) mt on true
   where p.event_id = p_event
     and p.is_available
     and p.user_id <> p_user
     and not coalesce(mt.size >= mt.max_size, false)
     and not exists (
       select 1 from public.team_members a join public.team_members b on a.team_id = b.team_id
        where a.user_id = p_user and b.user_id = p.user_id and a.event_id = p_event)
   order by p.updated_at desc
   limit greatest(1, least(coalesce(p_limit, 300), 500))
$$;

create or replace function public.send_team_request(p_sender uuid, p_event text, p_receiver uuid, p_message text)
returns public.team_requests language plpgsql security definer set search_path = public as $$
declare r public.team_requests; s_team uuid; rc_team uuid;
begin
  if p_sender = p_receiver then perform public.cf_raise('team/self', 'You can’t invite yourself.'); end if;
  if not exists (select 1 from public.team_preferences where user_id = p_sender and event_id = p_event) then
    perform public.cf_raise('team/no_preferences', 'Save your team preferences for this hackathon first.');
  end if;
  if not exists (select 1 from public.team_preferences where user_id = p_receiver and event_id = p_event and is_available) then
    perform public.cf_raise('team/unavailable', 'This person isn’t open to team invitations for this hackathon.');
  end if;
  if public.cf_team_full(p_receiver, p_event) then perform public.cf_raise('team/full', 'Their team is already full.'); end if;
  if public.cf_team_full(p_sender, p_event) then perform public.cf_raise('team/full', 'Your team is already full.'); end if;
  select team_id into s_team from public.cf_member_team(p_sender, p_event);
  select team_id into rc_team from public.cf_member_team(p_receiver, p_event);
  if s_team is not null and s_team = rc_team then perform public.cf_raise('team/already_teammates', 'You’re already on the same team.'); end if;
  if s_team is not null and rc_team is not null then
    perform public.cf_raise('team/both_in_teams', 'You’re both already in different teams.');
  end if;
  if exists (select 1 from public.team_requests where event_id = p_event and status = 'pending'
              and least(sender_id, receiver_id) = least(p_sender, p_receiver) and greatest(sender_id, receiver_id) = greatest(p_sender, p_receiver)) then
    perform public.cf_raise('team/request_exists', 'There’s already a pending invitation between you two.');
  end if;
  if exists (select 1 from public.team_requests where event_id = p_event and status = 'accepted'
              and least(sender_id, receiver_id) = least(p_sender, p_receiver) and greatest(sender_id, receiver_id) = greatest(p_sender, p_receiver)) then
    perform public.cf_raise('team/already_connected', 'You’ve already teamed up with this person.');
  end if;
  if (select count(*) from public.team_requests where sender_id = p_sender and event_id = p_event and status = 'pending') >= 20 then
    perform public.cf_raise('team/too_many', 'You have 20 pending invitations. Wait for replies or cancel some first.');
  end if;
  insert into public.team_requests (event_id, sender_id, receiver_id, message)
  values (p_event, p_sender, p_receiver, btrim(coalesce(p_message, '')))
  returning * into r;
  return r;
end;
$$;

create or replace function public.respond_team_request(p_user uuid, p_request uuid, p_action text)
returns public.team_requests language plpgsql security definer set search_path = public as $$
declare r public.team_requests; s_team uuid; rc_team uuid;
begin
  select * into r from public.team_requests where id = p_request for update;
  if not found or (r.sender_id <> p_user and r.receiver_id <> p_user) then
    perform public.cf_raise('team/request_missing', 'Invitation not found.');
  end if;
  if r.status <> 'pending' then perform public.cf_raise('team/request_closed', format('This invitation was already %s.', r.status)); end if;
  if p_action = 'cancel' then
    if r.sender_id <> p_user then perform public.cf_raise('auth/forbidden', 'Only the sender can cancel an invitation.'); end if;
    update public.team_requests set status = 'cancelled', updated_at = now(), responded_at = now() where id = r.id returning * into r;
  elsif p_action in ('accept', 'reject') then
    if r.receiver_id <> p_user then perform public.cf_raise('auth/forbidden', 'Only the person invited can answer.'); end if;
    if p_action = 'accept' then
      if public.cf_team_full(r.sender_id, r.event_id) or public.cf_team_full(r.receiver_id, r.event_id) then
        perform public.cf_raise('team/full', 'One of your teams is already full.');
      end if;
      select team_id into s_team from public.cf_member_team(r.sender_id, r.event_id);
      select team_id into rc_team from public.cf_member_team(r.receiver_id, r.event_id);
      if s_team is not null and rc_team is not null and s_team <> rc_team then
        perform public.cf_raise('team/both_in_teams', 'You’re both already in different teams.');
      end if;
    end if;
    update public.team_requests set status = case when p_action = 'accept' then 'accepted' else 'rejected' end,
           updated_at = now(), responded_at = now()
     where id = r.id returning * into r;
  else
    perform public.cf_raise('team/decision', 'Unknown action.');
  end if;
  return r;
end;
$$;

-- =====================================================================
-- GitHub
-- =====================================================================
create table if not exists public.github_connections (
  user_id           uuid primary key references public.profiles (id) on delete cascade,
  github_user_id    bigint not null,
  github_username   text not null,
  access_token_enc  text not null,          -- AES-256-GCM, key only in the API's environment
  scopes            text not null default '',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
alter table public.github_connections enable row level security;

create table if not exists public.project_repositories (
  project_id      uuid primary key references public.projects (id) on delete cascade,
  github_repo_id  bigint not null,
  owner           text not null,
  repo_name       text not null,
  repository_url  text not null check (repository_url ~* '^https://github\.com/'),
  description     text not null default '',
  default_branch  text not null default 'main',
  visibility      text not null default 'public' check (visibility in ('public', 'private', 'internal')),
  languages       jsonb not null default '{}',
  stats           jsonb not null default '{}',
  access          text not null default 'public' check (access in ('public', 'oauth')),
  connected_by    uuid references public.profiles (id) on delete set null,
  last_synced_at  timestamptz,
  sync_error      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
alter table public.project_repositories enable row level security;

create table if not exists public.github_activity (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references public.projects (id) on delete cascade,
  activity_type  text not null check (activity_type in ('commit', 'pull_request', 'issue')),
  external_id    text not null,
  actor          text not null default '',
  message        text not null default '' check (char_length(message) <= 500),
  activity_url   text,
  activity_time  timestamptz,
  created_at     timestamptz not null default now(),
  unique (project_id, activity_type, external_id)
);
create index if not exists github_activity_recent on public.github_activity (project_id, activity_time desc);
alter table public.github_activity enable row level security;

-- =====================================================================
-- Demo Day
-- =====================================================================
create table if not exists public.demo_sessions (
  id                     uuid primary key default gen_random_uuid(),
  event_id               text not null unique references public.events (id) on delete cascade,
  status                 text not null default 'draft' check (status in ('draft', 'live', 'ended')),
  presentation_seconds   integer not null default 300 check (presentation_seconds between 60 and 3600),
  qa_seconds             integer not null default 120 check (qa_seconds between 0 and 1800),
  current_presentation_id uuid,
  phase                  text not null default 'idle' check (phase in ('idle', 'presenting', 'qa')),
  phase_started_at       timestamptz,
  paused_at              timestamptz,
  paused_seconds         integer not null default 0,
  created_by             uuid references public.profiles (id) on delete set null,
  started_at             timestamptz,
  ended_at               timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
alter table public.demo_sessions enable row level security;

create table if not exists public.demo_presentations (
  id            uuid primary key default gen_random_uuid(),
  session_id    uuid not null references public.demo_sessions (id) on delete cascade,
  project_id    uuid not null references public.projects (id) on delete cascade,
  order_number  integer not null check (order_number > 0),
  status        text not null default 'waiting' check (status in ('waiting', 'presenting', 'qa', 'completed', 'skipped')),
  started_at    timestamptz,
  qa_started_at timestamptz,
  ended_at      timestamptz,
  created_at    timestamptz not null default now(),
  unique (session_id, project_id)
);
create unique index if not exists demo_presentations_order on public.demo_presentations (session_id, order_number);
alter table public.demo_presentations enable row level security;
do $$ begin
  alter table public.demo_sessions
    add constraint demo_sessions_current_fk foreign key (current_presentation_id) references public.demo_presentations (id) on delete set null;
exception when duplicate_object then null; end $$;

-- A judge's private notes on a project (only that judge ever reads them).
create table if not exists public.judge_notes (
  judge_id    uuid not null references public.profiles (id) on delete cascade,
  project_id  uuid not null references public.projects (id) on delete cascade,
  notes       text not null default '' check (char_length(notes) <= 5000),
  updated_at  timestamptz not null default now(),
  primary key (judge_id, project_id)
);
alter table public.judge_notes enable row level security;

-- Create / update the session and its finalist queue. Durations can change any
-- time; the queue: presentations that already ran stay put, waiting ones follow
-- in the given order.
create or replace function public.demo_save_session(
  p_actor uuid, p_event text, p_presentation_seconds integer, p_qa_seconds integer, p_projects uuid[]
)
returns public.demo_sessions language plpgsql security definer set search_path = public as $$
declare s public.demo_sessions; ev public.events; pid uuid; n integer := 0;
begin
  select * into ev from public.events where id = p_event;
  if not found then perform public.cf_raise('event/missing', 'Hackathon not found.'); end if;
  if not public.cf_can_manage_event(p_actor, p_event) then perform public.cf_raise('auth/forbidden', 'Only this hackathon’s organizer can run Demo Day.'); end if;
  if ev.category <> 'hackathon' then perform public.cf_raise('project/not_hackathon', 'Demo Day is for hackathons.'); end if;
  if exists (select 1 from unnest(coalesce(p_projects, '{}')) x where not exists (select 1 from public.projects p where p.id = x and p.event_id = p_event)) then
    perform public.cf_raise('demo/bad_project', 'Every finalist must be a project submitted to this hackathon.');
  end if;
  if cardinality(coalesce(p_projects, '{}')) <> (select count(distinct x) from unnest(coalesce(p_projects, '{}')) x) then
    perform public.cf_raise('demo/duplicate', 'A project is listed twice.');
  end if;

  insert into public.demo_sessions (event_id, presentation_seconds, qa_seconds, created_by)
  values (p_event, p_presentation_seconds, p_qa_seconds, p_actor)
  on conflict (event_id) do update set presentation_seconds = excluded.presentation_seconds, qa_seconds = excluded.qa_seconds, updated_at = now()
  returning * into s;
  if s.status = 'ended' then perform public.cf_raise('demo/ended', 'This Demo Day has ended.'); end if;

  -- Drop waiting finalists that were removed; ran/skipped ones are history and stay.
  delete from public.demo_presentations
   where session_id = s.id and status = 'waiting' and not (project_id = any (coalesce(p_projects, '{}')));
  -- Renumber: move everything out of the way, then history first, then the new order.
  update public.demo_presentations set order_number = order_number + 100000 where session_id = s.id;
  for pid in select id from public.demo_presentations where session_id = s.id and status <> 'waiting' order by order_number loop
    n := n + 1;
    update public.demo_presentations set order_number = n where id = pid;
  end loop;
  foreach pid in array coalesce(p_projects, '{}') loop
    if exists (select 1 from public.demo_presentations where session_id = s.id and project_id = pid and status <> 'waiting') then continue; end if;
    n := n + 1;
    insert into public.demo_presentations (session_id, project_id, order_number) values (s.id, pid, n)
    on conflict (session_id, project_id) do update set order_number = excluded.order_number;
  end loop;
  select * into s from public.demo_sessions where id = s.id;
  return s;
end;
$$;

-- Every Demo Day control is one atomic transition stamped with the DATABASE clock.
create or replace function public.demo_control(p_actor uuid, p_session uuid, p_action text, p_presentation uuid)
returns public.demo_sessions language plpgsql security definer set search_path = public as $$
declare s public.demo_sessions; cur public.demo_presentations; nxt public.demo_presentations; t timestamptz := now();
begin
  select * into s from public.demo_sessions where id = p_session for update;
  if not found then perform public.cf_raise('demo/missing', 'Demo Day session not found.'); end if;
  if not public.cf_can_manage_event(p_actor, s.event_id) then perform public.cf_raise('auth/forbidden', 'Only this hackathon’s organizer can control Demo Day.'); end if;
  if s.current_presentation_id is not null then select * into cur from public.demo_presentations where id = s.current_presentation_id for update; end if;

  if p_action = 'start_session' then
    if s.status <> 'draft' then perform public.cf_raise('demo/state', 'The session has already started.'); end if;
    if not exists (select 1 from public.demo_presentations where session_id = s.id) then perform public.cf_raise('demo/empty', 'Add finalists before starting.'); end if;
    update public.demo_sessions set status = 'live', started_at = t, updated_at = t where id = s.id;

  elsif p_action in ('start', 'next') then
    if s.status <> 'live' then perform public.cf_raise('demo/state', 'Start the session first.'); end if;
    if cur.id is not null then
      if p_action = 'start' then perform public.cf_raise('demo/busy', 'A presentation is running. End it first.'); end if;
      update public.demo_presentations set status = 'completed', ended_at = t where id = cur.id;
    end if;
    if p_presentation is not null then
      select * into nxt from public.demo_presentations where id = p_presentation and session_id = s.id for update;
      if not found then perform public.cf_raise('demo/missing', 'That finalist isn’t in this session.'); end if;
      if nxt.status <> 'waiting' then perform public.cf_raise('demo/state', 'That team has already presented.'); end if;
    else
      select * into nxt from public.demo_presentations where session_id = s.id and status = 'waiting' order by order_number limit 1 for update;
    end if;
    if nxt.id is null then
      update public.demo_sessions set current_presentation_id = null, phase = 'idle', phase_started_at = null, paused_at = null, paused_seconds = 0, updated_at = t where id = s.id;
    else
      update public.demo_presentations set status = 'presenting', started_at = t where id = nxt.id;
      update public.demo_sessions set current_presentation_id = nxt.id, phase = 'presenting', phase_started_at = t,
             paused_at = null, paused_seconds = 0, updated_at = t where id = s.id;
    end if;

  elsif p_action = 'qa' then
    if cur.id is null or cur.status <> 'presenting' then perform public.cf_raise('demo/state', 'Q&A starts after a presentation.'); end if;
    update public.demo_presentations set status = 'qa', qa_started_at = t where id = cur.id;
    update public.demo_sessions set phase = 'qa', phase_started_at = t, paused_at = null, paused_seconds = 0, updated_at = t where id = s.id;

  elsif p_action = 'end' then
    if cur.id is null then perform public.cf_raise('demo/state', 'Nothing is presenting.'); end if;
    update public.demo_presentations set status = 'completed', ended_at = t where id = cur.id;
    update public.demo_sessions set current_presentation_id = null, phase = 'idle', phase_started_at = null, paused_at = null, paused_seconds = 0, updated_at = t where id = s.id;

  elsif p_action = 'skip' then
    select * into nxt from public.demo_presentations where id = coalesce(p_presentation, cur.id) and session_id = s.id for update;
    if nxt.id is null or nxt.status in ('completed', 'skipped') then perform public.cf_raise('demo/state', 'Nothing to skip.'); end if;
    update public.demo_presentations set status = 'skipped', ended_at = t where id = nxt.id;
    if nxt.id = cur.id then
      update public.demo_sessions set current_presentation_id = null, phase = 'idle', phase_started_at = null, paused_at = null, paused_seconds = 0, updated_at = t where id = s.id;
    end if;

  elsif p_action = 'pause' then
    if s.phase = 'idle' or s.paused_at is not null then perform public.cf_raise('demo/state', 'Nothing to pause.'); end if;
    update public.demo_sessions set paused_at = t, updated_at = t where id = s.id;

  elsif p_action = 'resume' then
    if s.paused_at is null then perform public.cf_raise('demo/state', 'The timer isn’t paused.'); end if;
    update public.demo_sessions set paused_seconds = paused_seconds + floor(extract(epoch from (t - paused_at)))::int, paused_at = null, updated_at = t where id = s.id;

  elsif p_action = 'end_session' then
    if s.status <> 'live' then perform public.cf_raise('demo/state', 'The session isn’t live.'); end if;
    if cur.id is not null then update public.demo_presentations set status = 'completed', ended_at = t where id = cur.id; end if;
    update public.demo_sessions set status = 'ended', ended_at = t, current_presentation_id = null, phase = 'idle',
           phase_started_at = null, paused_at = null, paused_seconds = 0, updated_at = t where id = s.id;
  else
    perform public.cf_raise('demo/action', 'Unknown action.');
  end if;

  select * into s from public.demo_sessions where id = p_session;
  return s;
end;
$$;

revoke all on public.team_preferences, public.team_requests, public.github_connections, public.project_repositories,
  public.github_activity, public.demo_sessions, public.demo_presentations, public.judge_notes from anon, authenticated;

do $$
declare f text;
begin
  foreach f in array array[
    'public.cf_member_team(uuid, text)', 'public.cf_team_full(uuid, text)',
    'public.save_team_preferences(uuid, text, text[], text[], text, text, text, text[], text, boolean)',
    'public.team_match_candidates(uuid, text, integer)', 'public.send_team_request(uuid, text, uuid, text)',
    'public.respond_team_request(uuid, uuid, text)', 'public.demo_save_session(uuid, text, integer, integer, uuid[])',
    'public.demo_control(uuid, uuid, text, uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
