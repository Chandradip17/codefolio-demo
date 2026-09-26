// Team Matcher + Demo Day rules, against an in-memory Postgres with Supabase
// stand-ins.   npm run test:matcher-demo
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
const prefs = (u, event = 'hk', available = true) =>
  db.query(`select * from save_team_preferences($1, $2, array['React'], array['backend'], 'intermediate', 'full_time', 'win', array['AI'], 'hi', $3)`, [u, event, available])

console.log('\nTeam Matcher')
await test('preferences: hackathons only; upsert (one row per user+hackathon)', async () => {
  await fails(`select * from save_team_preferences($1, 'ws', '{}', '{}', 'beginner', 'flexible', 'learn', '{}', '', true)`, [ana], 'project/not_hackathon')
  await prefs(ana)
  await prefs(ana)
  assert.equal((await one(`select count(*)::int n from team_preferences where user_id = $1`, [ana])).n, 1)
  await assert.rejects(db.query(`select * from save_team_preferences($1, 'hk', '{}', '{}', 'guru', 'flexible', 'learn', '{}', '', true)`, [ben]), /check constraint/)
})
await test('candidates filtered in the database: same hackathon, available, not me', async () => {
  await prefs(ben)
  await prefs(cy, 'hk', false) // not open to matching
  const ids = (await db.query(`select user_id from team_match_candidates($1, 'hk', 100)`, [ana])).rows.map((r) => r.user_id)
  assert.deepEqual(ids, [ben])
})
let req
await test('invite: no self, needs own preferences, receiver must be available, no duplicates either way', async () => {
  await fails(`select * from send_team_request($1, 'hk', $1, '')`, [ana], 'team/self')
  await fails(`select * from send_team_request($1, 'hk', $2, '')`, [dee, ana], 'team/no_preferences')
  await fails(`select * from send_team_request($1, 'hk', $2, '')`, [ana, cy], 'team/unavailable')
  req = await one(`select * from send_team_request($1, 'hk', $2, 'Let''s build')`, [ana, ben])
  assert.equal(req.status, 'pending')
  await fails(`select * from send_team_request($1, 'hk', $2, '')`, [ana, ben], 'team/request_exists')
  await fails(`select * from send_team_request($1, 'hk', $2, '')`, [ben, ana], 'team/request_exists')
})
await test('only the receiver answers; only the sender cancels; closed requests stay closed', async () => {
  await fails(`select * from respond_team_request($1, $2, 'accept')`, [ana, req.id], 'auth/forbidden')
  await fails(`select * from respond_team_request($1, $2, 'cancel')`, [ben, req.id], 'auth/forbidden')
  await fails(`select * from respond_team_request($1, $2, 'accept')`, [dee, req.id], 'team/request_missing')
  assert.equal((await one(`select * from respond_team_request($1, $2, 'accept')`, [ben, req.id])).status, 'accepted')
  await fails(`select * from respond_team_request($1, $2, 'reject')`, [ben, req.id], 'team/request_closed')
  await fails(`select * from send_team_request($1, 'hk', $2, '')`, [ben, ana], 'team/already_connected')
})
await test('full teams are excluded and can’t be invited; teammates aren’t candidates', async () => {
  // ana + ben form a team of 2 (max 2) through the normal application flow
  const a = await one(`select * from request_booking($1, 'hk', 1, '{}', 0, 'team_create', 'Duo')`, [ana])
  const code = (await one(`select code from teams where id = $1`, [a.team_id])).code
  await one(`select * from request_booking($1, 'hk', 1, '{}', 0, 'team_join', null, $2)`, [ben, code])
  await prefs(dee)
  await prefs(eve)
  const forEve = (await db.query(`select user_id from team_match_candidates($1, 'hk', 100)`, [eve])).rows.map((r) => r.user_id)
  assert.deepEqual(forEve.sort(), [dee].sort()) // ana & ben are in a full team
  await fails(`select * from send_team_request($1, 'hk', $2, '')`, [eve, ana], 'team/full')
  await fails(`select * from send_team_request($1, 'hk', $2, '')`, [ana, eve], 'team/full')
})
await test('pending invitations can be cancelled by the sender', async () => {
  const r = await one(`select * from send_team_request($1, 'hk', $2, '')`, [eve, dee])
  assert.equal((await one(`select * from respond_team_request($1, $2, 'cancel')`, [eve, r.id])).status, 'cancelled')
  assert.equal((await one(`select * from send_team_request($1, 'hk', $2, '')`, [eve, dee])).status, 'pending') // can re-invite later
})

console.log('\nDemo Day')
const mkProject = async (u, title) => {
  const b = await one(`select * from bookings where user_id = $1 and event_id = 'hk'`, [u])
  if (b.status === 'Pending') await one(`select * from review_booking($1, $2, 'approve', null)`, [host, b.id])
  return one(`select * from submit_project($1, 'hk', $2, 'A real problem statement.', 'A long enough description of what the project does.', '{}', 'https://github.com/a/b', null, null)`, [u, title])
}
const [p1] = await Promise.all([mkProject(ana, 'Duo Project')])
const dB = await one(`select * from request_booking($1, 'hk', 1, '{}', 0, 'solo')`, [dee])
await one(`select * from review_booking($1, $2, 'approve', null)`, [host, dB.id])
const p2 = await one(`select * from submit_project($1, 'hk', 'Dee Solo', 'Another problem statement.', 'A long enough description of what the project does.', '{}', 'https://github.com/d/e', null, null)`, [dee])
let s
await test('only the organizer creates the session; finalists must belong to the hackathon', async () => {
  await fails(`select * from demo_save_session($1, 'hk', 300, 120, array[$2::uuid])`, [ana, p1.id], 'auth/forbidden')
  await fails(`select * from demo_save_session($1, 'hk', 300, 120, array[gen_random_uuid()])`, [host], 'demo/bad_project')
  await fails(`select * from demo_save_session($1, 'hk', 300, 120, array[$2::uuid, $2::uuid])`, [host, p1.id], 'demo/duplicate')
  s = await one(`select * from demo_save_session($1, 'hk', 300, 120, array[$2::uuid, $3::uuid])`, [host, p2.id, p1.id])
  const order = (await db.query(`select project_id from demo_presentations where session_id = $1 order by order_number`, [s.id])).rows.map((r) => r.project_id)
  assert.deepEqual(order, [p2.id, p1.id])
  await fails(`select * from demo_control($1, $2, 'start', null)`, [host, s.id], 'demo/state') // session not started
})
await test('presenting → qa → completed, stamped with the database clock; next team starts automatically', async () => {
  await one(`select * from demo_control($1, $2, 'start_session', null)`, [host, s.id])
  const a = await one(`select * from demo_control($1, $2, 'start', null)`, [host, s.id])
  assert.equal(a.phase, 'presenting')
  assert.ok(a.phase_started_at && Math.abs(Date.parse(a.phase_started_at) - Date.now()) < 5000)
  await fails(`select * from demo_control($1, $2, 'start', null)`, [host, s.id], 'demo/busy')
  const q = await one(`select * from demo_control($1, $2, 'qa', null)`, [host, s.id])
  assert.equal(q.phase, 'qa')
  const n = await one(`select * from demo_control($1, $2, 'next', null)`, [host, s.id])
  const st = (await db.query(`select project_id, status from demo_presentations where session_id = $1 order by order_number`, [s.id])).rows
  assert.deepEqual(st.map((r) => r.status), ['completed', 'presenting'])
  assert.equal(n.phase, 'presenting')
})
await test('pause/resume adjusts the authoritative timer; judges can’t control', async () => {
  await fails(`select * from demo_control($1, $2, 'pause', null)`, [ana, s.id], 'auth/forbidden')
  const p = await one(`select * from demo_control($1, $2, 'pause', null)`, [host, s.id])
  assert.ok(p.paused_at)
  await fails(`select * from demo_control($1, $2, 'pause', null)`, [host, s.id], 'demo/state')
  const r = await one(`select * from demo_control($1, $2, 'resume', null)`, [host, s.id])
  assert.equal(r.paused_at, null)
  assert.ok(r.paused_seconds >= 0)
})
await test('skip, end session; finished queue is history (not removable); ended sessions are locked', async () => {
  await one(`select * from demo_control($1, $2, 'skip', null)`, [host, s.id])
  const e = await one(`select * from demo_control($1, $2, 'end_session', null)`, [host, s.id])
  assert.equal(e.status, 'ended')
  const st = (await db.query(`select status from demo_presentations where session_id = $1 order by order_number`, [s.id])).rows.map((r) => r.status)
  assert.deepEqual(st, ['completed', 'skipped'])
  await fails(`select * from demo_save_session($1, 'hk', 300, 120, '{}')`, [host], 'demo/ended')
})

console.log('\nSecurity')
await test('browser roles can’t read or write any new table or call the functions', async () => {
  for (const t of ['team_preferences', 'team_requests', 'github_connections', 'project_repositories', 'github_activity', 'demo_sessions', 'demo_presentations', 'judge_notes']) {
    for (const role of ['anon', 'authenticated']) {
      await db.exec('begin')
      try {
        await db.query(`select set_config('role', '${role}', true)`)
        await assert.rejects(db.query(`select * from ${t}`), /permission denied/, `${role} read ${t}`)
      } finally {
        await db.exec('rollback')
      }
    }
  }
  for (const sql of [
    `select * from demo_control(gen_random_uuid(), gen_random_uuid(), 'start', null)`,
    `select * from send_team_request(gen_random_uuid(), 'hk', gen_random_uuid(), '')`,
    `select * from team_match_candidates(gen_random_uuid(), 'hk', 10)`,
  ]) {
    await db.exec('begin')
    try {
      await db.query(`select set_config('role', 'authenticated', true)`)
      await assert.rejects(db.query(sql), /permission denied/, sql)
    } finally {
      await db.exec('rollback')
    }
  }
})

console.log(`\n${passed} passed${process.exitCode ? ' — FAILURES above' : ''}`)
await db.close()
