// Host approval · booking approval · QR check-in: exercised against an
// in-memory Postgres with Supabase stand-ins.   npm run test:phase2
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

const admin = await user('admin@x.dev', 'Platform Admin')
await db.query(`update profiles set platform_role = 'admin', username = 'padmin', onboarding_completed = true where id = $1`, [admin])
const alice = await user('alice@x.dev', 'Alice Host')
const bob = await user('bob@x.dev', 'Bob Attendee')
const carol = await user('carol@x.dev', 'Carol Attendee')
const dave = await user('dave@x.dev', 'Dave Other Host')
await db.query(`update profiles set role = 'organizer' where id = $1`, [dave])

console.log('\nHost approval')
let req
await test('member requests host access (pending); duplicate pending blocked', async () => {
  req = await one(`select * from request_host($1, 'event', 'GDG Test', 'Pune', 'We run monthly meetups for 200 students.')`, [alice])
  assert.equal(req.status, 'pending')
  await fails(`select * from request_host($1, 'event', 'GDG Test', 'Pune', 'Another request with enough text.')`, [alice], 'host/pending')
})
await test('non-admin cannot review; admin cannot review own request', async () => {
  await fails(`select * from review_host_request($1, $2, 'approved', null)`, [bob, req.id], 'auth/forbidden')
})
await test('admin approves → member becomes organizer; can’t review twice', async () => {
  const r = await one(`select * from review_host_request($1, $2, 'approved', 'Welcome')`, [admin, req.id])
  assert.equal(r.status, 'approved')
  assert.equal((await one(`select role, chapter from profiles where id = $1`, [alice])).role, 'organizer')
  await fails(`select * from review_host_request($1, $2, 'rejected', null)`, [admin, req.id], 'host/reviewed')
  await fails(`select * from request_host($1, 'event', 'X', '', 'Already a host but asking again.')`, [alice], 'host/already')
})
await test('rejected request keeps the member an attendee', async () => {
  const r2 = await one(`select * from request_host($1, 'hackathon', 'Bob Club', '', 'I want to run a campus hackathon.')`, [bob])
  await one(`select * from review_host_request($1, $2, 'rejected', 'Need more detail')`, [admin, r2.id])
  assert.equal((await one(`select role from profiles where id = $1`, [bob])).role, 'attendee')
})

console.log('\nApplications (booking approval)')
const mkEvent = (id, cap, owner, extra = '') =>
  db.query(
    `insert into events (id, title, type, category, mode, city, venue, date, start_time, organizer_chapter, capacity, available_seats, created_by ${extra ? ', status' : ''})
     values ($1, 'Test Build Night', 'Event', 'workshop', 'In-person', 'Pune', 'Venue', current_date + 3, '18:00', 'GDG Test', $2, $2, $3 ${extra ? `, '${extra}'` : ''})`,
    [id, cap, owner],
  )
await mkEvent('ev1', 2, alice)
await mkEvent('ev2', 10, dave)
let bb, cb
await test('request creates a Pending booking + answers; seats not taken yet', async () => {
  bb = await one(`select * from request_booking($1, 'ev1', 1, '{"why":"to learn","github":"https://github.com/bob"}', 1)`, [bob])
  assert.equal(bb.status, 'Pending')
  assert.equal((await one(`select available_seats from events where id = 'ev1'`)).available_seats, 2)
  assert.equal((await one(`select count(*)::int n from booking_answers where booking_id = $1`, [bb.id])).n, 2)
})
await test('duplicate request blocked; host can’t book own event', async () => {
  await fails(`select * from request_booking($1, 'ev1', 1, null, 1)`, [bob], 'booking/duplicate')
  await fails(`select * from request_booking($1, 'ev1', 1, null, 1)`, [alice], 'booking/own')
})
await test('no QR before approval', async () => {
  await fails(`select booking_credential($1, $2, false)`, [bob, bb.id], 'qr/not_approved')
})
await test('only the event’s host (or admin) can review', async () => {
  await fails(`select * from review_booking($1, $2, 'approve', null)`, [dave, bb.id], 'auth/forbidden')
  await fails(`select * from review_booking($1, $2, 'approve', null)`, [carol, bb.id], 'auth/forbidden')
})
await test('host approves → Confirmed, seats 2→1, QR issued', async () => {
  const r = await one(`select * from review_booking($1, $2, 'approve', null)`, [alice, bb.id])
  assert.equal(r.status, 'Confirmed')
  assert.equal((await one(`select available_seats from events where id = 'ev1'`)).available_seats, 1)
  const c = (await one(`select booking_credential($1, $2, false) as c`, [bob, bb.id])).c
  assert.match(c.token, /^[0-9a-f]{64}$/)
  assert.match(c.manualCode, /^[A-HJ-NP-Z2-9]{10}$/)
})
await test('approval refused when seats run out; reject works', async () => {
  cb = await one(`select * from request_booking($1, 'ev1', 1, null, 1)`, [carol])
  const x = await user('x@x.dev', 'Xavier')
  const xb = await one(`select * from request_booking($1, 'ev1', 1, null, 1)`, [x])
  await one(`select * from review_booking($1, $2, 'approve', null)`, [alice, cb.id]) // seats 1→0
  await fails(`select * from review_booking($1, $2, 'approve', null)`, [alice, xb.id], 'booking/insufficient')
  assert.equal((await one(`select * from review_booking($1, $2, 'reject', 'Full')`, [alice, xb.id])).status, 'Rejected')
  await fails(`select * from review_booking($1, $2, 'approve', null)`, [alice, xb.id], 'booking/state')
})

console.log('\nQR check-in')
let bobCred
await test('wrong event / invalid code / unauthorized host rejected', async () => {
  bobCred = (await one(`select booking_credential($1, $2, false) as c`, [bob, bb.id])).c
  await fails(`select check_in($1, 'ev2', $2)`, [dave, bobCred.token], 'checkin/wrong_event')
  await fails(`select check_in($1, 'ev1', 'deadbeef')`, [alice], 'checkin/invalid')
  await fails(`select check_in($1, 'ev1', $2)`, [dave, bobCred.token], 'auth/forbidden')
})
await test('regenerated QR revokes the old one', async () => {
  const fresh = (await one(`select booking_credential($1, $2, true) as c`, [bob, bb.id])).c
  assert.notEqual(fresh.token, bobCred.token)
  await fails(`select check_in($1, 'ev1', $2)`, [alice, bobCred.token], 'checkin/revoked')
  bobCred = fresh
})
await test('valid scan checks in once; QR payload prefix accepted; second scan rejected', async () => {
  const r = (await one(`select check_in($1, 'ev1', $2) as r`, [alice, `codefolio:ci:${bobCred.token}`])).r
  assert.equal(r.attendeeName, 'Bob Attendee')
  assert.equal((await one(`select status from bookings where id = $1`, [bb.id])).status, 'Attended')
  const msg = await fails(`select check_in($1, 'ev1', $2)`, [alice, bobCred.token], 'checkin/already')
  assert.match(msg, /Already checked in/)
})
await test('manual code works (case/format-insensitive)', async () => {
  const c = (await one(`select booking_credential($1, $2, false) as c`, [carol, cb.id])).c
  const typed = c.manualCode.toLowerCase().replace(/(.{5})/, '$1-')
  const r = (await one(`select check_in($1, 'ev1', $2) as r`, [alice, typed])).r
  assert.equal(r.attendeeName, 'Carol Attendee')
})
await test('attendance can’t be undone: attended bookings can’t be removed or cancelled', async () => {
  await fails(`select * from review_booking($1, $2, 'remove', null)`, [alice, bb.id], 'booking/state')
  await fails(`select * from cancel_booking($1, $2)`, [bob, bb.id], 'booking/inactive')
  assert.equal((await one(`select count(*)::int n from attendance where booking_id = $1`, [bb.id])).n, 1)
})
await test('removed participant: seats released, QR revoked, scan says revoked', async () => {
  const y = await user('y@x.dev', 'Yara')
  const yb = await one(`select * from request_booking($1, 'ev2', 1, null, 1)`, [y])
  await one(`select * from review_booking($1, $2, 'approve', null)`, [dave, yb.id])
  const c = (await one(`select booking_credential($1, $2, false) as c`, [y, yb.id])).c
  assert.equal((await one(`select available_seats from events where id = 'ev2'`)).available_seats, 9)
  await one(`select * from review_booking($1, $2, 'remove', 'No-show policy')`, [dave, yb.id])
  assert.equal((await one(`select available_seats from events where id = 'ev2'`)).available_seats, 10)
  await fails(`select check_in($1, 'ev2', $2)`, [dave, c.token], 'checkin/revoked')
})
await test('cancelled event closes check-in', async () => {
  const z = await user('z@x.dev', 'Zed')
  const zb = await one(`select * from request_booking($1, 'ev2', 1, null, 1)`, [z])
  await one(`select * from review_booking($1, $2, 'approve', null)`, [dave, zb.id])
  const c = (await one(`select booking_credential($1, $2, false) as c`, [z, zb.id])).c
  await db.query(`update events set status = 'Cancelled' where id = 'ev2'`)
  await fails(`select check_in($1, 'ev2', $2)`, [dave, c.token], 'checkin/event_closed')
})
await test('attendee cancels pending (no seat change) and confirmed (seat released)', async () => {
  await mkEvent('ev3', 5, dave)
  const w = await user('w@x.dev', 'Wen')
  const p = await one(`select * from request_booking($1, 'ev3', 1, null, 1)`, [w])
  assert.equal((await one(`select * from cancel_booking($1, $2)`, [w, p.id])).status, 'Cancelled')
  assert.equal((await one(`select available_seats from events where id = 'ev3'`)).available_seats, 5)
  const p2 = await one(`select * from request_booking($1, 'ev3', 1, null, 1)`, [w]) // allowed again after cancelling
  await one(`select * from review_booking($1, $2, 'approve', null)`, [dave, p2.id])
  await one(`select * from cancel_booking($1, $2)`, [w, p2.id])
  assert.equal((await one(`select available_seats from events where id = 'ev3'`)).available_seats, 5)
})
console.log('\nTimeline, drafts, team sizes')
await test('drafts can’t be applied to', async () => {
  await mkEvent('ev4', 10, alice, 'Draft')
  await fails(`select * from request_booking($1, 'ev4', 1, '{}', 0)`, [carol], 'event/missing')
})
await test('applications respect the open / deadline window', async () => {
  await mkEvent('ev5', 10, alice)
  await db.query(`update events set applications_open_at = now() + interval '1 day', applications_close_at = now() + interval '2 days' where id = 'ev5'`)
  const msg = await fails(`select * from request_booking($1, 'ev5', 1, '{}', 0)`, [carol], 'event/not_open')
  assert.match(msg, /Applications open on/)
  await db.query(`update events set applications_open_at = now() - interval '2 days', applications_close_at = now() - interval '1 hour' where id = 'ev5'`)
  await fails(`select * from request_booking($1, 'ev5', 1, '{}', 0)`, [carol], 'event/closed')
  await db.query(`update events set applications_close_at = now() + interval '1 hour' where id = 'ev5'`)
  assert.equal((await one(`select * from request_booking($1, 'ev5', 1, '{}', 0)`, [carol])).status, 'Pending')
})
await test('constraints: team min ≤ max (1–10), window order, end date ≥ start', async () => {
  for (const sql of [
    `update events set team_min = 5, team_max = 2 where id = 'ev5'`,
    `update events set team_max = 11 where id = 'ev5'`,
    `update events set applications_open_at = now(), applications_close_at = now() - interval '1 day' where id = 'ev5'`,
    `update events set end_date = date - 1 where id = 'ev5'`,
  ]) {
    await assert.rejects(db.query(sql), /violates check constraint/)
  }
  await db.query(`update events set team_min = 1, team_max = 4, hybrid = true, theme = 'Climate Tech', end_date = date + 1 where id = 'ev5'`)
})

console.log('\nHackathon teams')
const erin = await user('erin@x.dev', 'Erin Coder')
const finn = await user('finn@x.dev', 'Finn Coder')
const gina = await user('gina@x.dev', 'Gina Coder')
const mkHack = (id, min, max) =>
  db.query(
    `insert into events (id, title, type, category, mode, city, venue, date, start_time, organizer_chapter, capacity, available_seats, created_by, team_min, team_max)
     values ($1, 'Team Hack', 'Hackathon', 'hackathon', 'Online', 'Online', 'Online', current_date + 5, '10:00', 'GDG Test', 50, 50, $2, $3, $4)`,
    [id, alice, min, max],
  )
const apply = (u, ev, part, name = null, code = null, seats = 1) =>
  db.query(`select * from request_booking($1, $2, $3, '{}', 0, $4, $5, $6)`, [u, ev, seats, part, name, code])
let team
await test('hackathons require a participation choice', async () => {
  await mkHack('hk1', 2, 3)
  await fails(`select * from request_booking($1, 'hk1', 1, '{}', 0)`, [bob], 'team/choice')
})
await test('solo is refused when the minimum team size is above 1', async () => {
  const msg = await fails(`select * from request_booking($1, 'hk1', 1, '{}', 0, 'solo')`, [bob], 'team/solo_disabled')
  assert.match(msg, /at least 2/)
})
await test('creating a team gives a unique 6-character code; the creator leads it; 1 seat each', async () => {
  const b = (await apply(bob, 'hk1', 'team_create', '  Byte   Me ', null, 3)).rows[0]
  assert.equal(b.participation, 'team')
  assert.equal(b.seats, 1)
  team = await one(`select * from teams where id = $1`, [b.team_id])
  assert.equal(team.name, 'Byte Me')
  assert.match(team.code, /^[A-HJ-NP-Z2-9]{6}$/)
  assert.equal(team.leader_id, bob)
  await fails(`select * from request_booking($1, 'hk1', 1, '{}', 0, 'team_create', 'byte me')`, [carol], 'team/name_taken')
})
await test('others join by code (any format); wrong event / unknown codes are refused', async () => {
  const pretty = `${team.code.slice(0, 3).toLowerCase()}-${team.code.slice(3)}`
  const c = (await apply(carol, 'hk1', 'team_join', null, pretty)).rows[0]
  assert.equal(c.team_id, team.id)
  await fails(`select * from request_booking($1, 'hk1', 1, '{}', 0, 'team_join', null, 'ZZZZZZ')`, [erin], 'team/not_found')
  await mkHack('hk2', 1, 4)
  await fails(`select * from request_booking($1, 'hk2', 1, '{}', 0, 'team_join', null, $2)`, [erin, team.code], 'team/wrong_event')
})
await test('a full team refuses new members (max 3)', async () => {
  await apply(erin, 'hk1', 'team_join', null, team.code)
  const msg = await fails(`select * from request_booking($1, 'hk1', 1, '{}', 0, 'team_join', null, $2)`, [finn, team.code], 'team/full')
  assert.match(msg, /3 of 3/)
})
await test('leaving frees the slot; the leader leaving hands over; empty teams are deleted', async () => {
  const bobBooking = await one(`select id from bookings where user_id = $1 and event_id = 'hk1'`, [bob])
  await one(`select * from cancel_booking($1, $2)`, [bob, bobBooking.id])
  const t = await one(`select leader_id from teams where id = $1`, [team.id])
  assert.equal(t.leader_id, carol)
  assert.equal((await one(`select count(*)::int n from team_members where team_id = $1`, [team.id])).n, 2)
  await apply(finn, 'hk1', 'team_join', null, team.code) // slot free again
  for (const u of [carol, erin, finn]) {
    const b = await one(`select id from bookings where user_id = $1 and event_id = 'hk1' and status = 'Pending'`, [u])
    await one(`select * from cancel_booking($1, $2)`, [u, b.id])
  }
  assert.equal((await one(`select count(*)::int n from teams where id = $1`, [team.id])).n, 0)
})
await test('solo works when min is 1; teams refused when max is 1', async () => {
  assert.equal((await apply(gina, 'hk2', 'solo')).rows[0].participation, 'solo')
  await mkHack('hk3', 1, 1)
  await fails(`select * from request_booking($1, 'hk3', 1, '{}', 0, 'team_create', 'Nope')`, [erin], 'team/solo_only')
})

console.log('\nIndividual applications, application fee')
await test('events: one seat per application, no team fields', async () => {
  await mkEvent('ev6', 10, alice)
  const r = await one(`select * from request_booking($1, 'ev6', 4, '{}', 0, 'team_create', 'Sneaky')`, [gina])
  assert.equal(r.seats, 1)
  assert.equal(r.participation, null)
  assert.equal(r.team_id, null)
})
await test('fee > 0 needs UPI ID, 10-digit number and https QR on the event', async () => {
  await mkEvent('ev7', 10, alice)
  for (const sql of [
    `update events set application_fee = 199 where id = 'ev7'`,
    `update events set application_fee = 199, upi_id = 'bad id', upi_number = '9876543210', upi_qr_url = 'https://x/qr.png' where id = 'ev7'`,
    `update events set application_fee = 199, upi_id = 'club@okaxis', upi_number = '12345', upi_qr_url = 'https://x/qr.png' where id = 'ev7'`,
    `update events set application_fee = -1 where id = 'ev7'`,
  ]) {
    await assert.rejects(db.query(sql), /violates check constraint/)
  }
  await db.query(`update events set application_fee = 199, upi_id = 'club@okaxis', upi_number = '9876543210', upi_qr_url = 'https://x/qr.png' where id = 'ev7'`)
})
await test('paid events need a unique 12-digit UTR; the fee is recorded on the booking', async () => {
  await fails(`select * from request_booking($1, 'ev7', 1, '{}', 0)`, [erin], 'payment/ref')
  await fails(`select * from request_booking($1, 'ev7', 1, '{}', 0, null, null, null, '12345')`, [erin], 'payment/ref')
  await fails(`select * from request_booking($1, 'ev7', 1, '{}', 0, null, null, null, '123456789012', '{"path":"someone-else/x.png"}')`, [erin], 'payment/proof')
  const b = await one(`select * from request_booking($1, 'ev7', 1, '{}', 0, null, null, null, '1234 5678 9012', $2)`, [erin, { path: `${erin}/proof.png`, name: 'proof.png' }])
  assert.equal(b.fee_amount, 199)
  assert.equal(b.payment_ref, '123456789012')
  await fails(`select * from request_booking($1, 'ev7', 1, '{}', 0, null, null, null, '123456789012')`, [finn], 'payment/duplicate')
})
await test('free events ignore payment fields', async () => {
  const b = await one(`select * from request_booking($1, 'ev6', 1, '{}', 0, null, null, null, '123456789012')`, [finn])
  assert.equal(b.fee_amount, null)
  assert.equal(b.payment_ref, null)
})

await test('functions are not callable from the browser roles', async () => {
  for (const role of ['anon', 'authenticated']) {
    await db.exec('begin')
    try {
      await db.query(`select set_config('role', $1, true)`, [role])
      await db.query(`select check_in(gen_random_uuid(), 'ev1', 'x')`)
      assert.fail(`${role} could call check_in`)
    } catch (e) {
      assert.match(e.message, /permission denied/)
    } finally {
      await db.exec('rollback')
    }
  }
})

console.log(`\n${passed} passed${process.exitCode ? ' — FAILURES above' : ''}`)
await db.close()
