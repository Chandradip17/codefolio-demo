// Judge applications · role transition · projects · assignments · reviews ·
// results — against an in-memory Postgres with Supabase stand-ins.
//   npm run test:judging
import { readdir, readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { PGlite } from '@electric-sql/pglite'
import { CRITERIA, weightedScore } from '../src/lib/scoring.js'

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
  await db.exec(sql) // migrations must be re-runnable
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
    return e.message
  }
  assert.fail(`expected ${hint}`)
}
const user = async (email, name) => (await one(`insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id`, [email, { name }])).id
// Run a statement as a browser role (anon / authenticated user) inside a rolled-back transaction.
async function asRole(role, uid, sql, params) {
  await db.exec('begin')
  try {
    await db.query(`select set_config('role', $1, true)`, [role])
    if (uid) await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [uid])
    return await db.query(sql, params)
  } finally {
    await db.exec('rollback')
  }
}

const adminId = await user('admin@x.dev', 'Platform Admin')
await db.query(`update profiles set platform_role = 'admin' where id = $1`, [adminId])
const host = await user('host@x.dev', 'Hack Host')
await db.query(`update profiles set role = 'organizer' where id = $1`, [host])
const jane = await user('jane@x.dev', 'Jane Judge')
const raj = await user('raj@x.dev', 'Raj Rejected')
const pia = await user('pia@x.dev', 'Pia Participant')
const tom = await user('tom@x.dev', 'Tom Teammate')
const sol = await user('sol@x.dev', 'Sol Solo')

console.log('\nJudge applications')
let app
await test('member applies → pending; no judge powers yet; duplicate pending refused', async () => {
  app = await one(`select * from request_judge($1, 'Senior Engineer', 'ABC Tech', 7, array['AI',' Cloud ','AI'], 'Judged 4 hackathons', 'I want to help students build better projects.')`, [jane])
  assert.equal(app.status, 'pending')
  assert.deepEqual([...app.expertise].sort(), ['AI', 'Cloud'])
  assert.equal((await one(`select is_judge from profiles where id = $1`, [jane])).is_judge, false)
  await fails(`select * from request_judge($1, 'Engineer', 'ABC', 1, '{}', '', 'Trying again with a long enough reason.')`, [jane], 'judge/pending')
})
await test('non-admins can’t review; admins can’t review their own application', async () => {
  await fails(`select * from review_judge_application($1, $2, 'approved', null)`, [host, app.id], 'auth/forbidden')
  await fails(`select * from review_judge_application($1, $2, 'approved', null)`, [jane, app.id], 'auth/forbidden')
  const own = await one(`select * from request_judge($1, 'Admin', 'Codefolio', 3, '{}', '', 'Admins can apply too, but not approve themselves.')`, [adminId])
  await fails(`select * from review_judge_application($1, $2, 'approved', null)`, [adminId, own.id], 'judge/self')
})
await test('approval is atomic: status + reviewer + timestamp + judge role together; can’t review twice', async () => {
  const r = await one(`select * from review_judge_application($1, $2, 'approved', 'Welcome')`, [adminId, app.id])
  assert.equal(r.status, 'approved')
  assert.equal(r.reviewed_by, adminId)
  assert.ok(r.reviewed_at)
  assert.equal((await one(`select is_judge, role from profiles where id = $1`, [jane])).is_judge, true)
  assert.equal((await one(`select role from profiles where id = $1`, [jane])).role, 'attendee') // participant powers kept
  await fails(`select * from review_judge_application($1, $2, 'rejected', null)`, [adminId, app.id], 'judge/reviewed')
  await fails(`select * from request_judge($1, 'x', 'yy', 1, '{}', '', 'Already a judge asking again here.')`, [jane], 'judge/already')
})
await test('rejection keeps the normal role and stores the note; can re-apply later', async () => {
  const a = await one(`select * from request_judge($1, 'Student', 'Uni', 0, '{}', '', 'I would love to judge the next hackathon.')`, [raj])
  const r = await one(`select * from review_judge_application($1, $2, 'rejected', 'Please add judging experience.')`, [adminId, a.id])
  assert.equal(r.status, 'rejected')
  assert.equal(r.admin_notes, 'Please add judging experience.')
  assert.equal((await one(`select is_judge from profiles where id = $1`, [raj])).is_judge, false)
  assert.equal((await one(`select * from request_judge($1, 'Student', 'Uni', 1, '{}', 'Mentored at 2 events', 'Second try with more experience now.')`, [raj])).status, 'pending')
})

console.log('\nRow-level security (browser roles)')
await test('users can’t make themselves judges or touch judging tables directly', async () => {
  await assert.rejects(asRole('authenticated', raj, `update profiles set is_judge = true where id = $1`, [raj]), /permission denied/)
  for (const t of ['judge_applications', 'projects', 'judge_assignments', 'project_reviews', 'project_analysis']) {
    await assert.rejects(asRole('authenticated', raj, `select * from ${t}`), /permission denied/, `authenticated read ${t}`)
    await assert.rejects(asRole('anon', null, `select * from ${t}`), /permission denied/, `anon read ${t}`)
  }
  await assert.rejects(
    asRole('authenticated', raj, `insert into judge_applications (user_id, job_title, organization, experience_years, reason, status) values ($1, 'x', 'yy', 1, 'Self-approved application attempt.', 'approved')`, [raj]),
    /permission denied/,
  )
  await assert.rejects(asRole('authenticated', raj, `select review_judge_application($1, gen_random_uuid(), 'approved', null)`, [raj]), /permission denied/)
  await assert.rejects(asRole('authenticated', jane, `select submit_review($1, gen_random_uuid(), 9, 9, 9, 9, 9, '')`, [jane]), /permission denied/)
  // members can still read the public judge flag (for their own UI)
  const r = await asRole('authenticated', raj, `select is_judge from profiles where id = $1`, [jane])
  assert.equal(r.rows[0].is_judge, true)
})

console.log('\nProjects')
await db.query(
  `insert into events (id, title, type, category, mode, city, venue, date, start_time, organizer_chapter, capacity, available_seats, created_by, team_min, team_max)
   values ('hk', 'Judge Hack', 'Hackathon', 'hackathon', 'Online', 'Online', 'Online', current_date + 3, '10:00', 'GDG', 50, 50, $1, 1, 3),
          ('ws', 'A Workshop', 'Event', 'workshop', 'Online', 'Online', 'Online', current_date + 3, '10:00', 'GDG', 50, 50, $1, null, null)`,
  [host],
)
const confirm = async (u, part, name = null, code = null) => {
  const b = await one(`select * from request_booking($1, 'hk', 1, '{}', 0, $2, $3, $4)`, [u, part, name, code])
  await one(`select * from review_booking($1, $2, 'approve', null)`, [host, b.id])
  return one(`select * from bookings where id = $1`, [b.id])
}
const proj = (u, title, ev = 'hk') =>
  db.query(`select * from submit_project($1, $2, $3, 'People waste hours finding events.', $4, array['React','Supabase'], 'https://github.com/acme/app', null, null)`, [
    u, ev, title, 'A long enough description of what the project does for its users.',
  ])
let piaB, teamProject, soloProject
await test('only approved participants can submit; pending applicants can’t', async () => {
  const pending = await one(`select * from request_booking($1, 'hk', 1, '{}', 0, 'team_create', 'Byte Me')`, [pia])
  await fails(`select * from submit_project($1, 'hk', 'Too Early', 'Problem statement here.', 'A long enough description of what the project does.', '{}', 'https://github.com/a/b', null, null)`, [pia], 'project/not_participant')
  await one(`select * from review_booking($1, $2, 'approve', null)`, [host, pending.id])
  piaB = await one(`select * from bookings where id = $1`, [pending.id])
  await fails(`select * from submit_project($1, 'ws', 'Wrong Kind', 'Problem statement here.', 'A long enough description of what the project does.', '{}', 'https://github.com/a/b', null, null)`, [pia], 'project/not_hackathon')
})
await test('one project per team: a teammate’s submission updates the same project', async () => {
  const code = (await one(`select code from teams where id = $1`, [piaB.team_id])).code
  await confirm(tom, 'team_join', null, code)
  teamProject = (await proj(pia, 'EventFinder')).rows[0]
  const again = (await proj(tom, 'EventFinder v2')).rows[0]
  assert.equal(again.id, teamProject.id)
  assert.equal(again.title, 'EventFinder v2')
  assert.equal(again.team_id, piaB.team_id)
  await confirm(sol, 'solo')
  soloProject = (await proj(sol, 'SoloSaver')).rows[0]
  assert.equal(soloProject.team_id, null)
  assert.equal((await one(`select count(*)::int n from projects where event_id = 'hk'`)).n, 2)
})
await test('invalid GitHub URL is rejected by the schema', async () => {
  await assert.rejects(
    db.query(`select * from submit_project($1, 'hk', 'Bad Link', 'Problem statement here.', 'A long enough description of what the project does.', '{}', 'https://gitlab.com/a/b', null, null)`, [sol]),
    /violates check constraint/,
  )
})

console.log('\nAssignments & reviews')
await test('only approved judges can be assigned; pending/rejected applicants can’t; participants can’t judge', async () => {
  await fails(`select * from assign_judge($1, 'hk', $2)`, [host, raj], 'judge/not_approved') // raj: pending re-application
  await fails(`select * from assign_judge($1, 'hk', $2)`, [jane, jane], 'auth/forbidden') // judge can't assign themselves
  await db.query(`update profiles set is_judge = true where id = $1`, [pia]) // e.g. pia is also an approved judge
  await fails(`select * from assign_judge($1, 'hk', $2)`, [host, pia], 'judge/conflict')
  await db.query(`update profiles set is_judge = false where id = $1`, [pia])
  assert.equal((await one(`select * from assign_judge($1, 'hk', $2)`, [host, jane])).judge_id, jane)
})
await test('unassigned judges can’t review; scores validated (0–10, one decimal)', async () => {
  const other = await user('other@x.dev', 'Other Judge')
  await db.query(`update profiles set is_judge = true where id = $1`, [other])
  await fails(`select * from submit_review($1, $2, 8, 8, 8, 8, 8, '')`, [other, teamProject.id], 'judge/not_assigned')
  await fails(`select * from submit_review($1, $2, 11, 8, 8, 8, 8, '')`, [jane, teamProject.id], 'review/score')
  await fails(`select * from submit_review($1, $2, 8.25, 8, 8, 8, 8, '')`, [jane, teamProject.id], 'review/score')
  await fails(`select * from submit_review($1, $2, 8, 8, 8, 8, 8, '')`, [raj, teamProject.id], 'auth/forbidden')
})
await test('weighted score matches the shared formula; re-submitting updates (no duplicates)', async () => {
  const s = { innovation: 9, technical: 8.5, impact: 7, uiux: 6, presentation: 8 }
  const r = await one(`select * from submit_review($1, $2, $3, $4, $5, $6, $7, 'Great idea')`, [jane, teamProject.id, s.innovation, s.technical, s.impact, s.uiux, s.presentation])
  assert.equal(Number(r.weighted), weightedScore(s))
  assert.equal(Number(r.weighted), 7.88) // 2.25 + 2.125 + 1.4 + 0.9 + 1.2 = 7.875 → 7.88
  const r2 = await one(`select * from submit_review($1, $2, 9, 9, 9, 9, 9, 'Updated')`, [jane, teamProject.id])
  assert.equal(r2.id, r.id)
  assert.equal(Number(r2.weighted), 9)
  assert.equal((await one(`select count(*)::int n from project_reviews where project_id = $1`, [teamProject.id])).n, 1)
  assert.equal(CRITERIA.reduce((t, c) => t + c.weight, 0), 1)
})
await test('reviewed projects are locked for editing; judges with reviews can’t be unassigned', async () => {
  await fails(`select * from submit_project($1, 'hk', 'Sneaky edit', 'Problem statement here.', 'A long enough description of what the project does.', '{}', 'https://github.com/a/b', null, null)`, [pia], 'project/locked')
  await fails(`select unassign_judge($1, 'hk', $2)`, [host, jane], 'judge/has_reviews')
})

console.log('\nResults')
await test('only the organizer publishes; publishing closes reviews and submissions; un-publish reopens', async () => {
  await fails(`select * from publish_results($1, 'hk', true)`, [jane], 'auth/forbidden')
  const ev = await one(`select * from publish_results($1, 'hk', true)`, [host])
  assert.ok(ev.results_published_at)
  await fails(`select * from submit_review($1, $2, 5, 5, 5, 5, 5, '')`, [jane, soloProject.id], 'results/published')
  await fails(`select * from submit_project($1, 'hk', 'Late', 'Problem statement here.', 'A long enough description of what the project does.', '{}', 'https://github.com/a/b', null, null)`, [sol], 'results/published')
  assert.equal((await one(`select * from publish_results($1, 'hk', false)`, [host])).results_published_at, null)
  await one(`select * from submit_review($1, $2, 5, 5, 5, 5, 5, '')`, [jane, soloProject.id])
})

console.log(`\n${passed} passed${process.exitCode ? ' — FAILURES above' : ''}`)
await db.close()
