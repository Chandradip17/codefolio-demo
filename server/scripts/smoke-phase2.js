// End-to-end (live API + Supabase): host approval → event → custom form →
// application → host approval → QR → check-in. Creates temporary accounts and
// removes everything it created.   npm run smoke:phase2   (API must be running)
import assert from 'node:assert/strict'
import { admin } from '../src/lib/supabase.js'

const API = (process.env.API_URL || `http://localhost:${process.env.PORT || 4000}/api`).replace(/\/$/, '')
let passed = 0
const cleanup = { users: [], events: [], files: [] }

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
async function tempUser(email, name) {
  const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
  const old = list.users.find((u) => u.email === email)
  if (old) await admin.auth.admin.deleteUser(old.id)
  const { data, error } = await admin.auth.admin.createUser({ email, password: 'Smoke-pass-2026', email_confirm: true, user_metadata: { name } })
  if (error) throw error
  cleanup.users.push(data.user.id)
  await admin.from('profiles').update({ username: email.split('@')[0].replace(/[^a-z0-9_]/g, '_').slice(0, 20), onboarding_completed: true }).eq('id', data.user.id)
  const r = await call('POST', '/auth/login', { body: { email, password: 'Smoke-pass-2026' } })
  return { id: data.user.id, token: r.data.session.accessToken }
}
const inDays = (n) => new Date(Date.now() + n * 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })

console.log(`Phase 2 smoke → ${API}`)
try {
  const adm = (await call('POST', '/auth/login', { body: { email: 'organizer@codefolio.dev', password: 'organizer1234' } })).data
  const adminToken = adm.session.accessToken
  const host = await tempUser('cf_smoke_host@codefolio.dev', 'Smoke Host')
  const att = await tempUser('cf_smoke_att@codefolio.dev', 'Smoke Attendee')
  let request, event, booking, cred

  await step('unapproved member cannot create events (403)', async () => {
    const r = await call('POST', '/events', { token: host.token, body: {} })
    assert.equal(r.status, 403)
  })
  await step('member files a host request (pending); duplicate refused', async () => {
    const r = await call('POST', '/host-requests', { token: host.token, body: { type: 'hackathon', organization: 'Smoke Test Club', city: 'Pune', reason: 'We run a monthly campus hack night for 120 students.' } })
    assert.equal(r.status, 201, JSON.stringify(r.data))
    request = r.data.request
    assert.equal((await call('POST', '/host-requests', { token: host.token, body: { type: 'event', organization: 'Again', reason: 'Trying to file twice in a row here.' } })).status, 409)
  })
  await step('non-admins cannot review host requests (403)', async () => {
    assert.equal((await call('POST', `/platform/host-requests/${request.id}/approve`, { token: att.token })).status, 403)
  })
  await step('admin sees it with applicant email and approves', async () => {
    const list = await call('GET', '/platform/host-requests?status=pending', { token: adminToken })
    const row = list.data.requests.find((x) => x.id === request.id)
    assert.equal(row.applicant.email, 'cf_smoke_host@codefolio.dev')
    const r = await call('POST', `/platform/host-requests/${request.id}/approve`, { token: adminToken, body: { note: 'Welcome aboard' } })
    assert.equal(r.data.request.status, 'approved')
  })
  await step('approved host creates a hackathon (capacity 2)', async () => {
    const r = await call('POST', '/events', {
      token: host.token,
      body: {
        title: 'Smoke Hack Night', category: 'hackathon', mode: 'In-person', city: 'Pune', venue: 'Smoke Hall',
        date: inDays(5), time: '18:00', organizerChapter: 'Smoke Test Club', capacity: 2,
        description: 'Temporary hackathon created by the phase 2 smoke test. Safe to delete.',
      },
    })
    assert.equal(r.status, 201, JSON.stringify(r.data))
    event = r.data.event
    cleanup.events.push(event.id)
  })
  await step('default hackathon form is served; host customizes it (versioned)', async () => {
    const f = await call('GET', `/admin/events/${event.id}/form`, { token: host.token })
    assert.equal(f.data.form.isDefault, true)
    assert.ok(f.data.form.questions.find((q) => q.id === 'why'))
    const questions = [
      ...f.data.form.questions.filter((q) => ['full_name', 'why'].includes(q.id)),
      { id: 'track', type: 'multiple_choice', label: 'Tracks you like', required: true, options: ['AI', 'Web', 'Mobile'] },
      { id: 'resume', type: 'file', label: 'Resume (PDF)', required: false },
    ]
    const bad = await call('PUT', `/admin/events/${event.id}/form`, { token: host.token, body: { questions: [{ id: 'x', type: 'single_choice', label: 'Only one option', options: ['A'] }] } })
    assert.equal(bad.status, 422)
    const s = await call('PUT', `/admin/events/${event.id}/form`, { token: host.token, body: { questions } })
    assert.equal(s.data.form.version, 1)
    assert.equal((await call('GET', `/events/${event.id}/form`, { token: att.token })).data.form.questions.length, 4)
  })
  await step('answers are validated per question (422 with field errors)', async () => {
    const r = await call('POST', '/bookings', { token: att.token, body: { eventId: event.id, seats: 1, answers: { full_name: 'Smoke Attendee', track: ['Blockchain'] } } })
    assert.equal(r.status, 422)
    assert.ok(r.data.error.fields.why && r.data.error.fields.track)
  })
  await step('attendee uploads a file privately and applies → Pending, seats unchanged', async () => {
    const up = await call('POST', '/uploads/application-file', { token: att.token, body: { name: 'resume.txt', dataUrl: `data:text/plain;base64,${Buffer.from('smoke resume').toString('base64')}` } })
    assert.equal(up.status, 201, JSON.stringify(up.data))
    cleanup.files.push(up.data.file.path)
    const r = await call('POST', '/bookings', {
      token: att.token,
      body: { eventId: event.id, seats: 1, answers: { full_name: 'Smoke Attendee', why: 'To ship something in one night.', track: ['AI', 'Web'], resume: up.data.file } },
    })
    assert.equal(r.status, 201, JSON.stringify(r.data))
    booking = r.data.booking
    assert.equal(booking.status, 'Pending')
    assert.equal(r.data.event.availableSeats, 2)
  })
  await step('no QR before approval', async () => {
    const r = await call('GET', `/bookings/${booking.id}/credential`, { token: att.token })
    assert.equal(r.status, 409)
    assert.equal(r.data.error.code, 'qr/not_approved')
  })
  await step('host sees answers (file via signed link); other hosts cannot', async () => {
    const r = await call('GET', `/admin/bookings/${booking.id}/answers`, { token: host.token })
    assert.deepEqual(r.data.answers.track, ['AI', 'Web'])
    assert.match(r.data.answers.resume.url, /^https:\/\/.+token=/)
    assert.equal((await call('GET', `/admin/bookings/${booking.id}/answers`, { token: att.token })).status, 403)
  })
  await step('host approves → Confirmed, seats 2 → 1, QR issued', async () => {
    const r = await call('POST', `/admin/bookings/${booking.id}/approve`, { token: host.token })
    assert.equal(r.data.booking.status, 'Confirmed')
    assert.equal(r.data.event.availableSeats, 1)
    cred = (await call('GET', `/bookings/${booking.id}/credential`, { token: att.token })).data.credential
    assert.match(cred.token, /^[0-9a-f]{64}$/)
  })
  await step('regenerating revokes the old QR', async () => {
    const fresh = (await call('POST', `/bookings/${booking.id}/credential/regenerate`, { token: att.token })).data.credential
    const old = await call('POST', '/admin/checkin', { token: host.token, body: { eventId: event.id, code: `codefolio:ci:${cred.token}` } })
    assert.equal(old.data.error.code, 'checkin/revoked')
    cred = fresh
  })
  await step('wrong event is rejected (demo event cf-101 via its admin)', async () => {
    const r = await call('POST', '/admin/checkin', { token: adminToken, body: { eventId: 'cf-101', code: cred.manualCode } })
    assert.equal(r.data.error.code, 'checkin/wrong_event')
  })
  await step('manual code checks in once; second attempt says already checked in', async () => {
    const r = await call('POST', '/admin/checkin', { token: host.token, body: { eventId: event.id, code: cred.manualCode } })
    assert.equal(r.status, 200, JSON.stringify(r.data))
    assert.equal(r.data.result.attendeeName, 'Smoke Attendee')
    const again = await call('POST', '/admin/checkin', { token: host.token, body: { eventId: event.id, code: `codefolio:ci:${cred.token}` } })
    assert.equal(again.data.error.code, 'checkin/already')
    const att2 = await call('GET', `/admin/events/${event.id}/attendance`, { token: host.token })
    assert.equal(att2.data.attendance.length, 1)
  })
  await step('attendance is irreversible (remove refused)', async () => {
    const r = await call('POST', `/admin/bookings/${booking.id}/remove`, { token: host.token })
    assert.equal(r.data.error.code, 'booking/state')
  })
} finally {
  for (const id of cleanup.events) await admin.rpc('delete_event', { p_event: id })
  if (cleanup.files.length) await admin.storage.from('application-files').remove(cleanup.files)
  for (const id of cleanup.users) await admin.auth.admin.deleteUser(id)
  console.log(`  ✓ cleanup: ${cleanup.events.length} event, ${cleanup.files.length} file, ${cleanup.users.length} users removed`)
  console.log(`\n${passed} passed${process.exitCode ? ', FAILED' : ''}`)
}
