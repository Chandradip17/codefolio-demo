// End-to-end (live API + Supabase): AI Idea Assistant, Communication Center
// (targeting, realtime delivery, read tracking, archive, scheduling) and Organizer
// Analytics. Creates temporary accounts / a hackathon and removes everything.
// Idea generation runs for real when the API has a Gemini key (or GEMINI_API_BASE
// pointing at a stand-in); otherwise the "not configured" path is verified.
//   npm run smoke:ideas-comms   (API must be running)
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
async function removeExisting(email) {
  const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
  const old = list.users.find((u) => u.email === email)
  if (old) await admin.auth.admin.deleteUser(old.id)
}
const login = async (email) => (await call('POST', '/auth/login', { body: { email, password: 'Smoke-pass-2026' } })).data.session.accessToken
async function tempUser(email, name, role = 'attendee', skills = []) {
  await removeExisting(email)
  const { data, error } = await admin.auth.admin.createUser({ email, password: 'Smoke-pass-2026', email_confirm: true, user_metadata: { name } })
  if (error) throw error
  cleanup.users.push(data.user.id)
  await admin.from('profiles').update({ username: email.split('@')[0].replace(/[^a-z0-9_]/g, '_').slice(0, 20), onboarding_completed: true, role, skills }).eq('id', data.user.id)
  return { id: data.user.id, email, token: await login(email) }
}
const inDays = (n) => new Date(Date.now() + n * 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })

// Listen on the realtime stream as a member; resolves with matching messages.
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
    await new Promise((r) => setTimeout(r, 150))
  }
  return false
}

console.log(`Ideas · Communication · Analytics smoke → ${API}`)
try {
  const host = await tempUser('cf_ica_host@codefolio.dev', 'ICA Host', 'organizer')
  const [ana, ben, cy, judge, outsider] = await Promise.all([
    tempUser('cf_ica_ana@codefolio.dev', 'Ana Team', 'attendee', ['React', 'Python']),
    tempUser('cf_ica_ben@codefolio.dev', 'Ben Solo'),
    tempUser('cf_ica_cy@codefolio.dev', 'Cy Team'),
    tempUser('cf_ica_judge@codefolio.dev', 'ICA Judge'),
    tempUser('cf_ica_out@codefolio.dev', 'Out Sider'),
  ])
  await admin.from('profiles').update({ is_judge: true }).eq('id', judge.id)
  judge.token = await login(judge.email)
  let ev, team

  await step('setup: hackathon with a team, a solo participant, a judge and a project', async () => {
    const r = await call('POST', '/events', {
      token: host.token,
      body: {
        title: 'Smoke ICA Hack', category: 'hackathon', mode: 'Online', city: 'Online', venue: 'Online', theme: 'Education',
        date: inDays(4), time: '10:00', endTime: '10:00', endDate: inDays(5), organizerChapter: 'Smoke Club', capacity: 30,
        applicationsOpenAt: new Date(Date.now() - 3600e3).toISOString(), applicationsCloseAt: new Date(Date.now() + 2 * 86400e3).toISOString(),
        teamMin: 1, teamMax: 3, description: 'Temporary hackathon created by the ideas/communication smoke test. Safe to delete.',
      },
    })
    assert.equal(r.status, 201, JSON.stringify(r.data))
    ev = r.data.event
    cleanup.events.push(ev.id)
    await call('PUT', `/admin/events/${ev.id}/form`, { token: host.token, body: { questions: [] } })
    const a = (await call('POST', '/bookings', { token: ana.token, body: { eventId: ev.id, participation: 'team_create', teamName: 'Readers' } })).data.booking
    team = a.team
    const c = (await call('POST', '/bookings', { token: cy.token, body: { eventId: ev.id, participation: 'team_join', teamCode: team.code } })).data.booking
    const b = (await call('POST', '/bookings', { token: ben.token, body: { eventId: ev.id, participation: 'solo' } })).data.booking
    for (const x of [a, c]) await call('POST', `/admin/bookings/${x.id}/approve`, { token: host.token })
    assert.ok(b?.id) // Ben stays Pending
    assert.equal((await call('POST', `/organizer/hackathons/${ev.id}/judges`, { token: host.token, body: { judgeId: judge.id } })).status, 201)
    const p = await call('POST', '/projects', { token: ana.token, body: { eventId: ev.id, title: 'ReadAlong', problemStatement: 'Kids struggle to read.', description: 'A long enough description of what the project does for its users.', techStack: 'React, Python', githubUrl: 'https://github.com/octocat/Hello-World' } })
    assert.equal(p.status, 201, JSON.stringify(p.data))
  })

  // ---------------- Idea Assistant ----------------
  let ai = false
  await step('idea context: real hackathon data + prefill from profile and team', async () => {
    const c = (await call('GET', `/ideas/context?event=${ev.id}`, { token: ana.token })).data
    assert.equal(c.hackathon.theme, 'Education')
    assert.equal(c.hackathon.hours, 24)
    assert.deepEqual(c.prefill.skills, ['React', 'Python'])
    assert.equal(c.prefill.teamSize, 2)
    assert.equal(c.prefill.teamSizeFromTeam, true)
    ai = c.aiAvailable
    assert.equal((await call('GET', '/ideas/context?event=nope', { token: ana.token })).status, 404)
  })
  const inputs = () => ({ eventId: ev.id, problemArea: 'Reading', skills: ['React'], interests: ['Education'], experience: 'intermediate', difficulty: 'intermediate', hours: 24, teamSize: 2 })
  let saved
  await step('access: only members who applied to the hackathon; sign-in required', async () => {
    assert.equal((await call('POST', '/ideas/generate', { body: inputs() })).status, 401)
    for (const u of [outsider, judge]) {
      assert.equal((await call('GET', `/ideas/context?event=${ev.id}`, { token: u.token })).status, 404)
      const g = await call('POST', '/ideas/generate', { token: u.token, body: inputs() })
      assert.equal(g.status, 404)
      assert.equal(g.data.error.code, 'ideas/not_registered')
    }
    const mine = (await call('GET', '/ideas/hackathons', { token: ana.token })).data.hackathons.map((h) => h.id)
    assert.deepEqual(mine, [ev.id]) // only hackathons Ana applied to
    assert.deepEqual((await call('GET', '/ideas/hackathons', { token: outsider.token })).data.hackathons, [])
  })
  await step('generate (real Gemini when configured): 3 ideas, cooldown, refine, save', async () => {
    const bad = await call('POST', '/ideas/generate', { token: ana.token, body: { ...inputs(), hours: 0 } })
    assert.equal(bad.status, 422)
    const r = await call('POST', '/ideas/generate', { token: ana.token, body: { ...inputs(), count: 3 } })
    if (!ai) {
      assert.equal(r.status, 503)
      assert.equal(r.data.error.code, 'ai/not_configured')
      console.log('      (no Gemini key on this API: generation verified as "not configured")')
      return
    }
    assert.equal(r.status, 200, JSON.stringify(r.data))
    assert.equal(r.data.ideas.length, 3)
    for (const i of r.data.ideas) assert.ok(i.title && i.problemStatement && i.solution && i.whyItFits && i.features.length && i.draftId, JSON.stringify(i).slice(0, 200))
    assert.equal(new Set(r.data.ideas.map((i) => i.title)).size, 3)
    console.log(`      (${r.data.model}: ${r.data.ideas.map((i) => `“${i.title}”`).join(', ')})`)
    // Server-side cooldown between AI requests.
    const again = await call('POST', '/ideas/generate', { token: ana.token, body: inputs() })
    assert.equal(again.status, 429)
    assert.equal(again.data.error.code, 'ai/cooldown')
    assert.ok(again.data.error.retryAfter >= 1)
    await new Promise((res) => setTimeout(res, again.data.error.retryAfter * 1000 + 300))
    const picked = r.data.ideas[0]
    const f = await call('POST', '/ideas/refine', { token: ana.token, body: { action: 'easier', idea: picked, inputs: inputs() } })
    assert.equal(f.status, 200, JSON.stringify(f.data))
    assert.ok(f.data.idea.title && f.data.idea.problemStatement)
    console.log(`      (refined “${picked.title}” → “${f.data.idea.title}”)`)
    const s = await call('POST', '/ideas', { token: ana.token, body: { idea: f.data.idea, inputs: inputs(), draftId: f.data.idea.draftId } })
    assert.equal(s.status, 201, JSON.stringify(s.data))
    assert.equal(s.data.idea.aiGenerated, true)
    assert.ok(s.data.idea.whyItFits)
    // A non-member can't save ideas against the hackathon either.
    assert.equal((await call('POST', '/ideas', { token: outsider.token, body: { idea: f.data.idea, inputs: inputs() } })).status, 404)
    saved = s.data.idea
  })
  await step('saved ideas: private to their author; update, list, delete', async () => {
    if (!saved) {
      const s = await call('POST', '/ideas', { token: ana.token, body: { idea: { title: 'Manual idea', problemStatement: 'p', features: ['a'] }, inputs: inputs(), draftId: '00000000-0000-4000-8000-000000000000' } })
      assert.equal(s.status, 201, JSON.stringify(s.data))
      assert.equal(s.data.idea.aiGenerated, false) // a made-up draft id can't claim AI provenance
      saved = s.data.idea
    }
    assert.equal((await call('GET', `/ideas/${saved.id}`, { token: cy.token })).status, 404)
    assert.equal((await call('PUT', `/ideas/${saved.id}`, { token: cy.token, body: { idea: saved, inputs: inputs() } })).status, 404)
    assert.equal((await call('DELETE', `/ideas/${saved.id}`, { token: outsider.token })).status, 404)
    const u = await call('PUT', `/ideas/${saved.id}`, { token: ana.token, body: { idea: { ...saved, title: 'Renamed idea' }, inputs: inputs() } })
    assert.equal(u.data.idea.title, 'Renamed idea')
    const list = (await call('GET', `/ideas?event=${ev.id}`, { token: ana.token })).data.ideas
    assert.deepEqual(list.map((i) => i.id), [saved.id])
    assert.deepEqual((await call('GET', `/ideas?event=${ev.id}`, { token: cy.token })).data.ideas, [])
    assert.equal((await call('DELETE', `/ideas/${saved.id}`, { token: ana.token })).status, 204)
    assert.equal((await call('GET', `/ideas/${saved.id}`, { token: ana.token })).status, 404)
  })

  // ---------------- Communication Center ----------------
  const post = (body, token = host.token) => call('POST', '/announcements', { token, body: { eventId: ev.id, important: false, pinned: false, ...body } })
  await step('only the organizer can post; validation; unknown team refused', async () => {
    assert.equal((await post({ title: 'Hi all', message: 'x', audience: 'all' }, ana.token)).status, 403)
    assert.equal((await post({ title: 'Hi all', message: 'x', audience: 'all' }, judge.token)).status, 403)
    assert.equal((await post({ title: 'x', message: 'x', audience: 'all' })).status, 422)
    assert.equal((await post({ title: 'Team note', message: 'x', audience: 'team' })).status, 422)
    assert.equal((await post({ title: 'Team note', message: 'x', audience: 'team', teamId: '00000000-0000-4000-8000-000000000000' })).data.error.code, 'announce/team')
  })
  let pinnedId
  await step('realtime: an announcement is pushed only to its audience', async () => {
    const [la, lb, lj, lo] = [listen(ana.token), listen(ben.token), listen(judge.token), listen(outsider.token)]
    await Promise.all([la.ready, lb.ready, lj.ready, lo.ready])
    await new Promise((r) => setTimeout(r, 500))
    const judgesOnly = await post({ title: 'Judging briefing', message: 'Rubric attached.', audience: 'judges' })
    assert.equal(judgesOnly.status, 201)
    const everyone = await post({ title: 'Submission deadline', message: 'Submit by 8 PM.', audience: 'all', important: true, pinned: true })
    pinnedId = everyone.data.announcement.id
    const has = (l, title) => l.got.some((m) => m.type === 'announcement.published' && m.data.title === title)
    assert.ok(await waitFor(() => has(la, 'Submission deadline') && has(lb, 'Submission deadline') && has(lj, 'Judging briefing')), 'expected deliveries')
    await new Promise((r) => setTimeout(r, 800))
    assert.equal(has(la, 'Judging briefing'), false, 'participant must not get the judges-only message')
    assert.equal(has(lo, 'Submission deadline') || has(lo, 'Judging briefing'), false, 'outsider gets nothing')
    ;[la, lb, lj, lo].forEach((l) => l.close())
  })
  await step('feeds: audience targeting (all / participants / judges / team), pinned first', async () => {
    await post({ title: 'For participants', message: 'Workshop at 4 PM.', audience: 'participants' })
    await post({ title: 'Readers only', message: 'Your mentor slot is 3 PM.', audience: 'team', teamId: team.id })
    const titles = async (u) => (await call('GET', `/announcements?event=${ev.id}`, { token: u.token })).data.announcements.map((a) => a.title)
    const ana_ = await titles(ana)
    assert.equal(ana_[0], 'Submission deadline') // pinned first
    assert.deepEqual([...ana_].sort(), ['For participants', 'Readers only', 'Submission deadline'])
    assert.deepEqual((await titles(ben)).sort(), ['For participants', 'Submission deadline'])
    assert.deepEqual((await titles(judge)).sort(), ['Judging briefing', 'Submission deadline'])
    assert.equal((await titles(host)).length, 4)
    assert.equal((await call('GET', `/announcements?event=${ev.id}`, { token: outsider.token })).status, 404)
    const feed = (await call('GET', `/announcements?event=${ev.id}`, { token: host.token })).data
    assert.equal(feed.role.manager, true)
    assert.deepEqual(feed.teams.map((t) => t.name), ['Readers'])
    assert.equal((await call('GET', `/announcements?event=${ev.id}`, { token: ana.token })).data.teams, undefined)
    assert.ok(feed.deadlines.some((d) => d.key === 'submission'))
  })
  await step('read tracking + unread counts (no duplicates, only visible items)', async () => {
    const u1 = (await call('GET', '/announcements/unread', { token: ana.token })).data
    assert.equal(u1.byHackathon[ev.id], 3)
    const first = (await call('GET', `/announcements?event=${ev.id}`, { token: ana.token })).data.announcements[0]
    assert.equal((await call('POST', '/announcements/read', { token: ana.token, body: { eventId: ev.id, ids: [first.id] } })).data.marked, 1)
    assert.equal((await call('POST', '/announcements/read', { token: ana.token, body: { eventId: ev.id, ids: [first.id] } })).data.marked, 0)
    assert.equal((await call('GET', '/announcements/unread', { token: ana.token })).data.byHackathon[ev.id], 2)
    assert.equal((await call('POST', '/announcements/read', { token: ana.token, body: { eventId: ev.id } })).data.marked, 2)
    assert.equal((await call('GET', '/announcements/unread', { token: ana.token })).data.total, 0)
    assert.equal((await call('POST', '/announcements/read', { token: outsider.token, body: { eventId: ev.id } })).data.marked, 0)
  })
  await step('edit + archive (organizer only); scheduled stays hidden until due', async () => {
    const e = await call('PUT', `/announcements/${pinnedId}`, { token: host.token, body: { eventId: ev.id, title: 'Submission deadline (updated)', message: 'Submit by 9 PM.', audience: 'all', important: true, pinned: true } })
    assert.equal(e.status, 200, JSON.stringify(e.data))
    assert.ok(e.data.announcement.editedAt)
    assert.equal((await call('POST', `/announcements/${pinnedId}/archive`, { token: ana.token })).status, 403)
    assert.equal((await call('POST', `/announcements/${pinnedId}/archive`, { token: host.token })).status, 200)
    const later = await post({ title: 'Tomorrow’s schedule', message: 'Coming soon.', audience: 'all', publishAt: new Date(Date.now() + 3600e3).toISOString() })
    assert.equal(later.data.announcement.scheduled, true)
    const seen = (await call('GET', `/announcements?event=${ev.id}`, { token: ben.token })).data.announcements.map((a) => a.title)
    assert.deepEqual(seen, ['For participants'])
    assert.ok((await call('GET', `/announcements?event=${ev.id}`, { token: host.token })).data.announcements.some((a) => a.scheduled))
  })

  // ---------------- Analytics ----------------
  await step('analytics: organizer only; counts and percentages match the data', async () => {
    assert.equal((await call('GET', `/organizer/hackathons/${ev.id}/analytics`, { token: ana.token })).status, 403)
    assert.equal((await call('GET', `/organizer/hackathons/${ev.id}/analytics`, { token: judge.token })).status, 403)
    const a = (await call('GET', `/organizer/hackathons/${ev.id}/analytics`, { token: host.token })).data
    assert.equal(a.registrations.total, 3)
    assert.equal(a.registrations.approved, 2)
    assert.equal(a.registrations.byStatus.Pending, 1)
    assert.equal(a.teams.count, 1)
    assert.equal(a.teams.inTeams, 2)
    assert.equal(a.rates.teamFormationRate, 100)
    assert.equal(a.submissions.expected, 1)
    assert.equal(a.submissions.submitted, 1)
    assert.equal(a.rates.submissionRate, 100)
    assert.deepEqual(a.tech.top.map((t) => t.label).sort(), ['Python', 'React'])
    assert.equal(a.judging.expectedReviews, 1)
    assert.equal(a.rates.reviewCompletion, 0)
    assert.ok(a.insights.some((i) => i.text.includes('1 application is waiting')))
    assert.equal(a.registrations.daily.reduce((s, d) => s + d.count, 0), 3)
  })
} finally {
  for (const id of cleanup.events) await admin.rpc('delete_event', { p_event: id })
  for (const id of cleanup.users) await admin.auth.admin.deleteUser(id)
  console.log(`  ✓ cleanup: ${cleanup.events.length} event, ${cleanup.users.length} users removed`)
  console.log(`\n${passed} passed${process.exitCode ? ', FAILED' : ''}`)
}
