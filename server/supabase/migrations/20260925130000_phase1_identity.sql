-- =====================================================================
-- Phase 1 · identity: usernames + onboarding, direct profile reads under
-- RLS, avatar storage, real landing stats, trusted roles.
-- Additive only: no columns dropped or renamed. Idempotent.
-- =====================================================================

-- ---------- profile fields for onboarding ----------
alter table public.profiles
  add column if not exists username             text,
  add column if not exists avatar_url           text,
  add column if not exists college              text,
  add column if not exists company              text,
  add column if not exists skills               text[] not null default '{}',
  add column if not exists github_url           text,
  add column if not exists linkedin_url         text,
  add column if not exists portfolio_url        text,
  add column if not exists platform_role        text not null default 'user',
  add column if not exists onboarding_completed boolean not null default false,
  add column if not exists updated_at           timestamptz not null default now();

-- Backfill existing accounts so nobody is locked out: username from the email
-- local part (sanitised, de-duplicated), and mark them onboarded.
with base as (
  select id,
         left(regexp_replace(lower(split_part(email, '@', 1)), '[^a-z0-9_]', '_', 'g'), 16) as raw
  from public.profiles
  where username is null
), padded as (
  select id, case when length(raw) < 3 then raw || '_cf' else raw end as u from base
), numbered as (
  select id, u, row_number() over (partition by u order by id) as n from padded
)
update public.profiles p
   set username = case when n = 1 and not exists (select 1 from public.profiles x where x.username = numbered.u)
                       then numbered.u else numbered.u || n::text end,
       onboarding_completed = true
  from numbered
 where p.id = numbered.id;

do $$ begin
  alter table public.profiles add constraint profiles_username_key unique (username);
exception when duplicate_table or duplicate_object then null; end $$;

do $$ begin
  alter table public.profiles
    add constraint username_format check (username is null or username ~ '^[a-z0-9_]{3,20}$'),
    add constraint username_not_reserved check (username is null or username not in
      ('admin','root','support','codefolio','api','me','settings','host','null','undefined')),
    add constraint platform_role_valid check (platform_role in ('user', 'admin')),
    add constraint college_length check (college is null or char_length(college) <= 120),
    add constraint company_length check (company is null or char_length(company) <= 120),
    add constraint bio_length check (char_length(bio) <= 600),
    add constraint skills_limit check (cardinality(skills) <= 30),
    add constraint github_url_format check (github_url is null or github_url ~* '^https://(www\.)?github\.com/[A-Za-z0-9_.-]+/?$'),
    add constraint linkedin_url_format check (linkedin_url is null or linkedin_url ~* '^https://([a-z]{2,3}\.)?linkedin\.com/(in|company)/[^\s/]+/?$'),
    add constraint portfolio_url_format check (portfolio_url is null or portfolio_url ~* '^https?://[^\s]+\.[^\s]+$'),
    add constraint avatar_url_format check (avatar_url is null or avatar_url ~* '^https://'),
    add constraint onboarding_minimum check (not onboarding_completed or username is not null);
exception when duplicate_object then null; end $$;

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists profiles_updated_at on public.profiles;
create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- ---------- new auth user → profile (never trusts user-editable metadata for roles) ----------
-- user_metadata can be set by the user themselves (e.g. signInWithOtp options.data), so the
-- organizer role only comes from app_metadata, which only the server (service role) can write.
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  app  jsonb := coalesce(new.raw_app_meta_data, '{}'::jsonb);
  nm   text := nullif(trim(coalesce(meta ->> 'name', meta ->> 'full_name', '')), '');
  av   text := nullif(coalesce(meta ->> 'avatar_url', meta ->> 'picture', ''), '');
begin
  if nm is null or char_length(nm) < 2 then nm := initcap(split_part(new.email, '@', 1)); end if;
  if char_length(nm) < 2 then nm := 'New member'; end if;
  insert into public.profiles (id, name, email, role, city, chapter, bio, avatar_url, onboarding_completed)
  values (
    new.id,
    left(nm, 80),
    new.email,
    case when app ->> 'cf_role' = 'organizer' then 'organizer' else 'attendee' end,
    coalesce(meta ->> 'city', ''),
    coalesce(meta ->> 'chapter', ''),
    left(coalesce(meta ->> 'bio', ''), 600),
    case when av ~* '^https://' then av end,
    false
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- ---------- RLS: signed-in members can read profiles (not emails); edit only their own ----------
drop policy if exists "profiles: members read" on public.profiles;
create policy "profiles: members read" on public.profiles
  for select to authenticated using (true);

drop policy if exists "profiles: update own" on public.profiles;
create policy "profiles: update own" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

revoke all on public.profiles from anon;
revoke select, insert, update, delete on public.profiles from authenticated;
grant select (id, name, username, avatar_url, college, company, bio, skills, github_url, linkedin_url,
              portfolio_url, city, chapter, role, platform_role, onboarding_completed, created_at, updated_at)
  on public.profiles to authenticated;
grant update (name, username, avatar_url, college, company, bio, skills, github_url, linkedin_url,
              portfolio_url, city, chapter, onboarding_completed)
  on public.profiles to authenticated;

-- ---------- helpers / RPCs ----------
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = (select auth.uid()) and platform_role = 'admin');
$$;
revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

create or replace function public.username_available(p_username text)
returns boolean language sql stable security definer set search_path = public as $$
  select lower(p_username) ~ '^[a-z0-9_]{3,20}$'
     and lower(p_username) not in ('admin','root','support','codefolio','api','me','settings','host','null','undefined')
     and not exists (
       select 1 from public.profiles
       where username = lower(p_username)
         and id <> coalesce((select auth.uid()), '00000000-0000-0000-0000-000000000000'::uuid)
     );
$$;
revoke all on function public.username_available(text) from public, anon;
grant execute on function public.username_available(text) to authenticated;

-- Real numbers for the public landing page. Sample (demo) content is excluded,
-- and "members" only counts people who have actually signed in.
create or replace function public.platform_stats()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'members', (select count(*) from public.profiles p join auth.users u on u.id = p.id
                 where p.onboarding_completed and u.last_sign_in_at is not null),
    'events_hosted', (select count(*) from public.events where not is_sample),
    'seats_booked', (select coalesce(sum(b.seats), 0) from public.bookings b
                      join public.events e on e.id = b.event_id
                      where not e.is_sample and b.status in ('Confirmed', 'Attended')),
    'cities', (select count(distinct city) from public.events where not is_sample)
  );
$$;
revoke all on function public.platform_stats() from public;
grant execute on function public.platform_stats() to anon, authenticated;

-- ---------- storage: avatars (public read by URL; users write only their own folder) ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2 * 1024 * 1024, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "avatars: upload own folder" on storage.objects;
create policy "avatars: upload own folder" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "avatars: update own files" on storage.objects;
create policy "avatars: update own files" on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "avatars: delete own files" on storage.objects;
create policy "avatars: delete own files" on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
