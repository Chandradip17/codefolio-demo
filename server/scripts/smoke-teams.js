// End-to-end (live API + Supabase): hackathon teams — solo rule, create team
// (unique code), join by code, full team, leaving frees the slot, host view.
// Creates temporary accounts + a hackathon and removes everything it created.
//   npm run smoke:teams   (API must be running)
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
const apply = (u, ev, body) =>
  call('POST', '/bookings', { token: u.token, body: { eventId: ev, seats: 3, answers: { why: 'Smoke testing teams end to end.' }, ...body } })

console.log(`Teams smoke → ${API}`)
try {
  const host = await tempUser('cf_team_host@codefolio.dev', 'Team Host', 'organizer')
  const [ana, ben, cy, dee] = await Promise.all(
    ['ana', 'ben', 'cy', 'dee'].map((n) => tempUser(`cf_team_${n}@codefolio.dev`, `Team ${n[0].toUpperCase()}${n.slice(1)}`)),
  )
  let ev, code, anaBooking

  await step('host creates a hackathon with teams of 2–3 (event-style form: just "why")', async () => {
    const r = await call('POST', '/events', {
      token: host.token,
      body: {
        title: 'Smoke Team Hack', category: 'hackathon', mode: 'Online', city: 'Online', venue: 'Online',
        date: inDays(6), time: '10:00', endDate: inDays(7), organizerChapter: 'Smoke Club', capacity: 20,
        applicationsOpenAt: new Date(Date.now() - 3600e3).toISOString(), applicationsCloseAt: new Date(Date.now() + 3 * 86400e3).toISOString(),
        teamMin: 2, teamMax: 3, description: 'Temporary hackathon created by the teams smoke test. Safe to delete.',
      },
    })
    assert.equal(r.status, 201, JSON.stringify(r.data))
    ev = r.data.event
    cleanup.events.push(ev.id)
    // Keep the answers simple for the test: one optional question.
    const f = await call('PUT', `/admin/events/${ev.id}/form`, { token: host.token, body: { questions: [{ id: 'why', type: 'long_text', label: 'Why?', required: false }] } })
    assert.equal(f.status, 200, JSON.stringify(f.data))
  })
  await step('participation is required; solo refused (min 2)', async () => {
    assert.equal((await apply(ana, ev.id, {})).data.error.code, 'team/choice')
    const r = await apply(ana, ev.id, { participation: 'solo' })
    assert.equal(r.status, 409)
    assert.equal(r.data.error.code, 'team/solo_disabled')
  })
  await step('create team → Pending, 1 seat, unique 6-char code, creator is leader', async () => {
    const r = await apply(ana, ev.id, { participation: 'team_create', teamName: 'Null Pointers' })
    assert.equal(r.status, 201, JSON.stringify(r.data))
    anaBooking = r.data.booking
    assert.equal(anaBooking.seats, 1)
    assert.equal(anaBooking.participation, 'team')
    code = anaBooking.team.code
    assert.match(code, /^[A-HJ-NP-Z2-9]{6}$/)
    assert.equal(anaBooking.team.members[0].leader, true)
    assert.equal(r.data.event.availableSeats, 20)
  })
  await step('duplicate team name refused; lookup previews the team; bad code refused', async () => {
    assert.equal((await apply(ben, ev.id, { participation: 'team_create', teamName: 'null pointers' })).data.error.code, 'team/name_taken')
    const l = await call('GET', `/bookings/team-lookup?event=${ev.id}&code=${code.toLowerCase()}`, { token: ben.token })
    assert.deepEqual(l.data.team, { name: 'Null Pointers', size: 1, max: 3, leaderName: 'Team Ana' })
    assert.equal((await call('GET', `/bookings/team-lookup?event=cf-101&code=${code}`, { token: ben.token })).data.error.code, 'team/wrong_event')
    assert.equal((await apply(ben, ev.id, { participation: 'team_join', teamCode: 'ZZZZZZ' })).data.error.code, 'team/not_found')
  })
  await step('two members join by code; the fourth finds it full', async () => {
    const b = await apply(ben, ev.id, { participation: 'team_join', teamCode: `${code.slice(0, 3)}-${code.slice(3)}` })
    assert.equal(b.status, 201, JSON.stringify(b.data))
    assert.equal(b.data.booking.team.size, 2)
    assert.equal((await apply(cy, ev.id, { participation: 'team_join', teamCode: code })).data.booking.team.size, 3)
    const d = await apply(dee, ev.id, { participation: 'team_join', teamCode: code })
    assert.equal(d.data.error.code, 'team/full')
  })
  await step('members see the roster in their bookings; host sees team in the list and answers', async () => {
    const mine = (await call('GET', '/bookings/me', { token: cy.token })).data.bookings.find((x) => x.eventId === ev.id)
    assert.deepEqual(mine.team.members.map((m) => m.name), ['Team Ana', 'Team Ben', 'Team Cy'])
    const list = (await call('GET', '/admin/bookings', { token: host.token })).data.bookings.filter((x) => x.eventId === ev.id)
    assert.equal(list.length, 3)
    assert.ok(list.every((x) => x.team?.code === code))
    const a = await call('GET', `/admin/bookings/${anaBooking.id}/answers`, { token: host.token })
    assert.deepEqual(a.data.teamLimits, { min: 2, max: 3 })
    assert.equal(a.data.team.size, 3)
  })
  await step('host rejects the leader → leadership passes on; the free slot can be taken', async () => {
    const r = await call('POST', `/admin/bookings/${anaBooking.id}/reject`, { token: host.token, body: { note: 'Smoke test' } })
    assert.equal(r.data.booking.status, 'Rejected')
    const mine = (await call('GET', '/bookings/me', { token: ben.token })).data.bookings.find((x) => x.eventId === ev.id)
    assert.equal(mine.team.size, 2)
    assert.equal(mine.team.members.find((m) => m.leader).name, 'Team Ben')
    assert.equal((await apply(dee, ev.id, { participation: 'team_join', teamCode: code })).status, 201)
  })
} finally {
  for (const id of cleanup.events) await admin.rpc('delete_event', { p_event: id })
  for (const id of cleanup.users) await admin.auth.admin.deleteUser(id)
  console.log(`  ✓ cleanup: ${cleanup.events.length} event, ${cleanup.users.length} users removed`)
  console.log(`\n${passed} passed${process.exitCode ? ', FAILED' : ''}`)
}
