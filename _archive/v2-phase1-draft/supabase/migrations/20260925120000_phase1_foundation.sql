-- =====================================================================
-- Codefolio v2 · Phase 1: identity foundation
--   profiles (1:1 auth.users), platform roles, onboarding gate,
--   avatar storage, public platform stats.
-- Idempotent: safe to re-apply.
--
-- Security model
--   * RLS on every table. Logged-out (anon) users can read nothing here
--     except platform_stats(), which returns aggregate counts only.
--   * Users can edit only their own profile and only whitelisted columns;
--     `role` is changed exclusively through admin_set_role().
--   * Email addresses live in auth.users, not in the world-readable profile.
-- =====================================================================

-- ---------- enum ----------
do $$ begin
  create type public.platform_role as enum ('user', 'admin');
exception when duplicate_object then null; end $$;

-- ---------- profiles ----------
create table if not exists public.profiles (
  id                    uuid primary key references auth.users (id) on delete cascade,
  username              text unique,
  full_name             text,
  avatar_url            text,
  college               text,
  company               text,
  bio                   text,
  skills                text[] not null default '{}',
  github_url            text,
  linkedin_url          text,
  portfolio_url         text,
  role                  public.platform_role not null default 'user',
  onboarding_completed  boolean not null default false,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint username_format check (username is null or username ~ '^[a-z0-9_]{3,20}$'),
  constraint username_not_reserved check (
    username is null or username not in ('admin', 'root', 'support', 'codefolio', 'api', 'me', 'settings', 'host', 'null', 'undefined')
  ),
  constraint full_name_length check (full_name is null or char_length(full_name) between 2 and 80),
  constraint college_length check (college is null or char_length(college) <= 120),
  constraint company_length check (company is null or char_length(company) <= 120),
  constraint bio_length check (bio is null or char_length(bio) <= 600),
  constraint skills_limit check (cardinality(skills) <= 30),
  constraint github_url_format check (github_url is null or github_url ~* '^https://(www\.)?github\.com/[A-Za-z0-9_.-]+/?$'),
  constraint linkedin_url_format check (linkedin_url is null or linkedin_url ~* '^https://([a-z]{2,3}\.)?linkedin\.com/(in|company)/[^\s/]+/?$'),
  constraint portfolio_url_format check (portfolio_url is null or portfolio_url ~* '^https?://[^\s]+\.[^\s]+$'),
  constraint avatar_url_format check (avatar_url is null or avatar_url ~* '^https://'),
  -- The onboarding gate can't be passed without the minimum identity.
  constraint onboarding_minimum check (not onboarding_completed or (username is not null and full_name is not null))
);

create index if not exists profiles_onboarded_idx on public.profiles (onboarding_completed);
create index if not exists profiles_skills_gin on public.profiles using gin (skills);

-- ---------- helpers ----------
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

-- Is the current request made by a platform admin?
create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = 'admin'
  );
$$;

-- ---------- new auth user → profile row ----------
-- Prefills name/avatar from the OAuth identity (Google gives full_name/name + avatar_url/picture).
-- Never trusts metadata for role or onboarding state.
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  nm   text := nullif(trim(coalesce(meta ->> 'full_name', meta ->> 'name', '')), '');
  av   text := nullif(coalesce(meta ->> 'avatar_url', meta ->> 'picture', ''), '');
begin
  insert into public.profiles (id, full_name, avatar_url)
  values (
    new.id,
    case when char_length(nm) between 2 and 80 then nm end,
    case when av ~* '^https://' then av end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- RLS ----------
alter table public.profiles enable row level security;

drop policy if exists "profiles: signed-in users can read" on public.profiles;
create policy "profiles: signed-in users can read"
  on public.profiles for select to authenticated
  using (true);

drop policy if exists "profiles: users update own" on public.profiles;
create policy "profiles: users update own"
  on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- No insert/delete policies: rows are created by the auth trigger and removed
-- by the auth.users cascade.

-- Column-level privileges: users may edit only these columns (not role).
revoke all on public.profiles from anon;
revoke insert, update, delete on public.profiles from authenticated;
grant select on public.profiles to authenticated;
grant update (username, full_name, avatar_url, college, company, bio, skills,
              github_url, linkedin_url, portfolio_url, onboarding_completed)
  on public.profiles to authenticated;

-- ---------- RPCs ----------
-- Username availability (case-insensitive; usernames are stored lowercase).
create or replace function public.username_available(p_username text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select lower(p_username) ~ '^[a-z0-9_]{3,20}$'
     and lower(p_username) not in ('admin', 'root', 'support', 'codefolio', 'api', 'me', 'settings', 'host', 'null', 'undefined')
     and not exists (
       select 1 from public.profiles
       where username = lower(p_username) and id <> coalesce((select auth.uid()), '00000000-0000-0000-0000-000000000000'::uuid)
     );
$$;
revoke all on function public.username_available(text) from public, anon;
grant execute on function public.username_available(text) to authenticated;

-- Aggregate counts for the public landing page. Extended by later phases.
create or replace function public.platform_stats()
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'members', (select count(*) from public.profiles where onboarding_completed)
  );
$$;
revoke all on function public.platform_stats() from public;
grant execute on function public.platform_stats() to anon, authenticated;

-- Admin-only role management (the only way to change `role`).
create or replace function public.admin_set_role(p_user uuid, p_role public.platform_role)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception using errcode = '42501', message = 'Only admins can change roles.';
  end if;
  if p_user = (select auth.uid()) and p_role <> 'admin' then
    raise exception using errcode = '42501', message = 'Admins cannot remove their own admin role.';
  end if;
  update public.profiles set role = p_role where id = p_user;
end;
$$;
revoke all on function public.admin_set_role(uuid, public.platform_role) from public, anon;
grant execute on function public.admin_set_role(uuid, public.platform_role) to authenticated;

revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

-- ---------- storage: avatars ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2 * 1024 * 1024, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Objects are stored as avatars/<user-id>/<file>; users manage only their folder.
drop policy if exists "avatars: users upload to own folder" on storage.objects;
create policy "avatars: users upload to own folder"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "avatars: users update own files" on storage.objects;
create policy "avatars: users update own files"
  on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "avatars: users delete own files" on storage.objects;
create policy "avatars: users delete own files"
  on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
