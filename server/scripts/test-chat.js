// Participant Chat rules (in-memory Postgres).   npm run test:chat
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

const [judge, out] = await Promise.all([user('judge@x.dev'), user('out@x.dev')])
await db.query(`update profiles set is_judge = true where id = $1`, [judge])
await db.query(
  `insert into events (id, title, type, category, mode, city, venue, date, start_time, organizer_chapter, capacity, available_seats, created_by, team_min, team_max)
   values ('hk2', 'Other Hack', 'Hackathon', 'hackathon', 'Online', 'Online', 'Online', current_date + 7, '10:00', 'GDG', 50, 50, $1, 1, 2),
          ('old', 'Past Hack', 'Hackathon', 'hackathon', 'Online', 'Online', 'Online', current_date - 3, '10:00', 'GDG', 50, 50, $1, 1, 2)`,
  [host],
)
const apply = (u, ev = 'hk') => one(`select * from request_booking($1, $2, 1, '{}', 0, 'solo')`, [u, ev])
await apply(ana)
await apply(ben)
await apply(cy, 'hk2')
await db.query(`insert into judge_assignments (event_id, judge_id, assigned_by) values ('hk', $1, $2)`, [judge, host])
const LIMITS = [1, 3, 200, 60, true] // cooldown s, per minute, max length, duplicate window s, read-only after end
const send = (u, text, ev = 'hk', limits = LIMITS) => one(`select send_chat_message($1, $2, $3, $4, $5, $6, $7, $8) r`, [u, ev, text, ...limits]).then((x) => x.r)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

console.log('\nParticipant Chat')
await test('access: participants in; judges, outsiders and other hackathons out; organizer moderates only', async () => {
  const room = (await one(`select chat_room_for($1, 'hk', true) r`, [ana])).r
  assert.equal(room.participant, true)
  assert.equal(room.active, true)
  assert.equal((await one(`select chat_room_for($1, 'hk', true) r`, [host])).r.moderator, true)
  await fails(`select chat_room_for($1, 'hk', true)`, [judge], 'chat/forbidden')
  await fails(`select chat_room_for($1, 'hk', true)`, [out], 'chat/forbidden')
  await fails(`select chat_room_for($1, 'hk', true)`, [cy], 'chat/forbidden') // registered for hk2 only
  assert.equal((await send(cy, 'sneaking in')).code, 'chat/forbidden')
  assert.equal((await send(judge, 'hello')).code, 'chat/forbidden')
  assert.equal((await send(host, 'hello')).code, 'chat/not_participant')
  await fails(`select chat_messages_page($1, 'hk', null, 50)`, [judge], 'chat/forbidden')
})
let first
await test('send: trims, rejects empty / too long; stored as the real sender', async () => {
  assert.equal((await send(ana, '   ')).code, 'chat/empty')
  assert.equal((await send(ana, 'x'.repeat(201))).code, 'chat/too_long')
  const r = await send(ana, '  Anyone working on React + AI?  ')
  assert.equal(r.ok, true)
  first = r.message
  assert.equal(first.message, 'Anyone working on React + AI?')
  assert.equal(first.userId, ana)
})
await test('cooldown enforced in the database, then allowed after it passes', async () => {
  const r = await send(ana, 'second one')
  assert.equal(r.code, 'chat/cooldown')
  assert.equal(r.retryAfter, 1)
  assert.match(r.message, /Please wait 1 second before/)
  await sleep(1100)
  assert.equal((await send(ana, 'second one')).ok, true)
})
await test('duplicate message within the window is rejected', async () => {
  await sleep(1100)
  assert.equal((await send(ana, 'SECOND ONE')).code, 'chat/duplicate')
})
await test('burst limit: at most N per minute even with no cooldown', async () => {
  const noCooldown = [0, 3, 200, 0, true]
  assert.equal((await send(ben, 'a', 'hk', noCooldown)).ok, true)
  assert.equal((await send(ben, 'b', 'hk', noCooldown)).ok, true)
  assert.equal((await send(ben, 'c', 'hk', noCooldown)).ok, true)
  const r = await send(ben, 'd', 'hk', noCooldown)
  assert.equal(r.code, 'chat/rate_limited')
  assert.ok(r.retryAfter >= 1 && r.retryAfter <= 60)
})
await test('history is per hackathon, newest first, cursor pagination', async () => {
  const p1 = (await one(`select chat_messages_page($1, 'hk', null, 2) r`, [ben])).r
  assert.deepEqual(p1.messages.map((m) => m.message), ['c', 'b'])
  assert.equal(p1.hasMore, true)
  const p2 = (await one(`select chat_messages_page($1, 'hk', $2, 50) r`, [ben, p1.messages[1].id])).r
  assert.deepEqual(p2.messages.map((m) => m.message), ['a', 'second one', 'Anyone working on React + AI?'])
  assert.equal(p2.hasMore, false)
  await apply(dee, 'hk2')
  assert.equal((await send(cy, 'hk2 only', 'hk2')).ok, true)
  assert.deepEqual((await one(`select chat_messages_page($1, 'hk2', null, 50) r`, [dee])).r.messages.map((m) => m.message), ['hk2 only'])
  await fails(`select chat_messages_page($1, 'hk2', $2, 50)`, [dee, first.id], 'chat/cursor') // cursor from another chat
})
let report
await test('reports: once per member per message; not your own; moderator-only review', async () => {
  await fails(`select * from report_chat_message($1, $2, 'spam', '')`, [ana, first.id], 'chat/own_message')
  await fails(`select * from report_chat_message($1, $2, 'spam', '')`, [cy, first.id], 'chat/missing') // not in that chat
  report = await one(`select * from report_chat_message($1, $2, 'spam', 'ad')`, [ben, first.id])
  assert.equal(report.status, 'pending')
  await fails(`select * from report_chat_message($1, $2, 'spam', '')`, [ben, first.id], 'chat/already_reported')
  await fails(`select chat_moderation($1, 'hk')`, [ana], 'auth/forbidden')
  const mod = (await one(`select chat_moderation($1, 'hk') r`, [host])).r
  assert.equal(mod.reports[0].message.text, 'Anyone working on React + AI?')
  assert.equal(mod.reports[0].reporter.id, ben)
})
await test('delete: moderator soft-deletes (content hidden, row kept); participants can’t', async () => {
  await fails(`select * from chat_delete_message($1, $2)`, [ben, first.id], 'auth/forbidden')
  await one(`select * from chat_delete_message($1, $2)`, [host, first.id])
  const row = await one(`select deleted_at, message from chat_messages where id = $1`, [first.id])
  assert.ok(row.deleted_at && row.message) // audit copy kept
  const page = (await one(`select chat_messages_page($1, 'hk', null, 50) r`, [ben])).r.messages
  const m = page.find((x) => x.id === first.id)
  assert.equal(m.deleted, true)
  assert.equal(m.message, null)
  assert.equal((await one(`select status from chat_message_reports where id = $1`, [report.id])).status, 'action_taken')
})
await test('mute: scoped to the hackathon, blocks sending until it expires; unmute', async () => {
  await fails(`select * from chat_mute_user($1, 'hk', $2, now() + interval '1 hour', '')`, [ana, ben], 'auth/forbidden')
  await fails(`select * from chat_mute_user($1, 'hk', $2, now() + interval '1 hour', '')`, [host, out], 'chat/not_member')
  await one(`select * from chat_mute_user($1, 'hk', $2, now() + interval '1 hour', 'spam')`, [host, ana])
  await sleep(1100)
  const r = await send(ana, 'am I muted?', 'hk', [1, 50, 200, 60, true])
  assert.equal(r.code, 'chat/muted')
  assert.ok(r.mutedUntil)
  assert.ok((await one(`select chat_messages_page($1, 'hk', null, 50) r`, [ana])).r.messages.length > 0) // can still read
  await db.query(`update chat_mutes set muted_until = now() - interval '1 second' where user_id = $1`, [ana]) // expired
  { const x = await send(ana, 'back again', 'hk', [1, 50, 200, 60, true]); assert.equal(x.ok, true, JSON.stringify(x)) }
  await one(`select * from chat_mute_user($1, 'hk', $2, now() + interval '1 hour', '')`, [host, ana])
  await one(`select chat_unmute_user($1, 'hk', $2)`, [host, ana])
  await sleep(1100)
  { const x = await send(ana, 'unmuted', 'hk', [1, 50, 200, 60, true]); assert.equal(x.ok, true, JSON.stringify(x)) }
})
await test('closed room and ended hackathon are read-only (configurable)', async () => {
  await fails(`select * from chat_set_room_active($1, 'hk', false)`, [ana], 'auth/forbidden')
  await one(`select * from chat_set_room_active($1, 'hk', false)`, [host])
  await sleep(1100)
  assert.equal((await send(ben, 'closed?')).code, 'chat/closed')
  assert.equal((await one(`select chat_room_for($1, 'hk', true) r`, [ben])).r.active, false)
  await one(`select * from chat_set_room_active($1, 'hk', true)`, [host])
  // A participant of a hackathon that has already ended.
  await db.query(
    `insert into bookings (booking_id, user_id, event_id, seats, status, attendee_name, attendee_email, event_snapshot) values ('CF-OLD1', $1, 'old', 1, 'Confirmed', 'Eve', 'eve@x.dev', '{}')`,
    [eve],
  )
  assert.equal((await send(eve, 'after the end', 'old')).code, 'chat/read_only')
  assert.equal((await send(eve, 'allowed when configured', 'old', [1, 3, 200, 60, false])).ok, true)
})
await test('audience: participants + organizer, never judges or outsiders', async () => {
  const ids = (await db.query(`select * from chat_audience('hk')`)).rows.map((r) => Object.values(r)[0])
  assert.ok(ids.includes(ana) && ids.includes(ben) && ids.includes(host))
  assert.ok(!ids.includes(judge) && !ids.includes(out) && !ids.includes(cy))
})
await test('browser roles have no access to chat tables or functions', async () => {
  for (const sql of [`select * from chat_messages`, `select * from chat_message_reports`, `select send_chat_message('${ana}', 'hk', 'x', 0, 0, 100, 0, true)`]) {
    await db.exec('begin; set local role authenticated;')
    await assert.rejects(db.query(sql), /permission denied/)
    await db.exec('rollback')
  }
})
console.log(`\n${passed} passed${process.exitCode ? ', FAILED' : ''}`)
