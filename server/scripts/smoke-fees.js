// End-to-end (live API + Supabase): individual applications + application fee.
// Creates temporary accounts + a paid workshop and removes everything it created.
//   npm run smoke:fees   (API must be running)
import assert from 'node:assert/strict'
import { admin } from '../src/lib/supabase.js'

const API = (process.env.API_URL || `http://localhost:${process.env.PORT || 4000}/api`).replace(/\/$/, '')
let passed = 0
const cleanup = { users: [], events: [] }

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
async function tempUser(email, name, role = 'attendee') {
  const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
  const old = list.users.find((u) => u.email === email)
  if (old) await admin.auth.admin.deleteUser(old.id)
  const { data, error } = await admin.auth.admin.createUser({ email, password: 'Smoke-pass-2026', email_confirm: true, user_metadata: { name } })
  if (error) throw error
  cleanup.users.push(data.user.id)
  await admin.from('profiles').update({ username: email.split('@')[0].replace(/[^a-z0-9_]/g, '_').slice(0, 20), onboarding_completed: true, role }).eq('id', data.user.id)
  const r = await call('POST', '/auth/login', { body: { email, password: 'Smoke-pass-2026' } })
  return { id: data.user.id, token: r.data.session.accessToken }
}
const inDays = (n) => new Date(Date.now() + n * 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
const UPI = { upiId: 'smokeclub@okaxis', upiNumber: '+91 98765 43210', upiQrUrl: 'https://example.com/smoke-qr.png' }

console.log(`Fees smoke → ${API}`)
try {
  const host = await tempUser('cf_fee_host@codefolio.dev', 'Fee Host', 'organizer')
  const ann = await tempUser('cf_fee_ann@codefolio.dev', 'Fee Ann')
  const bo = await tempUser('cf_fee_bo@codefolio.dev', 'Fee Bo')
  let ev
  const base = {
    title: 'Smoke Paid Workshop', category: 'workshop', mode: 'Online', city: 'Online', venue: 'Online',
    date: inDays(6), time: '10:00', organizerChapter: 'Smoke Club', capacity: 20,
    description: 'Temporary paid workshop created by the fees smoke test. Safe to delete.',
  }

  await step('fee > 0 requires UPI ID, UPI number and QR image', async () => {
    const r = await call('POST', '/events', { token: host.token, body: { ...base, applicationFee: 199 } })
    assert.equal(r.status, 422)
    assert.deepEqual(Object.keys(r.data.error.fields).sort(), ['upiId', 'upiNumber', 'upiQrUrl'])
  })
  await step('host creates a ₹199 workshop; number is normalised; host sees UPI details', async () => {
    const r = await call('POST', '/events', { token: host.token, body: { ...base, applicationFee: 199, ...UPI } })
    assert.equal(r.status, 201, JSON.stringify(r.data))
    ev = r.data.event
    cleanup.events.push(ev.id)
    assert.equal(ev.applicationFee, 199)
    assert.deepEqual(ev.payment, { upiId: 'smokeclub@okaxis', upiNumber: '9876543210', qrUrl: UPI.upiQrUrl })
    const f = await call('PUT', `/admin/events/${ev.id}/form`, { token: host.token, body: { questions: [] } })
    assert.equal(f.status, 200)
  })
  await step('public list shows the fee but not the UPI details; applicants get them with the form', async () => {
    const pub = (await call('GET', '/events')).data.events.find((e) => e.id === ev.id)
    assert.equal(pub.applicationFee, 199)
    assert.equal(pub.payment, undefined)
    const other = (await call('GET', '/events', { token: ann.token })).data.events.find((e) => e.id === ev.id)
    assert.equal(other.payment, undefined)
    const form = (await call('GET', `/events/${ev.id}/form`, { token: ann.token })).data
    assert.deepEqual(form.payment, { fee: 199, upiId: 'smokeclub@okaxis', upiNumber: '9876543210', qrUrl: UPI.upiQrUrl })
  })
  await step('applying needs a 12-digit UTR; one seat per person; team fields ignored for events', async () => {
    assert.equal((await call('POST', '/bookings', { token: ann.token, body: { eventId: ev.id } })).data.error.code, 'payment/ref')
    const r = await call('POST', '/bookings', {
      token: ann.token,
      body: { eventId: ev.id, seats: 4, participation: 'team_create', teamName: 'Nope', paymentRef: '4123 4567 8901' },
    })
    assert.equal(r.status, 201, JSON.stringify(r.data))
    assert.equal(r.data.booking.seats, 1)
    assert.equal(r.data.booking.team, null)
    assert.equal(r.data.booking.participation, null)
    assert.equal(r.data.booking.feeAmount, 199)
    assert.equal(r.data.booking.paymentRef, '412345678901')
  })
  await step('the same UTR can’t be reused for the event', async () => {
    const r = await call('POST', '/bookings', { token: bo.token, body: { eventId: ev.id, paymentRef: '412345678901' } })
    assert.equal(r.status, 409)
    assert.equal(r.data.error.code, 'payment/duplicate')
  })
  await step('host sees fee + UTR in the list and the answers view', async () => {
    const row = (await call('GET', '/admin/bookings', { token: host.token })).data.bookings.find((b) => b.eventId === ev.id)
    assert.equal(row.paymentRef, '412345678901')
    const a = (await call('GET', `/admin/bookings/${row.id}/answers`, { token: host.token })).data
    assert.deepEqual(a.payment, { amount: 199, ref: '412345678901', proof: null })
  })
  await step('setting the fee back to 0 clears the UPI details; applying needs no UTR', async () => {
    const r = await call('PUT', `/events/${ev.id}`, { token: host.token, body: { ...base, applicationFee: 0, ...UPI } })
    assert.equal(r.status, 200, JSON.stringify(r.data))
    assert.equal(r.data.event.applicationFee, 0)
    assert.equal(r.data.event.payment, undefined)
    const b = await call('POST', '/bookings', { token: bo.token, body: { eventId: ev.id } })
    assert.equal(b.status, 201, JSON.stringify(b.data))
    assert.equal(b.data.booking.feeAmount, null)
  })
} finally {
  for (const id of cleanup.events) await admin.rpc('delete_event', { p_event: id })
  for (const id of cleanup.users) await admin.auth.admin.deleteUser(id)
  console.log(`  ✓ cleanup: ${cleanup.events.length} event, ${cleanup.users.length} users removed`)
  console.log(`\n${passed} passed${process.exitCode ? ', FAILED' : ''}`)
}
