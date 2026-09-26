// End-to-end (live API + Supabase): judge application → admin approval → role,
// rejection, access control, project submission, assignment, reviews, variance,
// repository analysis, results protection + publishing. Creates temporary
// accounts / a hackathon and removes everything it created.
//   npm run smoke:judging   (API must be running)
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
async function tempUser(email, name, role = 'attendee') {
  await removeExisting(email)
  const { data, error } = await admin.auth.admin.createUser({ email, password: 'Smoke-pass-2026', email_confirm: true, user_metadata: { name } })
  if (error) throw error
  cleanup.users.push(data.user.id)
  await admin.from('profiles').update({ username: email.split('@')[0].replace(/[^a-z0-9_]/g, '_').slice(0, 20), onboarding_completed: true, role }).eq('id', data.user.id)
  return { id: data.user.id, token: await login(email) }
}
const login = async (email) => (await call('POST', '/auth/login', { body: { email, password: 'Smoke-pass-2026' } })).data.session.accessToken
const inDays = (n) => new Date(Date.now() + n * 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })

console.log(`Judging smoke → ${API}`)
try {
  const platformAdmin = { token: (await call('POST', '/auth/login', { body: { email: 'organizer@codefolio.dev', password: 'organizer1234' } })).data.session.accessToken }
  const host = await tempUser('cf_jdg_host@codefolio.dev', 'Judging Host', 'organizer')
  const [pia, sam, rex, outsider] = await Promise.all([
    tempUser('cf_jdg_pia@codefolio.dev', 'Pia Builder'),
    tempUser('cf_jdg_sam@codefolio.dev', 'Sam Solo'),
    tempUser('cf_jdg_rex@codefolio.dev', 'Rex Rejected'),
    tempUser('cf_jdg_out@codefolio.dev', 'Out Sider'),
  ])
  const judges = []
  let appId, ev, teamProject, soloProject

  await step('sign-up with "Apply to become a Judge" → pending application, NOT a judge', async () => {
    const email = 'cf_jdg_judge1@codefolio.dev'
    await removeExisting(email)
    const r = await call('POST', '/auth/signup', {
      body: {
        name: 'Jo Judge', email, password: 'Smoke-pass-2026', role: 'attendee',
        judge: {
          jobTitle: 'Senior Engineer', organization: 'ABC Technologies', experienceYears: 7, skills: 'React, Node.js, AI',
          expertise: ['Web', 'AI'], judgingExperience: 'Judged 4 hackathons', githubUrl: 'https://github.com/jojudge',
          reason: 'I want to help student teams ship better projects.',
        },
      },
    })
    assert.equal(r.status, 201, JSON.stringify(r.data))
    assert.equal(r.data.judgeApplication.status, 'pending')
    assert.equal(r.data.user.isJudge, false)
    cleanup.users.push(r.data.user.id)
    judges.push({ id: r.data.user.id, email, token: r.data.session.accessToken })
    const p = (await admin.from('profiles').select('skills, github_url').eq('id', r.data.user.id).single()).data
    assert.deepEqual(p.skills, ['React', 'Node.js', 'AI']) // stored on the profile, not duplicated
    assert.equal(p.github_url, 'https://github.com/jojudge')
  })
  await step('pending applicant: sees status, but judge routes are 403; can’t apply twice', async () => {
    const me = (await call('GET', '/judge-applications/me', { token: judges[0].token })).data
    assert.equal(me.applications[0].status, 'pending')
    assert.equal(me.isJudge, false)
    appId = me.applications[0].id
    assert.equal((await call('GET', '/judge/overview', { token: judges[0].token })).status, 403)
    const again = await call('POST', '/judge-applications', { token: judges[0].token, body: { jobTitle: 'Eng', organization: 'ABC', experienceYears: 7, reason: 'Applying twice should not work.' } })
    assert.equal(again.data.error.code, 'judge/pending')
  })
  await step('non-admins can’t list or approve applications', async () => {
    assert.equal((await call('GET', '/platform/judge-applications', { token: host.token })).status, 403)
    assert.equal((await call('POST', `/platform/judge-applications/${appId}/approve`, { token: judges[0].token })).status, 403)
  })
  await step('admin sees applicant details and approves → judge role, dashboard opens', async () => {
    const list = (await call('GET', '/platform/judge-applications?status=pending', { token: platformAdmin.token })).data
    const row = list.applications.find((a) => a.id === appId)
    assert.equal(row.applicant.email, judges[0].email)
    assert.equal(row.organization, 'ABC Technologies')
    assert.deepEqual(row.applicant.skills, ['React', 'Node.js', 'AI'])
    const r = await call('POST', `/platform/judge-applications/${appId}/approve`, { token: platformAdmin.token, body: {} })
    assert.equal(r.data.application.status, 'approved')
    assert.ok(r.data.application.reviewedAt)
    assert.equal((await call('GET', '/auth/me', { token: judges[0].token })).data.user.isJudge, true)
    assert.equal((await call('GET', '/judge/overview', { token: judges[0].token })).status, 200)
    assert.equal((await call('POST', `/platform/judge-applications/${appId}/reject`, { token: platformAdmin.token })).data.error.code, 'judge/reviewed')
  })
  await step('rejection keeps the normal account; the applicant sees the reason; still no judge access', async () => {
    const a = (await call('POST', '/judge-applications', { token: rex.token, body: { jobTitle: 'Student', organization: 'Uni', experienceYears: 0, reason: 'I would love to judge a hackathon soon.' } })).data.application
    const r = await call('POST', `/platform/judge-applications/${a.id}/reject`, { token: platformAdmin.token, body: { note: 'Please add judging experience.' } })
    assert.equal(r.data.application.status, 'rejected')
    const me = (await call('GET', '/judge-applications/me', { token: rex.token })).data
    assert.equal(me.applications[0].note, 'Please add judging experience.')
    assert.equal((await call('GET', '/judge/overview', { token: rex.token })).status, 403)
  })
  await step('two more approved judges (via application + approval)', async () => {
    for (const n of [2, 3]) {
      const u = await tempUser(`cf_jdg_judge${n}@codefolio.dev`, `Judge ${n}`)
      const a = (await call('POST', '/judge-applications', { token: u.token, body: { jobTitle: 'Engineer', organization: 'Org', experienceYears: 5, reason: 'Happy to help judge student projects.' } })).data.application
      await call('POST', `/platform/judge-applications/${a.id}/approve`, { token: platformAdmin.token, body: {} })
      judges.push({ ...u, token: await login(`cf_jdg_judge${n}@codefolio.dev`) })
    }
  })
  await step('host creates a hackathon; participants are approved and submit projects', async () => {
    const r = await call('POST', '/events', {
      token: host.token,
      body: {
        title: 'Smoke Judging Hack', category: 'hackathon', mode: 'Online', city: 'Online', venue: 'Online',
        date: inDays(4), time: '10:00', endDate: inDays(5), organizerChapter: 'Smoke Club', capacity: 20,
        applicationsOpenAt: new Date(Date.now() - 3600e3).toISOString(), applicationsCloseAt: new Date(Date.now() + 2 * 86400e3).toISOString(),
        teamMin: 1, teamMax: 3, description: 'Temporary hackathon created by the judging smoke test. Safe to delete.',
      },
    })
    assert.equal(r.status, 201, JSON.stringify(r.data))
    ev = r.data.event
    cleanup.events.push(ev.id)
    await call('PUT', `/admin/events/${ev.id}/form`, { token: host.token, body: { questions: [] } })
    for (const [u, body] of [[pia, { participation: 'team_create', teamName: 'Null Pointers' }], [sam, { participation: 'solo' }]]) {
      const b = (await call('POST', '/bookings', { token: u.token, body: { eventId: ev.id, ...body } })).data.booking
      const early = await call('POST', '/projects', { token: u.token, body: { eventId: ev.id, title: 'Early', problemStatement: 'Not approved yet.', description: 'x'.repeat(40), githubUrl: 'https://github.com/octocat/Hello-World' } })
      assert.equal(early.data.error.code, 'project/not_participant')
      await call('POST', `/admin/bookings/${b.id}/approve`, { token: host.token })
    }
    const base = { eventId: ev.id, problemStatement: 'Finding events takes too long.', description: 'A long enough description of what the project does for its users.', techStack: 'React, Supabase' }
    teamProject = (await call('POST', '/projects', { token: pia.token, body: { ...base, title: 'EventFinder', githubUrl: 'https://github.com/octocat/Hello-World' } })).data.project
    soloProject = (await call('POST', '/projects', { token: sam.token, body: { ...base, title: 'SoloSaver', githubUrl: 'https://github.com/octocat/Spoon-Knife' } })).data.project
    assert.ok(teamProject?.id && soloProject?.id)
    const mine = (await call('GET', '/projects/mine', { token: pia.token })).data.projects
    assert.equal(mine[0].title, 'EventFinder')
  })
  await step('only approved judges can be assigned; participants and non-judges refused', async () => {
    assert.equal((await call('POST', `/organizer/hackathons/${ev.id}/judges`, { token: host.token, body: { judgeId: rex.id } })).data.error.code, 'judge/not_approved')
    await admin.from('profiles').update({ is_judge: true }).eq('id', sam.id)
    assert.equal((await call('POST', `/organizer/hackathons/${ev.id}/judges`, { token: host.token, body: { judgeId: sam.id } })).data.error.code, 'judge/conflict')
    await admin.from('profiles').update({ is_judge: false }).eq('id', sam.id)
    assert.equal((await call('POST', `/organizer/hackathons/${ev.id}/judges`, { token: outsider.token, body: { judgeId: judges[0].id } })).status, 403)
    const picker = (await call('GET', '/organizer/judges?q=Judge', { token: host.token })).data.judges.map((j) => j.id)
    assert.ok(picker.includes(judges[0].id) && !picker.includes(rex.id))
    for (const j of judges) assert.equal((await call('POST', `/organizer/hackathons/${ev.id}/judges`, { token: host.token, body: { judgeId: j.id } })).status, 201)
  })
  await step('judges see only assigned projects; unassigned judge / outsider get 404/403', async () => {
    const o = (await call('GET', '/judge/overview', { token: judges[0].token })).data
    assert.deepEqual(o.projects.map((p) => p.title).sort(), ['EventFinder', 'SoloSaver'])
    assert.equal(o.projects.find((p) => p.title === 'EventFinder').teamName, 'Null Pointers')
    const lone = await tempUser('cf_jdg_judge4@codefolio.dev', 'Judge Four')
    await admin.from('profiles').update({ is_judge: true }).eq('id', lone.id)
    assert.equal((await call('GET', `/judge/projects/${teamProject.id}`, { token: await login('cf_jdg_judge4@codefolio.dev') })).status, 404)
    assert.equal((await call('GET', `/judge/projects/${teamProject.id}`, { token: outsider.token })).status, 403)
  })
  await step('review validation, weighted score, one review per judge (update, no duplicate)', async () => {
    const bad = await call('POST', `/judge/projects/${teamProject.id}/review`, { token: judges[0].token, body: { innovation: 11, technical: 8, impact: 8, uiux: 8, presentation: 8.25 } })
    assert.equal(bad.status, 422)
    assert.ok(bad.data.error.fields.innovation && bad.data.error.fields.presentation)
    const s = { innovation: 9, technical: 8.5, impact: 7, uiux: 6, presentation: 8, feedback: 'Strong idea.' }
    const r1 = (await call('POST', `/judge/projects/${teamProject.id}/review`, { token: judges[0].token, body: s })).data.review
    assert.equal(r1.weighted, 7.88)
    const r2 = (await call('POST', `/judge/projects/${teamProject.id}/review`, { token: judges[0].token, body: { ...s, innovation: 10 } })).data.review
    assert.equal(r2.id, r1.id)
    assert.equal(r2.weighted, 8.13)
    const { count } = await admin.from('project_reviews').select('id', { count: 'exact', head: true }).eq('project_id', teamProject.id)
    assert.equal(count, 1)
  })
  await step('reviewed projects can’t be edited by the team', async () => {
    const r = await call('POST', '/projects', { token: pia.token, body: { eventId: ev.id, title: 'Sneaky', problemStatement: 'Changing after review.', description: 'x'.repeat(40), githubUrl: 'https://github.com/octocat/Hello-World' } })
    assert.equal(r.data.error.code, 'project/locked')
  })
  await step('score variance is flagged for the organizer (scores untouched)', async () => {
    await call('POST', `/judge/projects/${teamProject.id}/review`, { token: judges[1].token, body: { innovation: 9, technical: 9, impact: 9, uiux: 9, presentation: 9 } })
    await call('POST', `/judge/projects/${teamProject.id}/review`, { token: judges[2].token, body: { innovation: 5, technical: 5, impact: 5, uiux: 5, presentation: 5 } })
    const j = (await call('GET', `/organizer/hackathons/${ev.id}/judging`, { token: host.token })).data
    const row = j.projects.find((p) => p.project.id === teamProject.id)
    assert.equal(row.summary.reviews, 3)
    assert.equal(row.summary.complete, true)
    assert.equal(row.summary.varianceFlag, true)
    assert.deepEqual(row.reviews.map((r) => r.weighted).sort(), [5, 8.13, 9])
    assert.equal(j.projects.find((p) => p.project.id === soloProject.id).summary.varianceFlag, false)
  })
  await step('repository analysis: GitHub facts collected; AI runs only if configured', async () => {
    const r = await call('POST', `/judge/projects/${teamProject.id}/analysis`, { token: judges[0].token })
    assert.equal(r.status, 200, JSON.stringify(r.data))
    assert.equal(r.data.analysis.repo.found, true)
    assert.equal(r.data.analysis.repo.fullName, 'octocat/Hello-World')
    assert.equal(r.data.analysis.repo._readme, undefined)
    assert.ok(['ready', 'not_configured', 'error'].includes(r.data.analysis.aiStatus))
    console.log(`      (AI status: ${r.data.analysis.aiStatus}${r.data.analysis.error ? ` — ${r.data.analysis.error}` : ''})`)
    assert.equal((await call('POST', `/judge/projects/${teamProject.id}/analysis`, { token: judges[0].token })).status, r.data.analysis.aiStatus === 'error' ? 200 : 429)
  })
  await step('unpublished results are protected; organizer sees the ranking', async () => {
    assert.equal((await call('GET', `/events/${ev.id}/results`, { token: pia.token })).data.error.code, 'results/unpublished')
    assert.equal((await call('GET', `/organizer/hackathons/${ev.id}/results`, { token: outsider.token })).status, 403)
    assert.equal((await call('GET', `/organizer/hackathons/${ev.id}/results`, { token: judges[0].token })).status, 403)
    const res = (await call('GET', `/organizer/hackathons/${ev.id}/results`, { token: host.token })).data
    assert.equal(res.results[0].project.title, 'EventFinder')
    assert.equal(res.results[0].rank, 1)
    assert.equal(res.results[0].summary.average, 7.38) // (8.13 + 9 + 5) / 3
  })
  await step('publishing opens results to members (no judge names/feedback) and closes reviews', async () => {
    const p = await call('POST', `/organizer/hackathons/${ev.id}/results`, { token: host.token, body: { publish: true } })
    assert.ok(p.data.resultsPublishedAt)
    const pub = (await call('GET', `/events/${ev.id}/results`, { token: pia.token })).data
    assert.equal(pub.results[0].project.title, 'EventFinder')
    assert.equal(JSON.stringify(pub).includes('Strong idea'), false)
    assert.equal(JSON.stringify(pub).includes('Judge 2'), false)
    const late = await call('POST', `/judge/projects/${soloProject.id}/review`, { token: judges[0].token, body: { innovation: 5, technical: 5, impact: 5, uiux: 5, presentation: 5 } })
    assert.equal(late.data.error.code, 'results/published')
  })
} finally {
  for (const id of cleanup.events) await admin.rpc('delete_event', { p_event: id })
  for (const id of cleanup.users) await admin.auth.admin.deleteUser(id)
  console.log(`  ✓ cleanup: ${cleanup.events.length} event, ${cleanup.users.length} users removed`)
  console.log(`\n${passed} passed${process.exitCode ? ', FAILED' : ''}`)
}
