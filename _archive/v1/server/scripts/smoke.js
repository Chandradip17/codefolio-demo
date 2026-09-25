// End-to-end smoke test against a running API connected to Supabase.
// Prereqs: schema.sql applied, `npm run seed` done, `npm run dev` running.
//   npm run smoke                      (defaults to http://localhost:4000/api)
//   API_URL=https://… npm run smoke
import assert from 'node:assert/strict'
import { admin } from '../src/lib/supabase.js'

const API = (process.env.API_URL || `http://localhost:${process.env.PORT || 4000}/api`).replace(/\/$/, '')
let passed = 0

async function call(method, path, { token, body } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  return { status: res.status, data: text ? JSON.parse(text) : null }
}
async function step(name, fn) {
  try {
    await fn()
    passed++
    console.log(`  ✓ ${name}`)
  } catch (e) {
    console.error(`  ✗ ${name}\n    ${e.message}`)
    process.exitCode = 1
    throw e
  }
}
const inDays = (n) => new Date(Date.now() + n * 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })

console.log(`Smoke test → ${API}`)
let attendee, organizer, target, booking, created

try {
  await step('health: database reachable', async () => {
    const r = await call('GET', '/health')
    assert.equal(r.status, 200, JSON.stringify(r.data))
    assert.equal(r.data.database, 'ok')
  })

  await step('login rejects a wrong password', async () => {
    const r = await call('POST', '/auth/login', { body: { email: 'demo@codefolio.dev', password: 'wrong-password' } })
    assert.equal(r.status, 401)
  })

  await step('attendee + organizer log in', async () => {
    const a = await call('POST', '/auth/login', { body: { email: 'demo@codefolio.dev', password: 'demo1234' } })
    const o = await call('POST', '/auth/login', { body: { email: 'organizer@codefolio.dev', password: 'organizer1234' } })
    assert.equal(a.status, 200, JSON.stringify(a.data))
    assert.equal(o.status, 200, JSON.stringify(o.data))
    assert.equal(a.data.user.role, 'attendee')
    assert.equal(o.data.user.role, 'organizer')
    attendee = { ...a.data.user, token: a.data.session.accessToken, refresh: a.data.session.refreshToken }
    organizer = { ...o.data.user, token: o.data.session.accessToken }
  })

  await step('GET /auth/me + token refresh', async () => {
    assert.equal((await call('GET', '/auth/me', { token: attendee.token })).data.user.email, 'demo@codefolio.dev')
    const r = await call('POST', '/auth/refresh', { body: { refreshToken: attendee.refresh } })
    assert.equal(r.status, 200)
    attendee.token = r.data.session.accessToken
  })

  await step('organizer creates a test event (capacity 2)', async () => {
    const r = await call('POST', '/events', {
      token: organizer.token,
      body: {
        title: 'Smoke Test Build Night', category: 'hackathon', mode: 'In-person', city: 'Pune', venue: 'Test Venue, Pune',
        date: inDays(10), time: '18:00', organizerChapter: 'GDG Pune', capacity: 2,
        description: 'Temporary event created by the Codefolio smoke test. Safe to delete.', requirements: ['Laptop'], learn: ['Testing'], tags: ['test'],
      },
    })
    assert.equal(r.status, 201, JSON.stringify(r.data))
    created = r.data.event
    assert.equal(created.availableSeats, 2)
    assert.equal(created.createdBy, organizer.id)
  })

  await step('validation errors come back per field', async () => {
    const r = await call('POST', '/events', { token: organizer.token, body: { title: 'x' } })
    assert.equal(r.status, 422)
    assert.ok(r.data.error.fields.title)
  })

  await step('attendee cannot create events (403)', async () => {
    assert.equal((await call('POST', '/events', { token: attendee.token, body: {} })).status, 403)
  })

  await step('book 1 seat: 2 → 1', async () => {
    target = created
    const r = await call('POST', '/bookings', { token: attendee.token, body: { eventId: target.id, seats: 1 } })
    assert.equal(r.status, 201, JSON.stringify(r.data))
    booking = r.data.booking
    assert.match(booking.bookingId, /^CF-[A-Z2-9]{6}$/)
    assert.equal(r.data.event.availableSeats, 1)
  })

  await step('duplicate booking → 409', async () => {
    const r = await call('POST', '/bookings', { token: attendee.token, body: { eventId: target.id, seats: 1 } })
    assert.equal(r.status, 409)
    assert.equal(r.data.error.code, 'booking/duplicate')
  })

  await step('organizer cannot book (403)', async () => {
    const r = await call('POST', '/bookings', { token: organizer.token, body: { eventId: target.id, seats: 1 } })
    assert.equal(r.status, 403)
  })

  await step('booking appears in /bookings/me and organizer attendee list', async () => {
    const mine = await call('GET', '/bookings/me', { token: attendee.token })
    assert.ok(mine.data.bookings.some((b) => b.id === booking.id))
    const org = await call('GET', '/admin/bookings', { token: organizer.token })
    assert.ok(org.data.bookings.some((b) => b.id === booking.id))
    assert.equal((await call('GET', '/admin/bookings', { token: attendee.token })).status, 403)
  })

  await step('capacity cannot drop below booked seats (422); edit works', async () => {
    const body = {
      title: 'Smoke Test Build Night (edited)', category: 'hackathon', mode: 'In-person', city: 'Pune', venue: 'Test Venue, Pune',
      date: inDays(10), time: '18:30', organizerChapter: 'GDG Pune', capacity: 0,
      description: 'Temporary event created by the Codefolio smoke test. Safe to delete.',
    }
    assert.equal((await call('PUT', `/events/${created.id}`, { token: organizer.token, body })).status, 422)
    const r = await call('PUT', `/events/${created.id}`, { token: organizer.token, body: { ...body, capacity: 5 } })
    assert.equal(r.status, 200, JSON.stringify(r.data))
    assert.equal(r.data.event.capacity, 5)
    assert.equal(r.data.event.availableSeats, 4)
    const mine = await call('GET', '/bookings/me', { token: attendee.token })
    assert.equal(mine.data.bookings.find((b) => b.id === booking.id).event.title, 'Smoke Test Build Night (edited)')
  })

  await step('cancel booking releases the seat: 4 → 5', async () => {
    const r = await call('POST', `/bookings/${booking.id}/cancel`, { token: attendee.token })
    assert.equal(r.status, 200, JSON.stringify(r.data))
    assert.equal(r.data.booking.status, 'Cancelled')
    assert.equal(r.data.event.availableSeats, 5)
  })

  await step('cancelled event rejects bookings', async () => {
    assert.equal((await call('POST', `/events/${created.id}/cancel`, { token: organizer.token })).data.event.status, 'Cancelled')
    const r = await call('POST', '/bookings', { token: attendee.token, body: { eventId: created.id, seats: 1 } })
    assert.equal(r.data.error.code, 'event/cancelled')
  })

  await step('live feeds respond', async () => {
    const [g, d] = await Promise.all([call('GET', '/live/gdg'), call('GET', '/live/devfolio')])
    assert.equal(g.status, 200)
    assert.equal(d.status, 200)
    console.log(`    (${g.data.events.length} GDG, ${d.data.events.length} Devfolio)`)
  })
} finally {
  if (created && organizer) {
    const r = await call('DELETE', `/events/${created.id}`, { token: organizer.token })
    console.log(r.status === 204 ? '  ✓ cleanup: test event deleted' : `  ! cleanup failed (${r.status}); delete "${created.title}" manually`)
  }
  // The API has no "delete booking" endpoint (attendees cancel, history is kept),
  // so remove the test booking directly, keeping the demo account's history clean.
  if (booking && admin) {
    const { error } = await admin.from('bookings').delete().eq('id', booking.id)
    console.log(error ? `  ! could not remove test booking ${booking.bookingId}: ${error.message}` : '  ✓ cleanup: test booking removed')
  }
  console.log(`\n${passed} passed${process.exitCode ? ', FAILED' : ''}`)
}
