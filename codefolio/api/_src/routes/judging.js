// Judging: judge applications (member + admin), hackathon project submission,
// the judge workspace, organizer judging/results and public results.
// Every write goes through a SECURITY DEFINER SQL function (see migration
// 20260926120000_judging.sql); these routes only authenticate and shape data.
import { Router } from 'express'
import { z } from 'zod'
import { admin } from '../lib/supabase.js'
import { HttpError, must, mustRow, notConfigured } from '../lib/errors.js'
import { clearUserCache, requireAuth } from '../lib/auth.js'
import { publish } from '../lib/realtime.js'
import { judgeApplicationSchema, judgeReviewSchema, projectSchema, reviewSchema } from '../lib/validate.js'
import { CRITERIA, VARIANCE_THRESHOLD, rank, summarize } from '../lib/scoring.js'
import { geminiAnalysis, publicFacts, repoFacts } from '../lib/ai.js'
import { analysisTokenFor } from './github.js'
import { toEvent } from '../lib/mappers.js'
import { deriveAnalytics } from '../lib/analytics.js'

const ready = (req, res, next) => {
  if (!admin) throw notConfigured()
  next()
}
const PROFILE_BRIEF = 'id, name, username, avatar_url, college, company'
const ANALYSIS_COOLDOWN_MS = 5 * 60 * 1000

// ---------- shared helpers ----------
const toApplication = (r, p, { forAdmin = false } = {}) => ({
  id: r.id,
  jobTitle: r.job_title,
  organization: r.organization,
  experienceYears: r.experience_years,
  expertise: r.expertise || [],
  judgingExperience: r.judging_experience || '',
  reason: r.reason,
  status: r.status,
  // The note is shown to the applicant as the reason for the decision.
  note: r.admin_notes || null,
  reviewedAt: r.reviewed_at,
  createdAt: r.created_at,
  ...(forAdmin && p
    ? {
        applicant: {
          id: p.id,
          name: p.name,
          email: p.email,
          username: p.username,
          avatarUrl: p.avatar_url,
          college: p.college,
          company: p.company,
          skills: p.skills || [],
          bio: p.bio || '',
          githubUrl: p.github_url,
          linkedinUrl: p.linkedin_url,
          portfolioUrl: p.portfolio_url,
          isJudge: p.is_judge,
        },
      }
    : {}),
})

const toProject = (p, extra = {}) => ({
  id: p.id,
  eventId: p.event_id,
  teamId: p.team_id,
  title: p.title,
  problemStatement: p.problem_statement,
  description: p.description,
  techStack: p.tech_stack || [],
  githubUrl: p.github_url,
  demoUrl: p.demo_url,
  videoUrl: p.video_url,
  submittedAt: p.created_at,
  updatedAt: p.updated_at,
  ...extra,
})

const toReview = (r) => ({
  id: r.id,
  projectId: r.project_id,
  judgeId: r.judge_id,
  innovation: Number(r.innovation),
  technical: Number(r.technical),
  impact: Number(r.impact),
  uiux: Number(r.uiux),
  presentation: Number(r.presentation),
  weighted: Number(r.weighted),
  feedback: r.feedback,
  updatedAt: r.updated_at,
})

// Profile fields a judge application may fill in (skills, links, bio).
async function updateProfileFromApplication(userId, input) {
  const patch = {}
  if (input.skills?.length) patch.skills = input.skills
  if (input.githubUrl) patch.github_url = input.githubUrl
  if (input.linkedinUrl) patch.linkedin_url = input.linkedinUrl
  if (input.portfolioUrl) patch.portfolio_url = input.portfolioUrl
  if (input.bio) patch.bio = input.bio
  if (Object.keys(patch).length) must(await admin.from('profiles').update(patch).eq('id', userId))
}

export async function createJudgeApplication(userId, input) {
  await updateProfileFromApplication(userId, input)
  return mustRow(
    await admin.rpc('request_judge', {
      p_user: userId,
      p_role: input.jobTitle,
      p_org: input.organization,
      p_years: input.experienceYears,
      p_expertise: input.expertise || [],
      p_judging: input.judgingExperience || '',
      p_reason: input.reason,
    }),
  )
}

// Team name + members for a set of projects.
export async function teamInfo(projects) {
  const teamIds = [...new Set(projects.map((p) => p.team_id).filter(Boolean))]
  const soloIds = [...new Set(projects.filter((p) => !p.team_id).map((p) => p.submitted_by))]
  const teams = teamIds.length
    ? must(await admin.from('teams').select('id, name, members:team_members(user_id, joined_at, profile:profiles!team_members_user_id_fkey(name, username))').in('id', teamIds))
    : []
  const solos = soloIds.length ? must(await admin.from('profiles').select('id, name, username').in('id', soloIds)) : []
  const byTeam = new Map(teams.map((t) => [t.id, t]))
  const byUser = new Map(solos.map((u) => [u.id, u]))
  return (p) => {
    const t = p.team_id && byTeam.get(p.team_id)
    if (t) {
      const members = [...(t.members || [])]
        .sort((a, b) => String(a.joined_at).localeCompare(String(b.joined_at)))
        .map((m) => ({ name: m.profile?.name || 'Member', username: m.profile?.username || null }))
      return { teamName: t.name, members }
    }
    const u = byUser.get(p.submitted_by)
    return { teamName: null, members: u ? [{ name: u.name, username: u.username }] : [] }
  }
}

async function eventRow(id) {
  return must(await admin.from('events').select('*').eq('id', id).maybeSingle())
}
const canManage = (ev, user) => ev && (ev.created_by === user.id || user.isAdmin)

// Projects of a hackathon with their reviews summarised (organizer + results views).
async function judgingData(ev) {
  const [projects, reviews, assignments] = await Promise.all([
    must(await admin.from('projects').select('*').eq('event_id', ev.id).order('created_at')),
    must(await admin.from('project_reviews').select('*').eq('event_id', ev.id)),
    must(await admin.from('judge_assignments').select('judge_id, created_at').eq('event_id', ev.id).order('created_at')),
  ])
  const judgeIds = [...new Set([...assignments.map((a) => a.judge_id), ...reviews.map((r) => r.judge_id)])]
  const judges = judgeIds.length ? must(await admin.from('profiles').select(PROFILE_BRIEF).in('id', judgeIds)) : []
  const judgeById = new Map(judges.map((j) => [j.id, j]))
  const info = await teamInfo(projects)
  const rows = projects.map((p) => {
    const rs = reviews.filter((r) => r.project_id === p.id)
    return {
      project: toProject(p, info(p)),
      reviews: rs.map((r) => ({ ...toReview(r), judgeName: judgeById.get(r.judge_id)?.name || 'Judge' })),
      summary: summarize(rs, assignments.length),
    }
  })
  return {
    rows,
    judges: assignments.map((a) => {
      const j = judgeById.get(a.judge_id) || { id: a.judge_id }
      return {
        id: j.id,
        name: j.name,
        username: j.username,
        avatarUrl: j.avatar_url,
        organization: j.company || j.college || null,
        assignedAt: a.created_at,
        reviewed: reviews.filter((r) => r.judge_id === a.judge_id).length,
      }
    }),
  }
}

// =====================================================================
// Member: /api/judge-applications
// =====================================================================
export const judgeApplicationRouter = Router()
judgeApplicationRouter.use(ready, requireAuth)

judgeApplicationRouter.get('/me', async (req, res) => {
  const rows = must(await admin.from('judge_applications').select('*').eq('user_id', req.user.id).order('created_at', { ascending: false }).limit(5))
  res.set('Cache-Control', 'no-store').json({ applications: rows.map((r) => toApplication(r)), isJudge: req.user.isJudge })
})

judgeApplicationRouter.post('/', async (req, res) => {
  const input = judgeApplicationSchema.parse(req.body)
  const row = await createJudgeApplication(req.user.id, input)
  res.status(201).json({ application: toApplication(row) })
})

// =====================================================================
// Admin: /api/platform/judge-applications
// =====================================================================
export const judgeAdminRouter = Router()
judgeAdminRouter.use(ready, requireAuth, (req, res, next) => {
  if (!req.user.isAdmin) throw new HttpError(403, 'auth/forbidden', 'Only platform admins can review judge applications.')
  next()
})
const APPLICANT = 'profile:profiles!judge_applications_user_id_fkey(id, name, email, username, avatar_url, college, company, skills, bio, github_url, linkedin_url, portfolio_url, is_judge)'

judgeAdminRouter.get('/', async (req, res) => {
  const status = ['pending', 'approved', 'rejected'].includes(req.query.status) ? req.query.status : null
  let q = admin.from('judge_applications').select(`*, ${APPLICANT}`).order('created_at', { ascending: false }).limit(200)
  if (status) q = q.eq('status', status)
  const [rows, all] = await Promise.all([q, admin.from('judge_applications').select('status')])
  const counts = { pending: 0, approved: 0, rejected: 0 }
  for (const r of must(all)) counts[r.status]++
  res.set('Cache-Control', 'no-store').json({ applications: must(rows).map((r) => toApplication(r, r.profile, { forAdmin: true })), counts })
})

judgeAdminRouter.get('/:id', async (req, res) => {
  const r = must(await admin.from('judge_applications').select(`*, ${APPLICANT}`).eq('id', req.params.id).maybeSingle())
  if (!r) throw new HttpError(404, 'judge/missing', 'Application not found.')
  res.set('Cache-Control', 'no-store').json({ application: toApplication(r, r.profile, { forAdmin: true }) })
})

judgeAdminRouter.post('/:id/:action', async (req, res) => {
  const decision = { approve: 'approved', reject: 'rejected' }[req.params.action]
  if (!decision) throw new HttpError(404, 'not_found', 'Unknown action.')
  const { note } = reviewSchema.parse(req.body || {})
  const row = mustRow(await admin.rpc('review_judge_application', { p_admin: req.user.id, p_application: req.params.id, p_decision: decision, p_note: note }))
  clearUserCache() // the applicant's next request sees their new role
  const full = must(await admin.from('judge_applications').select(`*, ${APPLICANT}`).eq('id', row.id).single())
  res.json({ application: toApplication(full, full.profile, { forAdmin: true }) })
  publish('judge.application.updated', { application: toApplication(row) }, [row.user_id])
})

// =====================================================================
// Participants: /api/projects
// =====================================================================
export const projectRouter = Router()
projectRouter.use(ready, requireAuth)

// Projects the member is part of (their team's, or their own solo project).
projectRouter.get('/mine', async (req, res) => {
  const bookings = must(
    await admin.from('bookings').select('event_id, team_id').eq('user_id', req.user.id).in('status', ['Confirmed', 'Attended']).not('event_id', 'is', null),
  )
  const teamIds = bookings.map((b) => b.team_id).filter(Boolean)
  const eventIds = bookings.filter((b) => !b.team_id).map((b) => b.event_id)
  const [byTeam, solo] = await Promise.all([
    teamIds.length ? admin.from('projects').select('*').in('team_id', teamIds) : { data: [] },
    eventIds.length ? admin.from('projects').select('*').in('event_id', eventIds).eq('submitted_by', req.user.id).is('team_id', null) : { data: [] },
  ])
  const projects = [...must(byTeam), ...must(solo)]
  const reviewed = projects.length ? must(await admin.from('project_reviews').select('project_id').in('project_id', projects.map((p) => p.id))) : []
  const locked = new Set(reviewed.map((r) => r.project_id))
  res.set('Cache-Control', 'no-store').json({ projects: projects.map((p) => toProject(p, { locked: locked.has(p.id) })) })
})

projectRouter.post('/', async (req, res) => {
  const input = projectSchema.parse(req.body)
  const row = mustRow(
    await admin.rpc('submit_project', {
      p_user: req.user.id,
      p_event: input.eventId,
      p_title: input.title,
      p_problem: input.problemStatement,
      p_description: input.description,
      p_stack: input.techStack,
      p_github: input.githubUrl,
      p_demo: input.demoUrl || null,
      p_video: input.videoUrl || null,
    }),
  )
  res.status(201).json({ project: toProject(row, { locked: false }) })
})

// =====================================================================
// Judges: /api/judge (approved judges only)
// =====================================================================
export const judgeRouter = Router()
judgeRouter.use(ready, requireAuth, (req, res, next) => {
  if (!req.user.isJudge) throw new HttpError(403, 'auth/forbidden', 'Only approved judges can open the judge workspace.')
  next()
})

async function assignedProject(req) {
  const p = must(await admin.from('projects').select('*').eq('id', req.params.id).maybeSingle())
  if (!p) throw new HttpError(404, 'project/missing', 'Project not found.')
  const a = must(await admin.from('judge_assignments').select('event_id').eq('event_id', p.event_id).eq('judge_id', req.user.id).maybeSingle())
  // Unassigned judges get the same answer as a missing project.
  if (!a) throw new HttpError(404, 'project/missing', 'Project not found.')
  return p
}

judgeRouter.get('/overview', async (req, res) => {
  const assignments = must(await admin.from('judge_assignments').select('event_id').eq('judge_id', req.user.id))
  const eventIds = assignments.map((a) => a.event_id)
  if (!eventIds.length) return res.set('Cache-Control', 'no-store').json({ hackathons: [], projects: [], criteria: CRITERIA })
  const [events, projects, mine, demos] = await Promise.all([
    must(await admin.from('events').select('*').in('id', eventIds)),
    must(await admin.from('projects').select('*').in('event_id', eventIds).order('created_at')),
    must(await admin.from('project_reviews').select('*').eq('judge_id', req.user.id).in('event_id', eventIds)),
    must(await admin.from('demo_sessions').select('event_id, status').in('event_id', eventIds)),
  ])
  const demoByEvent = new Map(demos.map((d) => [d.event_id, d.status]))
  const info = await teamInfo(projects)
  const evById = new Map(events.map((e) => [e.id, e]))
  const myByProject = new Map(mine.map((r) => [r.project_id, r]))
  res.set('Cache-Control', 'no-store').json({
    criteria: CRITERIA,
    hackathons: events
      .map((e) => ({ id: e.id, title: e.title, date: e.date, endDate: e.end_date, resultsPublished: Boolean(e.results_published_at), demoDay: demoByEvent.get(e.id) || null }))
      .sort((a, b) => a.date.localeCompare(b.date)),
    projects: projects.map((p) => {
      const r = myByProject.get(p.id)
      const ev = evById.get(p.event_id)
      return toProject(p, {
        ...info(p),
        eventTitle: ev?.title,
        resultsPublished: Boolean(ev?.results_published_at),
        myReview: r ? { weighted: Number(r.weighted), updatedAt: r.updated_at } : null,
      })
    }),
  })
})

judgeRouter.get('/projects/:id', async (req, res) => {
  const p = await assignedProject(req)
  const [ev, myReview, analysis, info, conflict] = await Promise.all([
    eventRow(p.event_id),
    admin.from('project_reviews').select('*').eq('project_id', p.id).eq('judge_id', req.user.id).maybeSingle(),
    admin.from('project_analysis').select('*').eq('project_id', p.id).maybeSingle(),
    teamInfo([p]),
    admin.from('bookings').select('id').eq('user_id', req.user.id).eq('event_id', p.event_id).in('status', ['Pending', 'Confirmed', 'Attended']).limit(1),
  ])
  const a = must(analysis)
  res.set('Cache-Control', 'no-store').json({
    project: toProject(p, info(p)),
    event: { id: ev.id, title: ev.title, date: ev.date, endDate: ev.end_date, theme: ev.theme || null, resultsPublished: Boolean(ev.results_published_at) },
    criteria: CRITERIA,
    myReview: must(myReview) ? toReview(must(myReview)) : null,
    canReview: !ev.results_published_at && !must(conflict).length,
    analysis: a ? { repo: a.repo, ai: a.ai, aiStatus: a.ai_status, model: a.model, error: a.error, analyzedAt: a.analyzed_at } : null,
  })
})

judgeRouter.post('/projects/:id/review', async (req, res) => {
  const p = await assignedProject(req)
  const s = judgeReviewSchema.parse(req.body)
  const row = mustRow(
    await admin.rpc('submit_review', {
      p_judge: req.user.id,
      p_project: p.id,
      p_innovation: s.innovation,
      p_technical: s.technical,
      p_impact: s.impact,
      p_uiux: s.uiux,
      p_presentation: s.presentation,
      p_feedback: s.feedback,
    }),
  )
  const ev = await eventRow(p.event_id)
  res.json({ review: toReview(row) })
  publish('judging.updated', { eventId: p.event_id, projectId: p.id }, [ev?.created_by])
})

// Private notes (Demo Day / review). Only the judge who wrote them can read them.
judgeRouter.get('/projects/:id/notes', async (req, res) => {
  const p = await assignedProject(req)
  const row = must(await admin.from('judge_notes').select('notes, updated_at').eq('judge_id', req.user.id).eq('project_id', p.id).maybeSingle())
  res.set('Cache-Control', 'no-store').json({ notes: row?.notes || '', updatedAt: row?.updated_at || null })
})

judgeRouter.put('/projects/:id/notes', async (req, res) => {
  const p = await assignedProject(req)
  const { notes } = z.object({ notes: z.string().max(5000, 'Notes are limited to 5000 characters.') }).parse(req.body)
  const row = must(
    await admin
      .from('judge_notes')
      .upsert({ judge_id: req.user.id, project_id: p.id, notes, updated_at: new Date().toISOString() })
      .select('notes, updated_at')
      .single(),
  )
  res.json({ notes: row.notes, updatedAt: row.updated_at })
})

// (Re)run the repository + AI analysis. Rate-limited per project.
judgeRouter.post('/projects/:id/analysis', async (req, res) => {
  const p = await assignedProject(req)
  const prev = must(await admin.from('project_analysis').select('*').eq('project_id', p.id).maybeSingle())
  if (prev && prev.ai_status !== 'error' && Date.now() - new Date(prev.analyzed_at).getTime() < ANALYSIS_COOLDOWN_MS) {
    throw new HttpError(429, 'analysis/cooldown', 'This project was analyzed a moment ago. Try again in a few minutes.')
  }
  let facts = null
  let result = { status: 'error', error: null }
  try {
    facts = await repoFacts(p.github_url, { token: await analysisTokenFor(p.id).catch(() => null) })
    if (!facts.found) result = { status: 'error', error: 'Repository not found or not public.' }
    else {
      try {
        result = await geminiAnalysis(p, facts)
      } catch (e) {
        result = { status: 'error', error: e.message }
      }
    }
  } catch (e) {
    result = { status: 'error', error: e.message }
  }
  const row = must(
    await admin
      .from('project_analysis')
      .upsert({
        project_id: p.id,
        repo: publicFacts(facts),
        ai: result.ai || null,
        ai_status: result.status,
        model: result.model || null,
        error: result.error || null,
        requested_by: req.user.id,
        analyzed_at: new Date().toISOString(),
      })
      .select('*')
      .single(),
  )
  res.json({ analysis: { repo: row.repo, ai: row.ai, aiStatus: row.ai_status, model: row.model, error: row.error, analyzedAt: row.analyzed_at } })
})

// =====================================================================
// Organizers: /api/organizer (their hackathons; admins: all)
// =====================================================================
export const organizerRouter = Router()
organizerRouter.use(ready, requireAuth, (req, res, next) => {
  if (req.user.role !== 'organizer' && !req.user.isAdmin) throw new HttpError(403, 'auth/forbidden', 'Only approved hosts can do that.')
  next()
})

async function managedHackathon(req) {
  const ev = await eventRow(req.params.id)
  if (!canManage(ev, req.user) || ev.category !== 'hackathon') throw new HttpError(404, 'event/missing', 'Hackathon not found.')
  return ev
}

organizerRouter.get('/hackathons', async (req, res) => {
  let q = admin.from('events').select('*').eq('category', 'hackathon').order('date', { ascending: false })
  if (!req.user.isAdmin) q = q.eq('created_by', req.user.id)
  const events = must(await q)
  const ids = events.map((e) => e.id)
  const [projects, assignments, reviews] = ids.length
    ? await Promise.all([
        admin.from('projects').select('id, event_id').in('event_id', ids),
        admin.from('judge_assignments').select('event_id').in('event_id', ids),
        admin.from('project_reviews').select('event_id').in('event_id', ids),
      ]).then((r) => r.map(must))
    : [[], [], []]
  const count = (list, id) => list.filter((x) => x.event_id === id).length
  res.set('Cache-Control', 'no-store').json({
    hackathons: events.map((e) => ({
      id: e.id,
      title: e.title,
      date: e.date,
      endDate: e.end_date,
      status: e.status,
      mine: e.created_by === req.user.id,
      resultsPublishedAt: e.results_published_at,
      projects: count(projects, e.id),
      judges: count(assignments, e.id),
      reviews: count(reviews, e.id),
    })),
  })
})

// Analytics: aggregated in the database (hackathon_analytics), organizer/admin only.
organizerRouter.get('/hackathons/:id/analytics', async (req, res) => {
  const ev = must(await admin.from('events').select('id, title, date, end_date, category, status, team_min, team_max').eq('id', req.params.id).maybeSingle())
  if (!ev || ev.category !== 'hackathon') throw new HttpError(404, 'event/missing', 'Hackathon not found.')
  const data = must(await admin.rpc('hackathon_analytics', { p_actor: req.user.id, p_event: ev.id }))
  res.set('Cache-Control', 'no-store').json({ event: { id: ev.id, title: ev.title, date: ev.date, endDate: ev.end_date, status: ev.status }, ...deriveAnalytics(data) })
})

organizerRouter.get('/hackathons/:id/judging', async (req, res) => {
  const ev = await managedHackathon(req)
  const { rows, judges } = await judgingData(ev)
  res.set('Cache-Control', 'no-store').json({
    event: { id: ev.id, title: ev.title, date: ev.date, resultsPublishedAt: ev.results_published_at },
    criteria: CRITERIA,
    varianceThreshold: VARIANCE_THRESHOLD,
    judges,
    projects: rows,
  })
})

// Approved judges to pick from (pending / rejected applicants never appear).
organizerRouter.get('/judges', async (req, res) => {
  const q = String(req.query.q || '').trim().replace(/[%,()]/g, ' ').slice(0, 60)
  let query = admin.from('profiles').select(PROFILE_BRIEF).eq('is_judge', true).order('name').limit(20)
  if (q) query = query.or(`name.ilike.%${q}%,username.ilike.%${q}%,company.ilike.%${q}%,college.ilike.%${q}%`)
  const rows = must(await query)
  res.set('Cache-Control', 'no-store').json({
    judges: rows.map((j) => ({ id: j.id, name: j.name, username: j.username, avatarUrl: j.avatar_url, organization: j.company || j.college || null })),
  })
})

organizerRouter.post('/hackathons/:id/judges', async (req, res) => {
  const ev = await managedHackathon(req)
  const judgeId = String(req.body?.judgeId || '')
  if (!/^[0-9a-f-]{36}$/i.test(judgeId)) throw new HttpError(422, 'validation', 'Choose a judge.')
  mustRow(await admin.rpc('assign_judge', { p_actor: req.user.id, p_event: ev.id, p_judge: judgeId }))
  res.status(201).json({ ok: true })
  publish('judge.assigned', { eventId: ev.id, title: ev.title }, [judgeId])
})

organizerRouter.delete('/hackathons/:id/judges/:judgeId', async (req, res) => {
  const ev = await managedHackathon(req)
  must(await admin.rpc('unassign_judge', { p_actor: req.user.id, p_event: ev.id, p_judge: req.params.judgeId }))
  res.status(204).end()
})

organizerRouter.get('/hackathons/:id/results', async (req, res) => {
  const ev = await managedHackathon(req)
  const { rows, judges } = await judgingData(ev)
  const ranked = rank(rows)
  res.set('Cache-Control', 'no-store').json({
    event: { id: ev.id, title: ev.title, date: ev.date, resultsPublishedAt: ev.results_published_at },
    criteria: CRITERIA,
    judges: judges.length,
    reviewsDone: rows.reduce((t, r) => t + r.summary.reviews, 0),
    reviewsExpected: rows.length * judges.length,
    results: ranked.map((r) => ({ rank: r.rank, project: r.project, summary: r.summary })),
  })
})

organizerRouter.post('/hackathons/:id/results', async (req, res) => {
  const ev = await managedHackathon(req)
  const row = mustRow(await admin.rpc('publish_results', { p_actor: req.user.id, p_event: ev.id, p_publish: req.body?.publish !== false }))
  res.json({ resultsPublishedAt: row.results_published_at })
  const { payment, ...event } = toEvent(row)
  void payment
  publish('event.updated', { event })
})

// =====================================================================
// Public: GET /api/events/:id/results — only once published
// =====================================================================
export async function publicResultsHandler(req, res) {
  const ev = await eventRow(req.params.id)
  if (!ev || ev.status === 'Draft' || ev.category !== 'hackathon') throw new HttpError(404, 'event/missing', 'Hackathon not found.')
  if (!ev.results_published_at) throw new HttpError(404, 'results/unpublished', 'Results for this hackathon haven’t been published yet.')
  const { rows, judges } = await judgingData(ev)
  res.set('Cache-Control', 'no-store').json({
    event: { id: ev.id, title: ev.title, date: ev.date, resultsPublishedAt: ev.results_published_at },
    criteria: CRITERIA,
    judges: judges.length,
    // No judge names, individual scores or feedback in the public view.
    results: rank(rows).map((r) => ({
      rank: r.rank,
      project: {
        id: r.project.id,
        title: r.project.title,
        teamName: r.project.teamName,
        members: r.project.members,
        githubUrl: r.project.githubUrl,
        demoUrl: r.project.demoUrl,
      },
      average: r.summary.average,
      perCriterion: r.summary.perCriterion,
      reviews: r.summary.reviews,
    })),
  })
}
