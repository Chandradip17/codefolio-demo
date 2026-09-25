// Applies schema.sql + every migration to an in-memory Postgres with stand-ins
// for Supabase's auth/storage schemas and roles, then checks Phase 1 RLS and
// invariants as the real `anon` / `authenticated` roles.   npm run test:phase1
import { readdir, readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  create schema auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text unique,
    raw_user_meta_data jsonb default '{}', raw_app_meta_data jsonb default '{}', last_sign_in_at timestamptz);
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;
  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
  alter table storage.objects enable row level security;
  create function storage.foldername(name text) returns text[] language sql immutable as
    $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
  grant usage on schema storage to authenticated; grant all on storage.objects to authenticated;
  grant execute on function storage.foldername(text) to authenticated;
`)

const base = await readFile(new URL('../supabase/schema.sql', import.meta.url), 'utf8')
await db.exec(base)

// Existing v1 accounts before the migration (to test the backfill).
const pre = async (email, name, role = 'attendee') => {
  const id = (await db.query(`insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id`, [email, { name, role }])).rows[0].id
  return id
}
const demo = await pre('demo@codefolio.dev', 'Aditi Rao')
await pre('aarav.m@example.com', 'Aarav Mehta')
await pre('a@x.io', 'Short Local')

const dir = new URL('../supabase/migrations/', import.meta.url)
for (const f of (await readdir(dir)).filter((x) => x.endsWith('.sql')).sort()) {
  const sql = await readFile(new URL(f, dir), 'utf8')
  await db.exec(sql)
  await db.exec(sql)
  console.log(`applied ${f} (twice)`)
}

let passed = 0
const test = async (name, fn) => {
  try {
    await fn()
    passed++
    console.log(`  ✓ ${name}`)
  } catch (e) {
    console.log(`  ✗ ${name}\n      ${e.message}`)
    process.exitCode = 1
  }
}
async function as(role, uid, sql, params) {
  await db.exec('begin')
  try {
    await db.query(`select set_config('role', $1, true), set_config('request.jwt.claim.sub', $2, true)`, [role, uid || ''])
    const r = await db.query(sql, params)
    await db.exec('commit')
    return r.rows
  } catch (e) {
    await db.exec('rollback')
    throw e
  }
}
const rejects = async (p, re) => {
  try {
    await p
  } catch (e) {
    if (re) assert.match(e.message, re)
    return
  }
  assert.fail('expected an error')
}
const one = async (sql, p) => (await db.query(sql, p)).rows[0]

console.log('\nPhase 1 identity')
await test('existing accounts backfilled with usernames and marked onboarded', async () => {
  const rows = (await db.query(`select email, username, onboarding_completed from public.profiles order by email`)).rows
  assert.deepEqual(
    rows.map((r) => [r.email, r.username, r.onboarding_completed]),
    [
      ['a@x.io', 'a_cf', true],
      ['aarav.m@example.com', 'aarav_m', true],
      ['demo@codefolio.dev', 'demo', true],
    ],
  )
})

const otp = (await db.query(`insert into auth.users (email, raw_user_meta_data) values ('new@gmail.com', '{"role":"organizer","full_name":"Nisha K","picture":"https://lh3.googleusercontent.com/a/b"}') returning id`)).rows[0].id
await test('new signups: not onboarded; Google name/photo prefilled; role NOT taken from user_metadata', async () => {
  const p = await one(`select name, avatar_url, role, onboarding_completed, username from public.profiles where id = $1`, [otp])
  assert.deepEqual(p, { name: 'Nisha K', avatar_url: 'https://lh3.googleusercontent.com/a/b', role: 'attendee', onboarding_completed: false, username: null })
})
await test('organizer role only via app_metadata (server-set)', async () => {
  const id = (await db.query(`insert into auth.users (email, raw_app_meta_data) values ('org2@x.dev', '{"cf_role":"organizer"}') returning id`)).rows[0].id
  assert.equal((await one(`select role from public.profiles where id = $1`, [id])).role, 'organizer')
})
await test('logged-out users cannot read profiles', async () => {
  await rejects(as('anon', null, `select id from public.profiles`), /permission denied/)
})
await test('members can read profiles but not emails', async () => {
  const rows = await as('authenticated', otp, `select id, username, name from public.profiles`)
  assert.ok(rows.length >= 4)
  await rejects(as('authenticated', otp, `select email from public.profiles`), /permission denied/)
})
await test('cannot finish onboarding without a username', async () => {
  await rejects(as('authenticated', otp, `update public.profiles set onboarding_completed = true where id = $1`, [otp]), /onboarding_minimum/)
})
await test('onboarding completes on own profile', async () => {
  await as('authenticated', otp, `update public.profiles set username = 'nisha', skills = '{react}', github_url = 'https://github.com/nisha', onboarding_completed = true where id = $1`, [otp])
  assert.equal((await one(`select onboarding_completed from public.profiles where id = $1`, [otp])).onboarding_completed, true)
})
await test('duplicate / invalid / reserved usernames rejected', async () => {
  await rejects(as('authenticated', otp, `update public.profiles set username = 'demo' where id = $1`, [otp]), /unique|duplicate/)
  await rejects(as('authenticated', otp, `update public.profiles set username = 'Nisha' where id = $1`, [otp]), /username_format/)
  await rejects(as('authenticated', otp, `update public.profiles set username = 'admin' where id = $1`, [otp]), /reserved/)
})
await test("cannot edit someone else's profile", async () => {
  await as('authenticated', otp, `update public.profiles set bio = 'x' where id = $1`, [demo])
  assert.notEqual((await one(`select bio from public.profiles where id = $1`, [demo])).bio, 'x')
})
await test('cannot change role, platform_role or email', async () => {
  await rejects(as('authenticated', otp, `update public.profiles set role = 'organizer' where id = $1`, [otp]), /permission denied/)
  await rejects(as('authenticated', otp, `update public.profiles set platform_role = 'admin' where id = $1`, [otp]), /permission denied/)
  await rejects(as('authenticated', otp, `update public.profiles set email = 'x@y.z' where id = $1`, [otp]), /permission denied/)
})
await test('username_available(): taken, free, invalid; anon refused', async () => {
  const q = async (n) => (await as('authenticated', otp, `select public.username_available($1) as ok`, [n]))[0].ok
  assert.equal(await q('demo'), false)
  assert.equal(await q('brand_new'), true)
  assert.equal(await q('no spaces'), false)
  assert.equal(await q('nisha'), true) // your own
  await rejects(as('anon', null, `select public.username_available('x')`), /permission denied/)
})
await test('platform_stats(): anon can read; sample content and never-signed-in accounts excluded', async () => {
  await db.query(`update auth.users set last_sign_in_at = now() where id = $1`, [otp])
  const [r] = await as('anon', null, `select public.platform_stats() as s`)
  assert.equal(r.s.members, 1)
  assert.equal(r.s.events_hosted, 0)
})
await test('avatars: upload only into own folder', async () => {
  await as('authenticated', otp, `insert into storage.objects (bucket_id, name) values ('avatars', $1)`, [`${otp}/a.jpg`])
  await rejects(as('authenticated', otp, `insert into storage.objects (bucket_id, name) values ('avatars', $1)`, [`${demo}/x.jpg`]), /row-level security/)
})
await test('events/bookings stay server-only (no browser access)', async () => {
  await rejects(as('authenticated', otp, `insert into public.events (title) values ('x')`), /row-level security|null value|permission/)
  const rows = await as('authenticated', otp, `select * from public.bookings`)
  assert.equal(rows.length, 0)
})

console.log(`\n${passed} passed${process.exitCode ? ' — FAILURES above' : ''}`)
await db.close()
