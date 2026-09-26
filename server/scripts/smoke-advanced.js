// End-to-end (live API + Supabase): Team Matcher, GitHub project repositories and
// Demo Day. Creates temporary accounts / a hackathon and removes everything it
// created. GitHub part uses a real public repository (octocat/Hello-World).
//   npm run smoke:advanced   (API must be running)
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
async function tempUser(email, name, role = 'attendee') {
  await removeExisting(email)
  const { data, error } = await admin.auth.admin.createUser({ email, password: 'Smoke-pass-2026', email_confirm: true, user_metadata: { name } })
  if (error) throw error
  cleanup.users.push(data.user.id)
  await admin.from('profiles').update({ username: email.split('@')[0].replace(/[^a-z0-9_]/g, '_').slice(0, 20), onboarding_completed: true, role }).eq('id', data.user.id)
  return { id: data.user.id, email, token: await login(email) }
}
const inDays = (n) => new Date(Date.now() + n * 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })

console.log(`Advanced features smoke → ${API}`)
try {
  const host = await tempUser('cf_adv_host@codefolio.dev', 'Adv Host', 'organizer')
  const [ana, ben, cai, dev, judge, outsider] = await Promise.all([
    tempUser('cf_adv_ana@codefolio.dev', 'Ana Frontend'),
    tempUser('cf_adv_ben@codefolio.dev', 'Ben Backend'),
    tempUser('cf_adv_cai@codefolio.dev', 'Cai Designer'),
    tempUser('cf_adv_dev@codefolio.dev', 'Dev Solo'),
    tempUser('cf_adv_judge@codefolio.dev', 'Adv Judge'),
    tempUser('cf_adv_out@codefolio.dev', 'Out Sider'),
  ])
  await admin.from('profiles').update({ is_judge: true }).eq('id', judge.id)
  judge.token = await login(judge.email)
  let ev, projA, projD, reqId

  await step('host creates a team hackathon (2–3 members)', async () => {
    const r = await call('POST', '/events', {
      token: host.token,
      body: {
        title: 'Smoke Advanced Hack', category: 'hackathon', mode: 'Online', city: 'Online', venue: 'Online',
        date: inDays(4), time: '10:00', endDate: inDays(5), organizerChapter: 'Smoke Club', capacity: 30,
        applicationsOpenAt: new Date(Date.now() - 3600e3).toISOString(), applicationsCloseAt: new Date(Date.now() + 2 * 86400e3).toISOString(),
        teamMin: 1, teamMax: 3, description: 'Temporary hackathon created by the advanced-features smoke test. Safe to delete.',
      },
    })
    assert.equal(r.status, 201, JSON.stringify(r.data))
    ev = r.data.event
    cleanup.events.push(ev.id)
    await call('PUT', `/admin/events/${ev.id}/form`, { token: host.token, body: { questions: [] } })
    const list = (await call('GET', '/team-matcher/hackathons', { token: ana.token })).data
    assert.ok(list.hackathons.some((h) => h.id === ev.id))
    assert.deepEqual(Object.values(list.weights).reduce((a, b) => a + b, 0).toFixed(2), '1.00')
  })

  // ---------------- Team Matcher ----------------
  await step('matches require saved preferences; validation on bad input', async () => {
    assert.equal((await call('GET', `/team-matcher/matches?event=${ev.id}`, { token: ana.token })).data.error.code, 'team/no_preferences')
    const bad = await call('PUT', '/team-matcher/preferences', { token: ana.token, body: { eventId: ev.id, experience: 'guru', availability: 'full_time', lookingFor: ['wizard'] } })
    assert.equal(bad.status, 422)
  })
  await step('preferences saved for 3 members; ranking is deterministic and explained', async () => {
    const save = (u, body) => call('PUT', '/team-matcher/preferences', { token: u.token, body: { eventId: ev.id, ...body } })
    assert.equal((await save(ana, { skills: ['React', 'CSS', 'TypeScript'], lookingFor: ['backend', 'design'], experience: 'intermediate', availability: 'full_time', goal: 'win', interests: ['Education', 'AI'] })).status, 200)
    await save(ben, { skills: ['Node.js', 'PostgreSQL', 'Express'], lookingFor: ['frontend'], experience: 'intermediate', availability: 'full_time', goal: 'win', interests: ['AI', 'Education'] })
    await save(cai, { skills: ['React', 'CSS'], lookingFor: ['frontend'], experience: 'beginner', availability: 'part_time', goal: 'learn', interests: ['Gaming'] })
    const m1 = (await call('GET', `/team-matcher/matches?event=${ev.id}`, { token: ana.token })).data
    const m2 = (await call('GET', `/team-matcher/matches?event=${ev.id}`, { token: ana.token })).data
    assert.deepEqual(m1.matches.map((m) => [m.userId, m.match.percent]), m2.matches.map((m) => [m.userId, m.match.percent]))
    assert.equal(m1.matches[0].userId, ben.id, 'complementary backend dev ranks first')
    assert.ok(m1.matches[0].match.percent > m1.matches[1].match.percent)
    assert.ok(m1.matches[0].match.reasons.length > 0)
    assert.ok(!m1.matches.some((m) => m.userId === ana.id), 'never matched with yourself')
    assert.ok(!m1.matches.some((m) => m.userId === dev.id), 'no preferences → not listed')
    assert.equal(JSON.stringify(m1).includes('@codefolio.dev'), false, 'no emails leak')
  })
  await step('invitations: send, no duplicates, no self-invite, unavailable refused', async () => {
    const r = await call('POST', '/team-matcher/requests', { token: ana.token, body: { eventId: ev.id, userId: ben.id, message: 'Team up?' } })
    assert.equal(r.status, 201, JSON.stringify(r.data))
    reqId = r.data.request.id
    assert.equal((await call('POST', '/team-matcher/requests', { token: ana.token, body: { eventId: ev.id, userId: ben.id } })).data.error.code, 'team/request_exists')
    assert.equal((await call('POST', '/team-matcher/requests', { token: ben.token, body: { eventId: ev.id, userId: ana.id } })).data.error.code, 'team/request_exists')
    assert.equal((await call('POST', '/team-matcher/requests', { token: ana.token, body: { eventId: ev.id, userId: ana.id } })).data.error.code, 'team/self')
    await call('PUT', '/team-matcher/preferences', { token: cai.token, body: { eventId: ev.id, skills: ['React'], experience: 'beginner', availability: 'part_time', available: false } })
    assert.equal((await call('POST', '/team-matcher/requests', { token: ana.token, body: { eventId: ev.id, userId: cai.id } })).data.error.code, 'team/unavailable')
    assert.equal((await call('POST', '/team-matcher/requests', { token: ana.token, body: { eventId: ev.id, userId: dev.id } })).data.error.code, 'team/unavailable')
  })
  await step('only the receiver can accept; sender can cancel; accepted reveals team code', async () => {
    assert.equal((await call('POST', `/team-matcher/requests/${reqId}/accept`, { token: ana.token })).status, 403)
    assert.equal((await call('POST', `/team-matcher/requests/${reqId}/accept`, { token: outsider.token })).status, 404)
    const b = (await call('POST', '/bookings', { token: ana.token, body: { eventId: ev.id, participation: 'team_create', teamName: 'Matchmakers' } })).data.booking
    assert.ok(b?.id)
    const ok = await call('POST', `/team-matcher/requests/${reqId}/accept`, { token: ben.token })
    assert.equal(ok.data.request.status, 'accepted')
    assert.equal((await call('POST', `/team-matcher/requests/${reqId}/reject`, { token: ben.token })).data.error.code, 'team/request_closed')
    const mine = (await call('GET', `/team-matcher/requests?event=${ev.id}`, { token: ben.token })).data
    const accepted = mine.requests.find((x) => x.id === reqId)
    assert.equal(accepted.partnerTeam.name, 'Matchmakers')
    assert.match(accepted.partnerTeam.code, /^[A-Z0-9]{6}$/)
    // Joining still goes through the normal application (fees / size rules intact).
    const join = await call('POST', '/bookings', { token: ben.token, body: { eventId: ev.id, participation: 'team_join', teamCode: accepted.partnerTeam.code } })
    assert.equal(join.status, 201, JSON.stringify(join.data))
    assert.equal((await call('POST', '/team-matcher/requests', { token: ana.token, body: { eventId: ev.id, userId: ben.id } })).data.error.code, 'team/already_teammates')
  })
  await step('cancel + reject flows', async () => {
    await call('PUT', '/team-matcher/preferences', { token: cai.token, body: { eventId: ev.id, skills: ['Figma'], lookingFor: ['frontend'], experience: 'beginner', availability: 'flexible', available: true } })
    const r = (await call('POST', '/team-matcher/requests', { token: cai.token, body: { eventId: ev.id, userId: ana.id } })).data.request
    assert.equal((await call('POST', `/team-matcher/requests/${r.id}/cancel`, { token: ana.token })).status, 403)
    assert.equal((await call('POST', `/team-matcher/requests/${r.id}/cancel`, { token: cai.token })).data.request.status, 'cancelled')
    const r2 = (await call('POST', '/team-matcher/requests', { token: cai.token, body: { eventId: ev.id, userId: ana.id } })).data.request
    assert.equal((await call('POST', `/team-matcher/requests/${r2.id}/reject`, { token: ana.token })).data.request.status, 'rejected')
  })

  // ---------------- projects for GitHub + Demo Day ----------------
  await step('participants approved; projects submitted', async () => {
    const d = (await call('POST', '/bookings', { token: dev.token, body: { eventId: ev.id, participation: 'solo' } })).data.booking
    const { data: bookings } = await admin.from('bookings').select('id').eq('event_id', ev.id)
    for (const b of bookings) await call('POST', `/admin/bookings/${b.id}/approve`, { token: host.token })
    assert.ok(d?.id)
    const base = { eventId: ev.id, problemStatement: 'Finding teammates is hard.', description: 'A long enough description of what the project does for its users.', techStack: 'React, Node' }
    projA = (await call('POST', '/projects', { token: ana.token, body: { ...base, title: 'MatchBoard', githubUrl: 'https://github.com/octocat/Spoon-Knife' } })).data.project
    projD = (await call('POST', '/projects', { token: dev.token, body: { ...base, title: 'SoloShow', githubUrl: 'https://github.com/octocat/Hello-World' } })).data.project
    assert.ok(projA?.id && projD?.id)
    assert.equal((await call('POST', `/organizer/hackathons/${ev.id}/judges`, { token: host.token, body: { judgeId: judge.id } })).status, 201)
  })

  // ---------------- GitHub ----------------
  await step('GitHub connection status never exposes secrets; connect refused cleanly when OAuth isn’t set up', async () => {
    const c = (await call('GET', '/github/connection', { token: ana.token })).data
    assert.equal(c.connected, false)
    assert.equal(JSON.stringify(c).match(/access_token|token_enc|gh[opu]_|GITHUB_|secret/i), null)
    const r = await call('POST', '/github/connect', { token: ana.token })
    if (c.oauth.configured) assert.match(r.data.url, /^https:\/\/github\.com\/login\/oauth\/authorize\?/)
    else assert.equal(r.data.error.code, 'github/not_configured')
    assert.equal((await call('GET', '/github/repos', { token: ana.token })).data.error.code, 'github/not_connected')
  })
  await step('team member maps a public repository → metadata, stats, activity stored', async () => {
    const r = await call('POST', `/github/projects/${projA.id}/repository`, { token: ben.token, body: { repository: 'octocat/Hello-World' } })
    assert.equal(r.status, 201, JSON.stringify(r.data))
    assert.equal(r.data.repository.fullName, 'octocat/Hello-World')
    assert.equal(r.data.repository.visibility, 'public')
    assert.ok(r.data.repository.stats.commits >= 1)
    assert.ok(r.data.activity.some((a) => a.type === 'commit'))
    const p = (await admin.from('projects').select('github_url').eq('id', projA.id).single()).data
    assert.equal(p.github_url, 'https://github.com/octocat/Hello-World', 'project link follows the mapped repo')
  })
  await step('repository access: judge + organizer can view; outsider 404; only team can change', async () => {
    assert.equal((await call('GET', `/github/projects/${projA.id}/repository`, { token: judge.token })).data.repository.fullName, 'octocat/Hello-World')
    assert.equal((await call('GET', `/github/projects/${projA.id}/repository`, { token: host.token })).status, 200)
    assert.equal((await call('GET', `/github/projects/${projA.id}/repository`, { token: outsider.token })).status, 404)
    assert.equal((await call('POST', `/github/projects/${projA.id}/repository`, { token: judge.token, body: { repository: 'octocat/Spoon-Knife' } })).status, 403)
    assert.equal((await call('POST', `/github/projects/${projA.id}/repository/sync`, { token: ana.token })).data.error.code, 'github/cooldown')
    assert.equal((await call('POST', `/github/projects/${projA.id}/repository`, { token: ana.token, body: { repository: 'octocat/this-repo-does-not-exist-cf' } })).data.error.code, 'github/not_found')
  })

  // ---------------- Judge notes ----------------
  await step('judge private notes: saved per judge, invisible to others', async () => {
    assert.equal((await call('PUT', `/judge/projects/${projA.id}/notes`, { token: judge.token, body: { notes: 'Strong demo, ask about scaling.' } })).status, 200)
    assert.equal((await call('GET', `/judge/projects/${projA.id}/notes`, { token: judge.token })).data.notes, 'Strong demo, ask about scaling.')
    assert.equal((await call('GET', `/judge/projects/${projA.id}/notes`, { token: ana.token })).status, 403)
    assert.equal((await call('PUT', `/judge/projects/${projA.id}/notes`, { token: judge.token, body: { notes: 'x'.repeat(5001) } })).status, 422)
  })

  // ---------------- Demo Day ----------------
  let state
  await step('Demo Day: only the organizer can set up; finalists + durations saved', async () => {
    assert.equal((await call('PUT', `/demo/${ev.id}`, { token: ana.token, body: { presentationSeconds: 300, qaSeconds: 60, projectIds: [projA.id] } })).status, 403)
    assert.equal((await call('GET', `/demo/${ev.id}`, { token: outsider.token })).status, 404)
    const g = (await call('GET', `/demo/${ev.id}`, { token: host.token })).data
    assert.equal(g.session, null)
    assert.deepEqual(g.candidates.map((c) => c.title).sort(), ['MatchBoard', 'SoloShow'])
    const r = await call('PUT', `/demo/${ev.id}`, { token: host.token, body: { presentationSeconds: 180, qaSeconds: 60, projectIds: [projD.id, projA.id] } })
    assert.equal(r.status, 200, JSON.stringify(r.data))
    state = r.data
    assert.deepEqual(state.presentations.map((p) => p.project.title), ['SoloShow', 'MatchBoard'])
    assert.equal(state.presentations[1].project.teamName, 'Matchmakers')
    assert.equal((await call('PUT', `/demo/${ev.id}`, { token: host.token, body: { presentationSeconds: 10, qaSeconds: 60, projectIds: [] } })).status, 422)
  })
  await step('Demo Day: participants + judge can read state (no candidates list)', async () => {
    const p = (await call('GET', `/demo/${ev.id}`, { token: ben.token })).data
    assert.equal(p.role.participant, true)
    assert.equal(p.candidates, undefined)
    assert.equal((await call('GET', `/demo/${ev.id}`, { token: judge.token })).data.role.judge, true)
    assert.equal((await call('POST', `/demo/${ev.id}/control`, { token: judge.token, body: { action: 'start_session' } })).status, 403)
  })
  await step('Demo Day: start → present → pause/resume → Q&A → next → skip → end (server timestamps)', async () => {
    const ctl = async (action, presentationId) => {
      const r = await call('POST', `/demo/${ev.id}/control`, { token: host.token, body: { action, presentationId } })
      assert.equal(r.status, 200, `${action}: ${JSON.stringify(r.data)}`)
      return r.data
    }
    assert.equal((await call('POST', `/demo/${ev.id}/control`, { token: host.token, body: { action: 'start' } })).data.error.code, 'demo/state')
    let s = await ctl('start_session')
    assert.equal(s.session.status, 'live')
    s = await ctl('start')
    assert.equal(s.session.phase, 'presenting')
    assert.equal(s.presentations[0].status, 'presenting')
    assert.ok(Math.abs(Date.parse(s.session.phaseStartedAt) - Date.parse(s.serverNow)) < 10000)
    s = await ctl('pause')
    assert.ok(s.session.pausedAt)
    assert.equal((await call('POST', `/demo/${ev.id}/control`, { token: host.token, body: { action: 'pause' } })).data.error.code, 'demo/state')
    s = await ctl('resume')
    assert.equal(s.session.pausedAt, null)
    s = await ctl('qa')
    assert.equal(s.session.phase, 'qa')
    assert.equal(s.presentations[0].status, 'qa')
    s = await ctl('next')
    assert.equal(s.presentations[0].status, 'completed')
    assert.equal(s.presentations[1].status, 'presenting')
    s = await ctl('skip')
    assert.equal(s.presentations[1].status, 'skipped')
    s = await ctl('end_session')
    assert.equal(s.session.status, 'ended')
    assert.equal((await call('POST', `/demo/${ev.id}/control`, { token: host.token, body: { action: 'start' } })).data.error.code, 'demo/state')
  })
} finally {
  for (const id of cleanup.events) await admin.rpc('delete_event', { p_event: id })
  for (const id of cleanup.users) await admin.auth.admin.deleteUser(id)
  console.log(`  ✓ cleanup: ${cleanup.events.length} event, ${cleanup.users.length} users removed`)
  console.log(`\n${passed} passed${process.exitCode ? ', FAILED' : ''}`)
}
