-- External event listings (e.g. Unstop) — discovery only, never bookable here.
-- Kept apart from public.events, which models Codefolio-hosted events with
-- seats, bookings and owners.
--
-- Deduplication: one row per (source, identity_key). identity_key is the
-- provider's own id when it has one, otherwise a deterministic fingerprint of
-- normalized title + organizer + start date (computed by the API).
--
-- Security: RLS on, no policies, no browser privileges. Only the API (service
-- role) reads/writes; writes go through upsert_external_events().

create table if not exists public.external_events (
  id                     uuid primary key default gen_random_uuid(),
  source                 text not null check (source ~ '^[a-z][a-z0-9_-]{1,30}$'),
  identity_key           text not null check (char_length(identity_key) between 1 and 200),
  external_id            text,
  title                  text not null check (char_length(title) between 2 and 300),
  description            text not null default '' check (char_length(description) <= 20000),
  organizer              text not null default '',
  logo_url               text check (logo_url is null or logo_url ~* '^https://'),
  banner_url             text check (banner_url is null or banner_url ~* '^https://'),
  event_type             text not null check (event_type in ('hackathon', 'competition', 'workshop', 'webinar', 'conference', 'quiz', 'other')),
  mode                   text not null default 'unknown' check (mode in ('online', 'offline', 'hybrid', 'unknown')),
  location               text not null default '',
  start_at               timestamptz,
  end_at                 timestamptz,
  registration_deadline  timestamptz,
  registration_url       text not null check (registration_url ~* '^https://'),
  source_url             text not null check (source_url ~* '^https://'),
  prize                  text not null default '',
  eligibility            text not null default '',
  skills                 text[] not null default '{}',
  tags                   text[] not null default '{}',
  raw_data               jsonb,
  fetched_at             timestamptz not null default now(),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (source, identity_key)
);
create index if not exists external_events_source_deadline on public.external_events (source, registration_deadline);
create index if not exists external_events_source_start on public.external_events (source, start_at);
create index if not exists external_events_source_type on public.external_events (source, event_type);
create index if not exists external_events_fetched on public.external_events (source, fetched_at desc);
alter table public.external_events enable row level security;

-- Last sync outcome per source (for the admin page and troubleshooting).
create table if not exists public.external_sources (
  source           text primary key,
  last_sync_at     timestamptz,
  last_success_at  timestamptz,
  fetched          integer not null default 0,
  upserted         integer not null default 0,
  skipped          integer not null default 0,
  last_error       text,
  updated_at       timestamptz not null default now()
);
alter table public.external_sources enable row level security;

revoke all on public.external_events, public.external_sources from anon, authenticated;

-- Upsert a batch of normalized listings for one source (dedup on identity_key).
-- Returns {inserted, updated}. Rows are replaced wholesale by the provider's data:
-- there are no admin edits to preserve.
create or replace function public.upsert_external_events(p_source text, p_items jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare ins integer := 0; upd integer := 0; x jsonb; was_insert boolean;
begin
  if jsonb_typeof(p_items) <> 'array' then raise exception 'p_items must be a JSON array'; end if;
  for x in select * from jsonb_array_elements(p_items) loop
    insert into public.external_events as t (
      source, identity_key, external_id, title, description, organizer, logo_url, banner_url, event_type, mode, location,
      start_at, end_at, registration_deadline, registration_url, source_url, prize, eligibility, skills, tags, raw_data, fetched_at
    ) values (
      p_source, x ->> 'identityKey', x ->> 'externalId', x ->> 'title', coalesce(x ->> 'description', ''), coalesce(x ->> 'organizer', ''),
      x ->> 'logo', x ->> 'banner', x ->> 'eventType', coalesce(x ->> 'mode', 'unknown'), coalesce(x ->> 'location', ''),
      (x ->> 'startAt')::timestamptz, (x ->> 'endAt')::timestamptz, (x ->> 'registrationDeadline')::timestamptz,
      x ->> 'registrationUrl', x ->> 'sourceUrl', coalesce(x ->> 'prize', ''), coalesce(x ->> 'eligibility', ''),
      coalesce((select array_agg(v) from jsonb_array_elements_text(coalesce(x -> 'skills', '[]'::jsonb)) v), '{}'),
      coalesce((select array_agg(v) from jsonb_array_elements_text(coalesce(x -> 'tags', '[]'::jsonb)) v), '{}'),
      x -> 'raw', coalesce((x ->> 'fetchedAt')::timestamptz, now())
    )
    on conflict (source, identity_key) do update set
      external_id = excluded.external_id, title = excluded.title, description = excluded.description,
      organizer = excluded.organizer, logo_url = excluded.logo_url, banner_url = excluded.banner_url,
      event_type = excluded.event_type, mode = excluded.mode, location = excluded.location,
      start_at = excluded.start_at, end_at = excluded.end_at, registration_deadline = excluded.registration_deadline,
      registration_url = excluded.registration_url, source_url = excluded.source_url, prize = excluded.prize,
      eligibility = excluded.eligibility, skills = excluded.skills, tags = excluded.tags, raw_data = excluded.raw_data,
      fetched_at = excluded.fetched_at, updated_at = now()
    returning (xmax = 0) into was_insert;
    if was_insert then ins := ins + 1; else upd := upd + 1; end if;
  end loop;
  return jsonb_build_object('inserted', ins, 'updated', upd);
end;
$$;

-- Record a sync attempt.
create or replace function public.record_external_sync(p_source text, p_ok boolean, p_fetched integer, p_upserted integer, p_skipped integer, p_error text)
returns void language sql security definer set search_path = public as $$
  insert into public.external_sources as s (source, last_sync_at, last_success_at, fetched, upserted, skipped, last_error, updated_at)
  values (p_source, now(), case when p_ok then now() end, coalesce(p_fetched, 0), coalesce(p_upserted, 0), coalesce(p_skipped, 0),
          case when p_ok then null else left(p_error, 500) end, now())
  on conflict (source) do update set
    last_sync_at = now(),
    last_success_at = case when p_ok then now() else s.last_success_at end,
    fetched = case when p_ok then excluded.fetched else s.fetched end,
    upserted = case when p_ok then excluded.upserted else s.upserted end,
    skipped = case when p_ok then excluded.skipped else s.skipped end,
    last_error = excluded.last_error,
    updated_at = now();
$$;

revoke all on function public.upsert_external_events(text, jsonb) from public, anon, authenticated;
revoke all on function public.record_external_sync(text, boolean, integer, integer, integer, text) from public, anon, authenticated;
grant execute on function public.upsert_external_events(text, jsonb) to service_role;
grant execute on function public.record_external_sync(text, boolean, integer, integer, integer, text) to service_role;
