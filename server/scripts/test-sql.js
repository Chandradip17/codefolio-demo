// Runs supabase/schema.sql against an in-memory Postgres (PGlite) with a stub
// of Supabase's auth schema, then exercises the booking functions.
// Usage: npm run test:sql
import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
const schema = await readFile(new URL('../supabase/schema.sql', import.meta.url), 'utf8')

// Stand-ins for what Supabase provides.
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  create table auth.users (id uuid primary key default gen_random_uuid(), email text unique, raw_user_meta_data jsonb default '{}');
`)
await db.exec(schema)
await db.exec(schema) // idempotent re-run

let passed = 0
const test = async (name, fn) => {
  await fn()
  passed++
  console.log(`  ✓ ${name}`)
}
const one = async (sql, params) => (await db.query(sql, params)).rows[0]
const fails = async (sql, params, code) => {
  try {
    await db.query(sql, params)
  } catch (e) {
    assert.equal(e.hint, code, `expected ${code}, got ${e.hint}: ${e.message}`)
    return e.message
  }
  assert.fail(`expected failure ${code}`)
}
const user = async (email, meta) =>
  (await one(`insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id`, [email, meta])).id

console.log('schema.sql')
const aditi = await user('aditi@example.com', { name: 'Aditi Rao', role: 'attendee', city: 'Bengaluru' })
const kabir = await user('kabir@example.com', { name: 'Kabir' })
const org = await user('org@example.com', { name: 'Rahul Verma', role: 'organizer', chapter: 'GDG Bengaluru' })

await test('trigger creates profiles with role from metadata', async () => {
  const p = await one(`select * from profiles where id = $1`, [org])
  assert.equal(p.role, 'organizer')
  assert.equal(p.chapter, 'GDG Bengaluru')
  assert.equal((await one(`select role from profiles where id = $1`, [kabir])).role, 'attendee')
})

const insertEvent = (id, capacity, available, extra = '') =>
  db.query(
    `insert into events (id, title, type, category, mode, city, venue, date, start_time, organizer_chapter, capacity, available_seats, created_by ${extra ? ', status' : ''})
     values ($1, 'Build with Gemini Hack Night', 'Hackathon', 'hackathon', 'In-person', 'Bengaluru', 'Koramangala', current_date + 5, '18:00', 'GDG Bengaluru', $2, $3, $4 ${extra ? `, '${extra}'` : ''})`,
    [id, capacity, available, org],
  )
await insertEvent('cf-101', 500, 375)
await insertEvent('cf-sold', 80, 0)
await insertEvent('cf-cancelled', 50, 50, 'Cancelled')

await test('seat check constraint rejects available > capacity', async () => {
  await assert.rejects(insertEvent('cf-bad', 10, 11))
})

let booking
await test('book_seats: 375 → 373 and returns booking with CF- id + snapshot', async () => {
  booking = await one(`select * from book_seats($1, 'cf-101', 2)`, [aditi])
  assert.match(booking.booking_id, /^CF-[A-Z2-9]{6}$/)
  assert.equal(booking.seats, 2)
  assert.equal(booking.attendee_name, 'Aditi Rao')
  assert.equal(booking.event_snapshot.title, 'Build with Gemini Hack Night')
  assert.equal(booking.event_snapshot.time, '18:00')
  assert.equal((await one(`select available_seats from events where id = 'cf-101'`)).available_seats, 373)
})

await test('duplicate booking is rejected', async () => {
  const msg = await fails(`select * from book_seats($1, 'cf-101', 1)`, [aditi], 'booking/duplicate')
  assert.match(msg, /CF-/)
})
await test('sold out is rejected', () => fails(`select * from book_seats($1, 'cf-sold', 1)`, [kabir], 'booking/soldout'))
await test('cancelled event is rejected', () => fails(`select * from book_seats($1, 'cf-cancelled', 1)`, [kabir], 'event/cancelled'))
await test('organizer cannot book', () => fails(`select * from book_seats($1, 'cf-101', 1)`, [org], 'booking/role'))
await test('seat count must be 1–4', () => fails(`select * from book_seats($1, 'cf-101', 5)`, [kabir], 'booking/seats'))
await test('missing event', () => fails(`select * from book_seats($1, 'nope', 1)`, [kabir], 'event/missing'))

await test('cannot take more seats than remain', async () => {
  await insertEvent('cf-tiny', 3, 1)
  await fails(`select * from book_seats($1, 'cf-tiny', 2)`, [kabir], 'booking/insufficient')
})

await test('cancel_booking releases seats (373 → 375) and blocks double cancel', async () => {
  const c = await one(`select * from cancel_booking($1, $2)`, [aditi, booking.id])
  assert.equal(c.status, 'Cancelled')
  assert.equal((await one(`select available_seats from events where id = 'cf-101'`)).available_seats, 375)
  await fails(`select * from cancel_booking($1, $2)`, [aditi, booking.id], 'booking/inactive')
})
await test("cannot cancel someone else's booking", async () => {
  const b = await one(`select * from book_seats($1, 'cf-101', 1)`, [kabir])
  await fails(`select * from cancel_booking($1, $2)`, [aditi, b.id], 'booking/missing')
})
await test('can re-book after cancelling (partial unique index)', async () => {
  const b = await one(`select * from book_seats($1, 'cf-101', 1)`, [aditi])
  assert.equal(b.status, 'Confirmed')
})

await test('set_event_capacity keeps booked seats and refuses to go below them', async () => {
  // cf-101: capacity 500, 373 left → 127 booked
  const ev = await one(`select * from set_event_capacity('cf-101', 600)`)
  assert.equal(ev.capacity, 600)
  assert.equal(ev.available_seats, 473)
  await fails(`select * from set_event_capacity('cf-101', 100)`, [], 'event/capacity')
})

await test('editing an event refreshes booking snapshots', async () => {
  await db.query(`update events set title = 'Gemini Agents Night (Updated)' where id = 'cf-101'`)
  const b = await one(`select event_snapshot from bookings where user_id = $1 and status = 'Confirmed'`, [aditi])
  assert.equal(b.event_snapshot.title, 'Gemini Agents Night (Updated)')
})

await test('delete_event cancels active bookings, keeps snapshots, nulls event_id', async () => {
  await db.query(`select delete_event('cf-101')`)
  const rows = (await db.query(`select status, event_id, event_snapshot from bookings where event_snapshot->>'title' like 'Gemini%'`)).rows
  assert.ok(rows.length >= 2)
  assert.ok(rows.every((r) => r.status === 'Cancelled' && r.event_id === null && r.event_snapshot.title))
  await fails(`select delete_event('cf-101')`, [], 'event/missing')
})

await test('booking codes are unique across many bookings', async () => {
  await insertEvent('cf-big', 5000, 5000)
  const ids = new Set()
  for (let i = 0; i < 40; i++) {
    const u = await user(`bulk${i}@example.com`, { name: `Bulk ${i}` })
    ids.add((await one(`select booking_id from book_seats($1, 'cf-big', 1)`, [u])).booking_id)
  }
  assert.equal(ids.size, 40)
  assert.equal((await one(`select available_seats from events where id = 'cf-big'`)).available_seats, 4960)
})

console.log(`\n${passed} passed`)
await db.close()
