// End-to-end (live API + Supabase): Participant Chat — access, realtime delivery
// (no duplicates, members only), server-side cooldown (incl. parallel requests),
// pagination, reporting and moderation (delete, mute, close). Creates temporary
// accounts / hackathons and removes everything it created.
//   npm run smoke:chat   (API must be running)
import assert from 'node:assert/strict'
import { admin } from '../src/lib/supabase.js'
import { config } from '../src/lib/config.js'

const API = (process.env.API_URL || `http://localhost:${process.env.PORT || 4000}/api`).replace(/\/$/, '')
const COOLDOWN = config.chat.cooldownSeconds
let passed = 0
const cleanup = { users: [], events: [] }

async function call(method, path, { token, body } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  return { status: res.status, data: text ? JSON.parse(text) : null, headers: res.headers }
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
async function removeExisting(email) {
  const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
  const old = list.users.find((u) => u.email === email)
  if (old) await admin.auth.admin.deleteUser(old.id)
}
const login = async (email) => (await call('POST', '/auth/login', { body: { email, password: 'Smoke-pass-2026' } })).data.session.accessToken
async function tempUser(email, name, role = 'attendee') {
  await removeExisting(email)
  const { data, error } = await admin.auth.admin.createUser({ email, password: 'Smoke-pass-2026', email_confirm: true, user_metadata: { name } })
  if (error) throw error
  cleanup.users.push(data.user.id)
  await admin.from('profiles').update({ username: email.split('@')[0].replace(/[^a-z0-9_]/g, '_').slice(0, 20), onboarding_completed: true, role }).eq('id', data.user.id)
  return { id: data.user.id, email, token: await login(email) }
}
const inDays = (n) => new Date(Date.now() + n * 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function listen(token) {
  const ctrl = new AbortController()
  const got = []
  const ready = (async () => {
    const res = await fetch(`${API}/stream`, { headers: { authorization: `Bearer ${token}` }, signal: ctrl.signal })
    const reader = res.body.getReader()
    const dec = new TextDecoder()
    let buf = ''
    ;(async () => {
      try {
        for (;;) {
          const { value, done } = await reader.read()
          if (done) break
          buf += dec.decode(value, { stream: true })
          let i
          while ((i = buf.indexOf('\n\n')) >= 0) {
            const chunk = buf.slice(0, i)
            buf = buf.slice(i + 2)
            const ev = /event: (.+)/.exec(chunk)?.[1]
            const data = /data: (.+)/.exec(chunk)?.[1]
            if (ev && data) got.push({ type: ev, data: JSON.parse(data) })
          }
        }
      } catch {
        /* aborted */
      }
    })()
  })()
  return { ready, got, close: () => ctrl.abort() }
}
const waitFor = async (fn, ms = 8000) => {
  const t = Date.now()
  while (Date.now() - t < ms) {
    if (fn()) return true
    await sleep(150)
  }
  return false
}
const hackathon = async (host, title) => {
  const r = await call('POST', '/events', {
    token: host.token,
    body: {
      title, category: 'hackathon', mode: 'Online', city: 'Online', venue: 'Online', date: inDays(4), time: '10:00', endDate: inDays(5), organizerChapter: 'Smoke Club', capacity: 30,
      applicationsOpenAt: new Date(Date.now() - 3600e3).toISOString(), applicationsCloseAt: new Date(Date.now() + 2 * 86400e3).toISOString(),
      teamMin: 1, teamMax: 3, description: 'Temporary hackathon created by the chat smoke test. Safe to delete.',
    },
  })
  assert.equal(r.status, 201, JSON.stringify(r.data))
  cleanup.events.push(r.data.event.id)
  await call('PUT', `/admin/events/${r.data.event.id}/form`, { token: host.token, body: { questions: [] } })
  return r.data.event
}

console.log(`Participant chat smoke → ${API} (cooldown ${COOLDOWN}s, ${config.chat.maxPerMinute}/min)`)
try {
  const host = await tempUser('cf_chat_host@codefolio.dev', 'Chat Host', 'organizer')
  const [ana, ben, cy, judge, outsider] = await Promise.all([
    tempUser('cf_chat_ana@codefolio.dev', 'Ana Chat'),
    tempUser('cf_chat_ben@codefolio.dev', 'Ben Chat'),
    tempUser('cf_chat_cy@codefolio.dev', 'Cy Other'),
    tempUser('cf_chat_judge@codefolio.dev', 'Chat Judge'),
    tempUser('cf_chat_out@codefolio.dev', 'Out Sider'),
  ])
  await admin.from('profiles').update({ is_judge: true }).eq('id', judge.id)
  judge.token = await login(judge.email)
  let ev, other, m1

  await step('setup: two hackathons; Ana + Ben in A, Cy in B, a judge on A', async () => {
    ev = await hackathon(host, 'Smoke Chat Hack A')
    other = await hackathon(host, 'Smoke Chat Hack B')
    for (const u of [ana, ben]) assert.equal((await call('POST', '/bookings', { token: u.token, body: { eventId: ev.id, participation: 'solo' } })).status, 201)
    assert.equal((await call('POST', '/bookings', { token: cy.token, body: { eventId: other.id, participation: 'solo' } })).status, 201)
    assert.equal((await call('POST', `/organizer/hackathons/${ev.id}/judges`, { token: host.token, body: { judgeId: judge.id } })).status, 201)
  })
  await step('access: no sign-in 401; judge, outsider and another hackathon’s participant get 404', async () => {
    assert.equal((await call('GET', `/chat/${ev.id}`)).status, 401)
    for (const u of [judge, outsider, cy]) {
      assert.equal((await call('GET', `/chat/${ev.id}`, { token: u.token })).status, 404)
      assert.equal((await call('POST', `/chat/${ev.id}/messages`, { token: u.token, body: { message: 'let me in' } })).status, 404)
    }
    const r = (await call('GET', `/chat/${ev.id}`, { token: ana.token })).data
    assert.equal(r.room.participant, true)
    assert.equal(r.room.active, true)
    assert.deepEqual(r.messages, [])
    assert.equal(r.limits.cooldownSeconds, COOLDOWN)
    assert.equal((await call('GET', `/chat/${ev.id}`, { token: host.token })).data.room.moderator, true)
    assert.equal((await call('POST', `/chat/${ev.id}/messages`, { token: host.token, body: { message: 'hi' } })).data.error.code, 'chat/not_participant')
  })
  await step('realtime: members get the message once; judge and outsider get nothing', async () => {
    const [la, lb, lj, lo] = [listen(ana.token), listen(ben.token), listen(judge.token), listen(outsider.token)]
    await Promise.all([la.ready, lb.ready, lj.ready, lo.ready])
    await sleep(500)
    const r = await call('POST', `/chat/${ev.id}/messages`, { token: ana.token, body: { message: '  Anyone working on computer vision?  ', userId: ben.id } })
    assert.equal(r.status, 201, JSON.stringify(r.data))
    m1 = r.data.message
    assert.equal(m1.message, 'Anyone working on computer vision?')
    assert.equal(m1.userId, ana.id) // a userId in the body is ignored: you can't post as someone else
    const got = (l) => l.got.filter((m) => m.type === 'chat.message' && m.data.message.id === m1.id).length
    assert.ok(await waitFor(() => got(lb) === 1 && got(la) === 1), 'Ben and Ana should each get it once')
    await sleep(800)
    assert.equal(got(lb), 1, 'no duplicate delivery')
    assert.equal(got(lj) + got(lo), 0, 'judge / outsider must not receive participant chat')
    ;[la, lb, lj, lo].forEach((l) => l.close())
  })
  await step('cooldown is enforced by the server (retryAfter), including parallel requests', async () => {
    const r = await call('POST', `/chat/${ev.id}/messages`, { token: ana.token, body: { message: 'too soon' } })
    assert.equal(r.status, 429)
    assert.equal(r.data.error.code, 'chat/cooldown')
    assert.ok(r.data.error.retryAfter >= 1 && r.data.error.retryAfter <= COOLDOWN)
    assert.equal(r.headers.get('retry-after'), String(r.data.error.retryAfter))
    // The room state tells the UI the same remaining time.
    const left = (await call('GET', `/chat/${ev.id}`, { token: ana.token })).data.room.cooldownLeft
    assert.ok(left >= 1 && left <= COOLDOWN)
    // Ben fires 6 sends at once: exactly one gets through.
    const burst = await Promise.all(Array.from({ length: 6 }, (_, i) => call('POST', `/chat/${ev.id}/messages`, { token: ben.token, body: { message: `parallel ${i}` } })))
    assert.equal(burst.filter((x) => x.status === 201).length, 1, JSON.stringify(burst.map((x) => x.status)))
    assert.ok(burst.filter((x) => x.status === 429).every((x) => x.data.error.code === 'chat/cooldown'))
    await sleep(COOLDOWN * 1000 + 300)
    assert.equal((await call('POST', `/chat/${ev.id}/messages`, { token: ana.token, body: { message: 'Yes, OpenCV + React here.' } })).status, 201)
  })
  await step('validation: empty, too long, repeated identical message', async () => {
    await sleep(COOLDOWN * 1000 + 300)
    assert.equal((await call('POST', `/chat/${ev.id}/messages`, { token: ben.token, body: { message: '    ' } })).data.error.code, 'chat/empty')
    assert.equal((await call('POST', `/chat/${ev.id}/messages`, { token: ben.token, body: { message: 'x'.repeat(config.chat.maxLength + 1) } })).data.error.code, 'chat/too_long')
    assert.equal((await call('POST', `/chat/${ev.id}/messages`, { token: ana.token, body: { message: 'yes, opencv + react here.' } })).data.error.code, 'chat/duplicate')
  })
  await step('history: per hackathon, newest first; other hackathon’s room is separate', async () => {
    const r = (await call('GET', `/chat/${ev.id}`, { token: ben.token })).data
    assert.deepEqual(r.messages.map((m) => m.message).slice(-1), ['Anyone working on computer vision?'])
    assert.equal(r.messages[0].message, 'Yes, OpenCV + React here.')
    assert.deepEqual((await call('GET', `/chat/${other.id}`, { token: cy.token })).data.messages, [])
    assert.equal((await call('GET', `/chat/${other.id}/messages?before=${m1.id}`, { token: cy.token })).status, 422) // cursor from another chat
  })
  let reportId
  await step('reporting: once per member; not your own; organizer is notified', async () => {
    const lh = listen(host.token)
    await lh.ready
    await sleep(300)
    assert.equal((await call('POST', `/chat/message/${m1.id}/report`, { token: ana.token, body: { reason: 'spam' } })).data.error.code, 'chat/own_message')
    assert.equal((await call('POST', `/chat/message/${m1.id}/report`, { token: cy.token, body: { reason: 'spam' } })).status, 404)
    const r = await call('POST', `/chat/message/${m1.id}/report`, { token: ben.token, body: { reason: 'off_topic', details: 'testing' } })
    assert.equal(r.status, 201)
    reportId = r.data.report.id
    assert.equal((await call('POST', `/chat/message/${m1.id}/report`, { token: ben.token, body: { reason: 'spam' } })).data.error.code, 'chat/already_reported')
    assert.ok(await waitFor(() => lh.got.some((m) => m.type === 'chat.report' && m.data.eventId === ev.id)))
    lh.close()
  })
  await step('moderation: organizer only; delete shows a placeholder; participants can’t delete', async () => {
    assert.equal((await call('GET', `/chat/moderation/${ev.id}`, { token: ana.token })).status, 403)
    assert.equal((await call('GET', `/chat/moderation/${ev.id}`, { token: judge.token })).status, 403)
    const mod = (await call('GET', `/chat/moderation/${ev.id}`, { token: host.token })).data
    assert.equal(mod.reports[0].id, reportId)
    assert.equal(mod.reports[0].message.text, 'Anyone working on computer vision?')
    assert.equal((await call('DELETE', `/chat/moderation/message/${m1.id}`, { token: ben.token })).status, 403)
    const lb = listen(ben.token)
    await lb.ready
    await sleep(300)
    assert.equal((await call('DELETE', `/chat/moderation/message/${m1.id}`, { token: host.token })).status, 200)
    assert.ok(await waitFor(() => lb.got.some((m) => m.type === 'chat.deleted' && m.data.id === m1.id)))
    lb.close()
    const shown = (await call('GET', `/chat/${ev.id}`, { token: ben.token })).data.messages.find((m) => m.id === m1.id)
    assert.equal(shown.deleted, true)
    assert.equal(shown.message, null)
    assert.equal((await call('GET', `/chat/moderation/${ev.id}`, { token: host.token })).data.reports[0].status, 'action_taken')
  })
  await step('mute: blocks sending (reading still works) until unmuted', async () => {
    const r = await call('POST', `/chat/moderation/${ev.id}/mutes`, { token: host.token, body: { userId: ana.id, minutes: 30, reason: 'testing' } })
    assert.equal(r.status, 201, JSON.stringify(r.data))
    await sleep(COOLDOWN * 1000 + 300)
    const s = await call('POST', `/chat/${ev.id}/messages`, { token: ana.token, body: { message: 'am I muted?' } })
    assert.equal(s.data.error.code, 'chat/muted')
    assert.ok(s.data.error.mutedUntil)
    assert.equal((await call('GET', `/chat/${ev.id}`, { token: ana.token })).status, 200)
    assert.ok((await call('GET', `/chat/moderation/${ev.id}`, { token: host.token })).data.mutes.some((m) => m.userId === ana.id))
    assert.equal((await call('DELETE', `/chat/moderation/${ev.id}/mutes/${ana.id}`, { token: host.token })).status, 204)
    assert.equal((await call('POST', `/chat/${ev.id}/messages`, { token: ana.token, body: { message: 'thanks, back now' } })).status, 201)
  })
  await step('closing the chat makes it read-only; reopening restores it', async () => {
    assert.equal((await call('PUT', `/chat/moderation/${ev.id}/room`, { token: ana.token, body: { active: false } })).status, 403)
    assert.equal((await call('PUT', `/chat/moderation/${ev.id}/room`, { token: host.token, body: { active: false } })).data.room.active, false)
    await sleep(COOLDOWN * 1000 + 300)
    assert.equal((await call('POST', `/chat/${ev.id}/messages`, { token: ben.token, body: { message: 'closed?' } })).data.error.code, 'chat/closed')
    assert.ok((await call('GET', `/chat/${ev.id}`, { token: ben.token })).data.messages.length > 0) // history still readable
    await call('PUT', `/chat/moderation/${ev.id}/room`, { token: host.token, body: { active: true } })
    assert.equal((await call('POST', `/chat/${ev.id}/messages`, { token: ben.token, body: { message: 'open again' } })).status, 201)
  })
  await step('announcements are unaffected and separate', async () => {
    const a = await call('POST', '/announcements', { token: host.token, body: { eventId: ev.id, title: 'Still official', message: 'One-way.', audience: 'all', important: false, pinned: false } })
    assert.equal(a.status, 201)
    const feed = (await call('GET', `/announcements?event=${ev.id}`, { token: ana.token })).data.announcements.map((x) => x.title)
    assert.deepEqual(feed, ['Still official'])
    const chat = (await call('GET', `/chat/${ev.id}`, { token: ana.token })).data.messages.map((m) => m.message)
    assert.ok(!chat.includes('Still official'))
  })
} finally {
  for (const id of cleanup.events) await admin.rpc('delete_event', { p_event: id })
  for (const id of cleanup.users) await admin.auth.admin.deleteUser(id)
  console.log(`  ✓ cleanup: ${cleanup.events.length} events, ${cleanup.users.length} users removed`)
  console.log(`\n${passed} passed${process.exitCode ? ', FAILED' : ''}`)
}
