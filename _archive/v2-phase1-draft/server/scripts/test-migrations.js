// Applies every file in supabase/migrations (in order) to an in-memory
// Postgres with stand-ins for Supabase's auth/storage schemas and roles,
// then checks RLS and invariants by switching into the real `anon` /
// `authenticated` roles, so policies are actually enforced.
//   npm run test:db
import { readdir, readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { PGlite } from '@electric-sql/pglite'

const MIGRATIONS = new URL('../../supabase/migrations/', import.meta.url)
const db = new PGlite()

// ---- Supabase stand-ins ----
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

  create schema auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text unique, raw_user_meta_data jsonb default '{}');
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;

  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid);
  alter table storage.objects enable row level security;
  create function storage.foldername(name text) returns text[] language sql immutable as
    $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
  grant usage on schema storage to anon, authenticated;
  grant all on storage.objects to authenticated;
  grant execute on function storage.foldername(text) to authenticated;
`)

const files = (await readdir(MIGRATIONS)).filter((f) => f.endsWith('.sql')).sort()
for (const f of files) {
  const sql = await readFile(new URL(f, MIGRATIONS), 'utf8')
  await db.exec(sql)
  await db.exec(sql) // must be idempotent
  console.log(`applied ${f} (twice)`)
}

// ---- helpers ----
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
// Run SQL as a given role/user inside a transaction (like PostgREST does).
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
const newUser = async (email, meta = {}) =>
  (await db.query(`insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id`, [email, meta])).rows[0].id

console.log('\nPhase 1: profiles / RLS')
const alice = await newUser('alice@example.com', { full_name: 'Alice Iyer', avatar_url: 'https://lh3.googleusercontent.com/a/x' })
const bob = await newUser('bob@example.com', { name: 'B' }) // too short: name should not be prefilled
const admin = await newUser('admin@example.com')
await db.query(`update public.profiles set role = 'admin' where id = $1`, [admin])

await test('signup trigger creates profile prefilled from OAuth metadata', async () => {
  const [p] = (await db.query(`select * from public.profiles where id = $1`, [alice])).rows
  assert.equal(p.full_name, 'Alice Iyer')
  assert.equal(p.avatar_url, 'https://lh3.googleusercontent.com/a/x')
  assert.equal(p.role, 'user')
  assert.equal(p.onboarding_completed, false)
  const [b] = (await db.query(`select full_name from public.profiles where id = $1`, [bob])).rows
  assert.equal(b.full_name, null)
})

await test('logged-out (anon) cannot read profiles', async () => {
  await rejects(as('anon', null, `select * from public.profiles`), /permission denied/)
})

await test('signed-in users can read profiles; email is not in profiles', async () => {
  const rows = await as('authenticated', bob, `select * from public.profiles`)
  assert.equal(rows.length, 3)
  assert.ok(!('email' in rows[0]))
})

await test('onboarding cannot complete without username', async () => {
  await rejects(as('authenticated', alice, `update public.profiles set onboarding_completed = true where id = $1`, [alice]), /onboarding_minimum/)
})

await test('username format enforced (lowercase, 3–20, [a-z0-9_])', async () => {
  await rejects(as('authenticated', alice, `update public.profiles set username = 'Alice' where id = $1`, [alice]), /username_format/)
  await rejects(as('authenticated', alice, `update public.profiles set username = 'ab' where id = $1`, [alice]), /username_format/)
  await rejects(as('authenticated', alice, `update public.profiles set username = 'admin' where id = $1`, [alice]), /reserved/)
})

await test('user completes onboarding on own profile', async () => {
  await as('authenticated', alice, `update public.profiles set username = 'alice', bio = 'Hi', skills = '{react,go}', github_url = 'https://github.com/alice', onboarding_completed = true where id = $1`, [alice])
  const [p] = (await db.query(`select username, onboarding_completed from public.profiles where id = $1`, [alice])).rows
  assert.deepEqual(p, { username: 'alice', onboarding_completed: true })
})

await test('usernames are unique', async () => {
  await rejects(as('authenticated', bob, `update public.profiles set username = 'alice', full_name = 'Bob Das' where id = $1`, [bob]), /duplicate key|unique/)
})

await test("user cannot edit someone else's profile (RLS: 0 rows affected)", async () => {
  await as('authenticated', bob, `update public.profiles set bio = 'hacked' where id = $1`, [alice])
  const [p] = (await db.query(`select bio from public.profiles where id = $1`, [alice])).rows
  assert.equal(p.bio, 'Hi')
})

await test('user cannot promote themselves (role column not updatable)', async () => {
  await rejects(as('authenticated', bob, `update public.profiles set role = 'admin' where id = $1`, [bob]), /permission denied/)
})

await test('user cannot insert or delete profiles directly', async () => {
  await rejects(as('authenticated', bob, `insert into public.profiles (id) values (gen_random_uuid())`), /permission denied/)
  await rejects(as('authenticated', bob, `delete from public.profiles where id = $1`, [bob]), /permission denied/)
})

await test('URL fields validated', async () => {
  await rejects(as('authenticated', bob, `update public.profiles set github_url = 'javascript:alert(1)' where id = $1`, [bob]), /github_url_format/)
  await rejects(as('authenticated', bob, `update public.profiles set portfolio_url = 'ftp://x' where id = $1`, [bob]), /portfolio_url_format/)
})

await test('username_available(): taken / free / invalid / own name', async () => {
  const q = (u, name) => as('authenticated', u, `select public.username_available($1) as ok`, [name]).then((r) => r[0].ok)
  assert.equal(await q(bob, 'alice'), false)
  assert.equal(await q(bob, 'ALICE'), false)
  assert.equal(await q(bob, 'bob_das'), true)
  assert.equal(await q(bob, 'x!'), false)
  assert.equal(await q(alice, 'alice'), true) // your own username is "available" to you
})

await test('anon cannot call username_available()', async () => {
  await rejects(as('anon', null, `select public.username_available('x')`), /permission denied/)
})

await test('platform_stats() callable by anon, counts only onboarded members', async () => {
  const [r] = await as('anon', null, `select public.platform_stats() as s`)
  assert.equal(r.s.members, 1)
})

await test('admin_set_role(): non-admin refused, admin allowed, admin cannot demote self', async () => {
  await rejects(as('authenticated', bob, `select public.admin_set_role($1, 'admin')`, [bob]), /Only admins/)
  await as('authenticated', admin, `select public.admin_set_role($1, 'admin')`, [bob])
  assert.equal((await db.query(`select role from public.profiles where id = $1`, [bob])).rows[0].role, 'admin')
  await rejects(as('authenticated', admin, `select public.admin_set_role($1, 'user')`, [admin]), /own admin role/)
})

await test('avatars: users can upload only into their own folder', async () => {
  await as('authenticated', alice, `insert into storage.objects (bucket_id, name) values ('avatars', $1)`, [`${alice}/a.jpg`])
  await rejects(as('authenticated', alice, `insert into storage.objects (bucket_id, name) values ('avatars', $1)`, [`${bob}/evil.jpg`]), /row-level security/)
  const [b] = (await db.query(`select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'avatars'`)).rows
  assert.equal(b.public, true)
  assert.equal(Number(b.file_size_limit), 2097152)
})

await test('deleting the auth user removes the profile', async () => {
  const tmp = await newUser('tmp@example.com')
  await db.query(`delete from auth.users where id = $1`, [tmp])
  assert.equal((await db.query(`select count(*)::int as n from public.profiles where id = $1`, [tmp])).rows[0].n, 0)
})

console.log(`\n${passed} passed${process.exitCode ? ' — FAILURES above' : ''}`)
await db.close()
