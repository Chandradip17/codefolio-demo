// /api/demo — Demo Day. State lives in demo_sessions / demo_presentations; every
// transition is stamped with the database clock (demo_control), and clients derive
// the countdown from phase_started_at + duration − pauses, using serverNow to
// correct their own clock. Changes are pushed over the realtime stream
// (Supabase broadcast relay → SSE) to authorized people only.
//   GET  /:eventId           state (organizer, assigned judges, approved participants)
//   PUT  /:eventId           organizer: durations + finalist queue
//   POST /:eventId/control   organizer: { action, presentationId? }
import { Router } from 'express'
import { z } from 'zod'
import { admin } from '../lib/supabase.js'
import { HttpError, must, mustRow, notConfigured } from '../lib/errors.js'
import { requireAuth } from '../lib/auth.js'
import { publish } from '../lib/realtime.js'
import { summarize } from '../lib/scoring.js'
import { teamInfo } from './judging.js'

const router = Router()
router.use((req, res, next) => {
  if (!admin) throw notConfigured()
  next()
})
router.use(requireAuth)

async function roleIn(user, eventId) {
  const ev = must(await admin.from('events').select('id, title, date, category, created_by, status').eq('id', eventId).maybeSingle())
  if (!ev || ev.category !== 'hackathon' || ev.status === 'Draft') throw new HttpError(404, 'event/missing', 'Hackathon not found.')
  const manager = ev.created_by === user.id || user.isAdmin
  const [judge, booking] = await Promise.all([
    user.isJudge ? admin.from('judge_assignments').select('judge_id').eq('event_id', ev.id).eq('judge_id', user.id).maybeSingle() : { data: null },
    admin.from('bookings').select('id').eq('event_id', ev.id).eq('user_id', user.id).in('status', ['Confirmed', 'Attended']).limit(1),
  ])
  return { ev, manager, judge: Boolean(must(judge)), participant: must(booking).length > 0 }
}

async function audience(ev) {
  const [judges, people] = await Promise.all([
    admin.from('judge_assignments').select('judge_id').eq('event_id', ev.id),
    admin.from('bookings').select('user_id').eq('event_id', ev.id).in('status', ['Confirmed', 'Attended']),
  ])
  return [...new Set([ev.created_by, ...must(judges).map((j) => j.judge_id), ...must(people).map((b) => b.user_id)])]
}

export async function demoState(ev) {
  const s = must(await admin.from('demo_sessions').select('*').eq('event_id', ev.id).maybeSingle())
  let presentations = []
  if (s) {
    const rows = must(await admin.from('demo_presentations').select('*').eq('session_id', s.id).order('order_number'))
    const projects = rows.length ? must(await admin.from('projects').select('id, title, team_id, submitted_by, github_url, demo_url').in('id', rows.map((r) => r.project_id))) : []
    const byId = new Map(projects.map((p) => [p.id, p]))
    const info = await teamInfo(projects)
    presentations = rows.map((r) => ({
      id: r.id,
      order: r.order_number,
      status: r.status,
      startedAt: r.started_at,
      qaStartedAt: r.qa_started_at,
      endedAt: r.ended_at,
      project: !byId.has(r.project_id) ? null : (() => {
        const p = byId.get(r.project_id)
        const t = info(p)
        return { id: p.id, title: p.title, teamName: t.teamName || t.members[0]?.name || 'Solo', members: t.members.map((m) => m.name), githubUrl: p.github_url, demoUrl: p.demo_url }
      })(),
    }))
  }
  return {
    event: { id: ev.id, title: ev.title, date: ev.date },
    session: s && {
      id: s.id,
      status: s.status,
      phase: s.phase,
      presentationSeconds: s.presentation_seconds,
      qaSeconds: s.qa_seconds,
      currentPresentationId: s.current_presentation_id,
      phaseStartedAt: s.phase_started_at,
      pausedAt: s.paused_at,
      pausedSeconds: s.paused_seconds,
      startedAt: s.started_at,
      endedAt: s.ended_at,
    },
    presentations,
    serverNow: new Date().toISOString(),
  }
}

router.get('/:eventId', async (req, res) => {
  const r = await roleIn(req.user, req.params.eventId)
  if (!r.manager && !r.judge && !r.participant) throw new HttpError(404, 'event/missing', 'Hackathon not found.')
  const state = await demoState(r.ev)
  let candidates
  if (r.manager) {
    // Finalist picker: every submitted project with its current judging average.
    const [projects, reviews, judges] = await Promise.all([
      admin.from('projects').select('id, title, team_id, submitted_by').eq('event_id', r.ev.id).order('created_at'),
      admin.from('project_reviews').select('*').eq('event_id', r.ev.id),
      admin.from('judge_assignments').select('judge_id', { count: 'exact', head: true }).eq('event_id', r.ev.id),
    ])
    const rv = must(reviews)
    const list = must(projects)
    const info = await teamInfo(list)
    candidates = list.map((p) => {
      const s = summarize(rv.filter((x) => x.project_id === p.id), judges.count || 0)
      const t = info(p)
      return { id: p.id, title: p.title, teamName: t.teamName || t.members[0]?.name || 'Solo', average: s.average, reviews: s.reviews }
    })
  }
  res.set('Cache-Control', 'no-store').json({ ...state, role: { manager: r.manager, judge: r.judge, participant: r.participant }, candidates })
})

const saveSchema = z.object({
  presentationSeconds: z.coerce.number().int().min(60, 'At least 1 minute.').max(3600, 'At most 60 minutes.'),
  qaSeconds: z.coerce.number().int().min(0).max(1800, 'At most 30 minutes.'),
  projectIds: z.array(z.string().uuid()).max(100).default([]),
})

async function broadcast(ev) {
  const state = await demoState(ev)
  publish('demo.updated', state, await audience(ev))
  return state
}

router.put('/:eventId', async (req, res) => {
  const r = await roleIn(req.user, req.params.eventId)
  if (!r.manager) throw new HttpError(403, 'auth/forbidden', 'Only this hackathon’s organizer can run Demo Day.')
  const b = saveSchema.parse(req.body)
  mustRow(await admin.rpc('demo_save_session', { p_actor: req.user.id, p_event: r.ev.id, p_presentation_seconds: b.presentationSeconds, p_qa_seconds: b.qaSeconds, p_projects: b.projectIds }))
  res.json(await broadcast(r.ev))
})

const ACTIONS = ['start_session', 'start', 'qa', 'end', 'next', 'skip', 'pause', 'resume', 'end_session']
router.post('/:eventId/control', async (req, res) => {
  const r = await roleIn(req.user, req.params.eventId)
  if (!r.manager) throw new HttpError(403, 'auth/forbidden', 'Only this hackathon’s organizer can control Demo Day.')
  const b = z.object({ action: z.enum(ACTIONS), presentationId: z.string().uuid().nullish() }).parse(req.body)
  const s = must(await admin.from('demo_sessions').select('id').eq('event_id', r.ev.id).maybeSingle())
  if (!s) throw new HttpError(404, 'demo/missing', 'Create the Demo Day session first.')
  mustRow(await admin.rpc('demo_control', { p_actor: req.user.id, p_session: s.id, p_action: b.action, p_presentation: b.presentationId || null }))
  console.info(`[demo] ${r.ev.id}: ${b.action}`)
  res.json(await broadcast(r.ev))
})

export default router
