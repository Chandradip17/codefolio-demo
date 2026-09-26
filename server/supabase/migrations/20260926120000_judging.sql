-- Judging: judge applications → admin approval → judge role; hackathon project
-- submissions; judge assignments; weighted reviews; AI analysis; results.
--
-- Security model (same as the rest of Codefolio): every table below has RLS on and
-- NO policies, and anon/authenticated have no privileges on them. Only the API
-- (service role) reads/writes, through the SECURITY DEFINER functions here, which
-- are executable by service_role only. profiles.is_judge is readable by members
-- but not in their column UPDATE grant, so nobody can make themselves a judge.

-- ---------- judge role ----------
alter table public.profiles add column if not exists is_judge boolean not null default false;
grant select (is_judge) on public.profiles to authenticated;

-- ---------- judge applications ----------
create table if not exists public.judge_applications (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references public.profiles (id) on delete cascade,
  job_title           text not null check (char_length(btrim(job_title)) between 2 and 120),
  organization        text not null check (char_length(btrim(organization)) between 2 and 120),
  experience_years    smallint not null check (experience_years between 0 and 60),
  expertise           text[] not null default '{}' check (cardinality(expertise) <= 20),
  judging_experience  text not null default '' check (char_length(judging_experience) <= 1000),
  reason              text not null check (char_length(btrim(reason)) between 20 and 1500),
  status              text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  admin_notes         text check (admin_notes is null or char_length(admin_notes) <= 500),
  reviewed_by         uuid references public.profiles (id) on delete set null,
  reviewed_at         timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create unique index if not exists judge_applications_one_pending on public.judge_applications (user_id) where status = 'pending';
create index if not exists judge_applications_status_idx on public.judge_applications (status, created_at desc);
alter table public.judge_applications enable row level security;

-- ---------- hackathon projects ----------
alter table public.events add column if not exists results_published_at timestamptz;

create table if not exists public.projects (
  id                 uuid primary key default gen_random_uuid(),
  event_id           text not null references public.events (id) on delete cascade,
  team_id            uuid references public.teams (id) on delete set null,
  submitted_by       uuid not null references public.profiles (id) on delete cascade,
  last_edited_by     uuid references public.profiles (id) on delete set null,
  title              text not null check (char_length(btrim(title)) between 3 and 120),
  problem_statement  text not null check (char_length(btrim(problem_statement)) between 10 and 2000),
  description        text not null check (char_length(btrim(description)) between 30 and 6000),
  tech_stack         text[] not null default '{}' check (cardinality(tech_stack) <= 20),
  github_url         text not null check (github_url ~* '^https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/?$'),
  demo_url           text check (demo_url is null or demo_url ~* '^https?://[^\s]+\.[^\s]+$'),
  video_url          text check (video_url is null or video_url ~* '^https?://[^\s]+\.[^\s]+$'),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create unique index if not exists projects_one_per_team on public.projects (team_id) where team_id is not null;
create unique index if not exists projects_one_per_solo on public.projects (event_id, submitted_by) where team_id is null;
create index if not exists projects_event_idx on public.projects (event_id);
alter table public.projects enable row level security;

-- ---------- judge assignments (per hackathon) ----------
create table if not exists public.judge_assignments (
  event_id     text not null references public.events (id) on delete cascade,
  judge_id     uuid not null references public.profiles (id) on delete cascade,
  assigned_by  uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  primary key (event_id, judge_id)
);
alter table public.judge_assignments enable row level security;

-- ---------- reviews ----------
-- The single source of truth for the weighted score (lib/scoring.js mirrors the weights).
create or replace function public.cf_weighted_score(p_innovation numeric, p_technical numeric, p_impact numeric, p_uiux numeric, p_presentation numeric)
returns numeric language sql immutable as $$
  select round(p_innovation * 0.25 + p_technical * 0.25 + p_impact * 0.20 + p_uiux * 0.15 + p_presentation * 0.15, 2);
$$;

create table if not exists public.project_reviews (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projects (id) on delete cascade,
  event_id      text not null references public.events (id) on delete cascade,
  judge_id      uuid not null references public.profiles (id) on delete cascade,
  innovation    numeric(3, 1) not null check (innovation between 0 and 10),
  technical     numeric(3, 1) not null check (technical between 0 and 10),
  impact        numeric(3, 1) not null check (impact between 0 and 10),
  uiux          numeric(3, 1) not null check (uiux between 0 and 10),
  presentation  numeric(3, 1) not null check (presentation between 0 and 10),
  weighted      numeric(4, 2) generated always as (public.cf_weighted_score(innovation, technical, impact, uiux, presentation)) stored,
  feedback      text not null default '' check (char_length(feedback) <= 4000),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (project_id, judge_id)
);
create index if not exists project_reviews_event_idx on public.project_reviews (event_id);
alter table public.project_reviews enable row level security;

-- ---------- AI / repository analysis ----------
create table if not exists public.project_analysis (
  project_id    uuid primary key references public.projects (id) on delete cascade,
  repo          jsonb,           -- facts from the GitHub API
  ai            jsonb,           -- structured Gemini summary (null if not configured / failed)
  ai_status     text not null default 'pending' check (ai_status in ('pending', 'ready', 'not_configured', 'error')),
  model         text,
  error         text,
  requested_by  uuid references public.profiles (id) on delete set null,
  analyzed_at   timestamptz not null default now()
);
alter table public.project_analysis enable row level security;

revoke all on public.judge_applications, public.projects, public.judge_assignments, public.project_reviews, public.project_analysis from anon, authenticated;

-- =====================================================================
-- Functions (service_role only)
-- =====================================================================

-- Member applies to become a judge.
create or replace function public.request_judge(
  p_user uuid, p_role text, p_org text, p_years integer, p_expertise text[], p_judging text, p_reason text
)
returns public.judge_applications language plpgsql security definer set search_path = public as $$
declare who public.profiles; r public.judge_applications;
begin
  select * into who from public.profiles where id = p_user;
  if not found then perform public.cf_raise('auth/missing', 'Account not found.'); end if;
  if who.is_judge then perform public.cf_raise('judge/already', 'You are already an approved judge.'); end if;
  if exists (select 1 from public.judge_applications where user_id = p_user and status = 'pending') then
    perform public.cf_raise('judge/pending', 'Your judge application is already being reviewed.');
  end if;
  insert into public.judge_applications (user_id, job_title, organization, experience_years, expertise, judging_experience, reason)
  values (p_user, btrim(p_role), btrim(p_org), p_years,
          coalesce((select array_agg(distinct btrim(x)) from unnest(p_expertise) x where btrim(x) <> ''), '{}'),
          btrim(coalesce(p_judging, '')), btrim(p_reason))
  returning * into r;
  return r;
end;
$$;

-- Admin approves / rejects. Approval and the role grant happen in one transaction.
create or replace function public.review_judge_application(p_admin uuid, p_application uuid, p_decision text, p_note text)
returns public.judge_applications language plpgsql security definer set search_path = public as $$
declare r public.judge_applications;
begin
  if not public.cf_is_admin(p_admin) then perform public.cf_raise('auth/forbidden', 'Only platform admins can review judge applications.'); end if;
  if p_decision not in ('approved', 'rejected') then perform public.cf_raise('judge/decision', 'Unknown decision.'); end if;
  select * into r from public.judge_applications where id = p_application for update;
  if not found then perform public.cf_raise('judge/missing', 'Application not found.'); end if;
  if r.user_id = p_admin then perform public.cf_raise('judge/self', 'You can’t review your own application.'); end if;
  if r.status <> 'pending' then perform public.cf_raise('judge/reviewed', format('This application was already %s.', r.status)); end if;

  update public.judge_applications
     set status = p_decision, admin_notes = nullif(btrim(coalesce(p_note, '')), ''),
         reviewed_by = p_admin, reviewed_at = now(), updated_at = now()
   where id = r.id
  returning * into r;
  if p_decision = 'approved' then
    update public.profiles set is_judge = true where id = r.user_id;
  end if;
  return r;
end;
$$;

-- Participant submits / updates their team's (or their own) hackathon project.
create or replace function public.submit_project(
  p_user uuid, p_event text, p_title text, p_problem text, p_description text, p_stack text[],
  p_github text, p_demo text, p_video text
)
returns public.projects language plpgsql security definer set search_path = public as $$
declare ev public.events; b public.bookings; p public.projects;
begin
  select * into ev from public.events where id = p_event;
  if not found or ev.status = 'Draft' then perform public.cf_raise('event/missing', 'Event not found.'); end if;
  if ev.category <> 'hackathon' then perform public.cf_raise('project/not_hackathon', 'Projects can only be submitted to hackathons.'); end if;
  if ev.status = 'Cancelled' then perform public.cf_raise('event/cancelled', 'This hackathon has been cancelled.'); end if;
  if ev.results_published_at is not null then perform public.cf_raise('results/published', 'Results are published, so submissions are closed.'); end if;

  select * into b from public.bookings
   where user_id = p_user and event_id = p_event and status in ('Confirmed', 'Attended')
   order by booked_at desc limit 1;
  if not found then perform public.cf_raise('project/not_participant', 'Only approved participants can submit a project.'); end if;

  if b.team_id is not null then
    select * into p from public.projects where team_id = b.team_id for update;
  else
    select * into p from public.projects where event_id = p_event and submitted_by = p_user and team_id is null for update;
  end if;

  if p.id is not null then
    if exists (select 1 from public.project_reviews where project_id = p.id) then
      perform public.cf_raise('project/locked', 'Judges have started reviewing this project, so it can’t be edited.');
    end if;
    update public.projects
       set title = btrim(p_title), problem_statement = btrim(p_problem), description = btrim(p_description),
           tech_stack = coalesce(p_stack, '{}'), github_url = btrim(p_github),
           demo_url = nullif(btrim(coalesce(p_demo, '')), ''), video_url = nullif(btrim(coalesce(p_video, '')), ''),
           last_edited_by = p_user, updated_at = now()
     where id = p.id
    returning * into p;
  else
    insert into public.projects (event_id, team_id, submitted_by, last_edited_by, title, problem_statement, description,
                                 tech_stack, github_url, demo_url, video_url)
    values (p_event, b.team_id, p_user, p_user, btrim(p_title), btrim(p_problem), btrim(p_description),
            coalesce(p_stack, '{}'), btrim(p_github), nullif(btrim(coalesce(p_demo, '')), ''), nullif(btrim(coalesce(p_video, '')), ''))
    returning * into p;
  end if;
  return p;
end;
$$;

-- Organizer assigns an approved judge to one of their hackathons.
create or replace function public.assign_judge(p_actor uuid, p_event text, p_judge uuid)
returns public.judge_assignments language plpgsql security definer set search_path = public as $$
declare ev public.events; a public.judge_assignments;
begin
  select * into ev from public.events where id = p_event;
  if not found then perform public.cf_raise('event/missing', 'Event not found.'); end if;
  if not public.cf_can_manage_event(p_actor, p_event) then perform public.cf_raise('auth/forbidden', 'Only this hackathon’s organizer can assign judges.'); end if;
  if ev.category <> 'hackathon' then perform public.cf_raise('project/not_hackathon', 'Judges can only be assigned to hackathons.'); end if;
  if not exists (select 1 from public.profiles where id = p_judge and is_judge) then
    perform public.cf_raise('judge/not_approved', 'Only approved judges can be assigned.');
  end if;
  if exists (select 1 from public.bookings where user_id = p_judge and event_id = p_event and status in ('Pending', 'Confirmed', 'Attended')) then
    perform public.cf_raise('judge/conflict', 'This judge is a participant in this hackathon, so they can’t judge it.');
  end if;
  insert into public.judge_assignments (event_id, judge_id, assigned_by) values (p_event, p_judge, p_actor)
  on conflict (event_id, judge_id) do nothing;
  select * into a from public.judge_assignments where event_id = p_event and judge_id = p_judge;
  return a;
end;
$$;

create or replace function public.unassign_judge(p_actor uuid, p_event text, p_judge uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.cf_can_manage_event(p_actor, p_event) then perform public.cf_raise('auth/forbidden', 'Only this hackathon’s organizer can change judges.'); end if;
  if exists (select 1 from public.project_reviews where event_id = p_event and judge_id = p_judge) then
    perform public.cf_raise('judge/has_reviews', 'This judge has already submitted reviews, so they can’t be removed.');
  end if;
  delete from public.judge_assignments where event_id = p_event and judge_id = p_judge;
end;
$$;

-- Judge submits (or updates) their own review. One review per judge per project.
create or replace function public.submit_review(
  p_judge uuid, p_project uuid, p_innovation numeric, p_technical numeric, p_impact numeric,
  p_uiux numeric, p_presentation numeric, p_feedback text
)
returns public.project_reviews language plpgsql security definer set search_path = public as $$
declare p public.projects; ev public.events; r public.project_reviews; s numeric;
begin
  if not exists (select 1 from public.profiles where id = p_judge and is_judge) then
    perform public.cf_raise('auth/forbidden', 'Only approved judges can review projects.');
  end if;
  select * into p from public.projects where id = p_project;
  if not found then perform public.cf_raise('project/missing', 'Project not found.'); end if;
  if not exists (select 1 from public.judge_assignments where event_id = p.event_id and judge_id = p_judge) then
    perform public.cf_raise('judge/not_assigned', 'You are not assigned to judge this hackathon.');
  end if;
  if exists (select 1 from public.bookings where user_id = p_judge and event_id = p.event_id and status in ('Pending', 'Confirmed', 'Attended')) then
    perform public.cf_raise('judge/conflict', 'You are a participant in this hackathon, so you can’t judge it.');
  end if;
  select * into ev from public.events where id = p.event_id;
  if ev.results_published_at is not null then perform public.cf_raise('results/published', 'Results are published; reviews are closed.'); end if;
  foreach s in array array[p_innovation, p_technical, p_impact, p_uiux, p_presentation] loop
    if s is null or s < 0 or s > 10 or s * 10 <> trunc(s * 10) then
      perform public.cf_raise('review/score', 'Each score must be between 0 and 10 (one decimal place).');
    end if;
  end loop;
  if char_length(coalesce(p_feedback, '')) > 4000 then perform public.cf_raise('review/feedback', 'Keep feedback under 4000 characters.'); end if;

  insert into public.project_reviews (project_id, event_id, judge_id, innovation, technical, impact, uiux, presentation, feedback)
  values (p.id, p.event_id, p_judge, p_innovation, p_technical, p_impact, p_uiux, p_presentation, btrim(coalesce(p_feedback, '')))
  on conflict (project_id, judge_id) do update
     set innovation = excluded.innovation, technical = excluded.technical, impact = excluded.impact,
         uiux = excluded.uiux, presentation = excluded.presentation, feedback = excluded.feedback, updated_at = now()
  returning * into r;
  return r;
end;
$$;

-- Organizer publishes (or un-publishes) results.
create or replace function public.publish_results(p_actor uuid, p_event text, p_publish boolean)
returns public.events language plpgsql security definer set search_path = public as $$
declare ev public.events;
begin
  select * into ev from public.events where id = p_event for update;
  if not found then perform public.cf_raise('event/missing', 'Event not found.'); end if;
  if not public.cf_can_manage_event(p_actor, p_event) then perform public.cf_raise('auth/forbidden', 'Only this hackathon’s organizer can publish results.'); end if;
  if ev.category <> 'hackathon' then perform public.cf_raise('project/not_hackathon', 'Only hackathons have results.'); end if;
  if p_publish and not exists (select 1 from public.project_reviews where event_id = p_event) then
    perform public.cf_raise('results/empty', 'No reviews yet: there is nothing to publish.');
  end if;
  update public.events set results_published_at = case when p_publish then now() else null end where id = p_event
  returning * into ev;
  return ev;
end;
$$;

revoke all on function public.request_judge(uuid, text, text, integer, text[], text, text) from public, anon, authenticated;
revoke all on function public.review_judge_application(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.submit_project(uuid, text, text, text, text, text[], text, text, text) from public, anon, authenticated;
revoke all on function public.assign_judge(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.unassign_judge(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.submit_review(uuid, uuid, numeric, numeric, numeric, numeric, numeric, text) from public, anon, authenticated;
revoke all on function public.publish_results(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.request_judge(uuid, text, text, integer, text[], text, text) to service_role;
grant execute on function public.review_judge_application(uuid, uuid, text, text) to service_role;
grant execute on function public.submit_project(uuid, text, text, text, text, text[], text, text, text) to service_role;
grant execute on function public.assign_judge(uuid, text, uuid) to service_role;
grant execute on function public.unassign_judge(uuid, text, uuid) to service_role;
grant execute on function public.submit_review(uuid, uuid, numeric, numeric, numeric, numeric, numeric, text) to service_role;
grant execute on function public.publish_results(uuid, text, boolean) to service_role;
