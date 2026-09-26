// Communication Center + Analytics rules (in-memory Postgres).   npm run test:comms-analytics
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
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;
  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
  alter table storage.objects enable row level security;
  create function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
  grant usage on schema storage to authenticated; grant all on storage.objects to authenticated;
`)
await db.exec(await readFile(new URL('../supabase/schema.sql', import.meta.url), 'utf8'))
const dir = new URL('../supabase/migrations/', import.meta.url)
for (const f of (await readdir(dir)).filter((x) => x.endsWith('.sql')).sort()) {
  const sql = await readFile(new URL(f, dir), 'utf8')
  await db.exec(sql)
  await db.exec(sql) // re-runnable
}
console.log('migrations applied (twice)')

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
const one = async (sql, p) => (await db.query(sql, p)).rows[0]
const fails = async (sql, p, hint) => {
  try {
    await db.query(sql, p)
  } catch (e) {
    assert.equal(e.hint, hint, `expected ${hint}, got ${e.hint}: ${e.message}`)
    return
  }
  assert.fail(`expected ${hint}`)
}
const user = async (email) => (await one(`insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id`, [email, { name: email.split('@')[0] }])).id
const [host, ana, ben, cy, dee, eve] = await Promise.all(['host', 'ana', 'ben', 'cy', 'dee', 'eve'].map((n) => user(`${n}@x.dev`)))
await db.query(`update profiles set role = 'organizer' where id = $1`, [host])
await db.query(
  `insert into events (id, title, type, category, mode, city, venue, date, start_time, organizer_chapter, capacity, available_seats, created_by, team_min, team_max)
   values ('hk', 'Match Hack', 'Hackathon', 'hackathon', 'Online', 'Online', 'Online', current_date + 7, '10:00', 'GDG', 50, 50, $1, 1, 2),
          ('ws', 'A Workshop', 'Event', 'workshop', 'Online', 'Online', 'Online', current_date + 7, '10:00', 'GDG', 50, 50, $1, null, null)`,
  [host],
)

const [ps] = await Promise.all([user('ps@x.dev')])
const book = async (u, mode, extra = []) => one(`select * from request_booking($1, 'hk', 1, '{}', 0, $2, $3, $4)`, [u, mode, ...extra.concat([null, null]).slice(0, 2)])
await test('announcements: organizer only; audience targeting; scheduled hidden from members', async () => {
  const a = await book(ana, 'team_create', ['Duo'])
  await book(ben, 'solo')
  await one(`select * from review_booking($1, $2, 'approve', null)`, [host, a.id])
  await fails(`select * from save_announcement($1, 'hk', null, 'Hello all', 'msg', 'all', null, false, false, null)`, [ana], 'auth/forbidden')
  await fails(`select * from save_announcement($1, 'hk', null, 'Team note', 'msg', 'team', gen_random_uuid(), false, false, null)`, [host], 'announce/team')
  await one(`select * from save_announcement($1, 'hk', null, 'For everyone', 'msg', 'all', null, true, true, null)`, [host])
  await one(`select * from save_announcement($1, 'hk', null, 'Judges only', 'msg', 'judges', null, false, false, null)`, [host])
  await one(`select * from save_announcement($1, 'hk', null, 'Duo only', 'msg', 'team', $2, false, false, null)`, [host, a.team_id])
  await one(`select * from save_announcement($1, 'hk', null, 'Later', 'msg', 'all', null, false, false, now() + interval '1 day')`, [host])
  const titles = async (u) => (await db.query(`select title from announcements_for($1, 'hk', 50, null)`, [u])).rows.map((r) => r.title).sort()
  assert.deepEqual(await titles(ana), ['Duo only', 'For everyone'])
  assert.deepEqual(await titles(ben), ['For everyone'])
  assert.deepEqual(await titles(ps), [])
  assert.equal((await titles(host)).length, 4)
  assert.deepEqual((await db.query(`select * from announcement_audience((select id from hackathon_announcements where title = 'Duo only'))`)).rows.length, 1)
})
await test('read tracking: only visible ones, no duplicates; unread counts', async () => {
  assert.equal((await one(`select * from announcement_unread_counts($1)`, [ana])).unread, 2)
  assert.equal((await one(`select mark_announcements_read($1, 'hk', null) n`, [ana])).n, 2)
  assert.equal((await one(`select mark_announcements_read($1, 'hk', null) n`, [ana])).n, 0)
  assert.equal((await one(`select mark_announcements_read($1, 'hk', null) n`, [ps])).n, 0)
  assert.equal((await db.query(`select * from announcement_unread_counts($1)`, [ana])).rows.length, 0)
})
await test('archive: organizer only; archived hidden from members', async () => {
  const id = (await one(`select id from hackathon_announcements where title = 'For everyone'`)).id
  await fails(`select * from archive_announcement($1, $2)`, [ben, id], 'auth/forbidden')
  await one(`select * from archive_announcement($1, $2)`, [host, id])
  assert.equal((await db.query(`select title from announcements_for($1, 'hk', 50, null)`, [ben])).rows.length, 0)
})
await test('analytics: organizer only; counts from real rows', async () => {
  await fails(`select hackathon_analytics($1, 'hk')`, [ana], 'auth/forbidden')
  const r = (await one(`select hackathon_analytics($1, 'hk') a`, [host])).a
  assert.equal(r.registrations.total, 2)
  assert.equal(r.registrations.approved, 1)
  assert.equal(r.teams.count, 1)
  assert.equal(r.submissions.expected, 1)
  assert.equal(r.submissions.notStarted, 1)
})
await test('browser roles have no access to the new tables', async () => {
  for (const t of ['hackathon_ideas', 'hackathon_announcements', 'announcement_reads']) {
    await db.exec('begin; set local role authenticated;')
    await assert.rejects(db.query(`select * from ${t}`), /permission denied/)
    await db.exec('rollback')
  }
})
console.log(`\n${passed} passed${process.exitCode ? ', FAILED' : ''}`)
