// /api/ideas — AI Hackathon Idea Assistant (one backend for the floating assistant
// and the /idea-assistant page). Only for hackathons the member has applied to
// (checked here, never taken from the browser). Saved ideas are private to their
// author; an idea stays an idea until the member imports it into a project.
//   GET    /hackathons          my hackathons (applied / accepted) + saved idea counts
//   GET    /context?event=      hackathon facts + prefill (profile skills, team prefs, team size)
//   POST   /generate            3–5 ideas (not saved)
//   POST   /refine              revise one idea (develop / easier / innovative / technical / ai / mvp / …)
//   GET    /?event=             my saved ideas
//   GET    /:id                 one saved idea
//   POST   /                    save
//   PUT    /:id                 update a saved idea
//   DELETE /:id                 delete my idea
import { Router } from 'express'
import { randomUUID } from 'node:crypto'
import rateLimit from 'express-rate-limit'
import { z } from 'zod'
import { admin } from '../lib/supabase.js'
import { config } from '../lib/config.js'
import { HttpError, must, notConfigured } from '../lib/errors.js'
import { requireAuth } from '../lib/auth.js'
import { AIError, geminiConfigured } from '../lib/gemini.js'
import { DIFFICULTY, IDEA_COUNT, REFINE_ACTIONS, cleanIdea, eventHours, generateIdeas, refineIdea } from '../lib/ideas.js'

const MAX_SAVED_PER_HACKATHON = 50
const DRAFT_TTL_MS = 60 * 60 * 1000
const ACTIVE = ['Pending', 'Confirmed', 'Attended'] // applied, accepted or attended (Codefolio's participant rule)

const router = Router()
router.use((req, res, next) => {
  if (!admin) throw notConfigured()
  next()
})
router.use(requireAuth)

// Budget on top of the per-member cooldown: AI calls cost money and time.
const aiLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 20,
  keyGenerator: (req) => req.user.id,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: { code: 'ai/rate_limited', message: 'Too many AI requests. Please try again shortly.' } },
})

// Per-member cooldown between AI requests, enforced here. Starts only when a
// request actually goes to Gemini (config/auth/validation failures don't count).
const lastAiCall = new Map()
function checkCooldown(userId) {
  const s = Math.ceil(((lastAiCall.get(userId) || 0) + config.aiIdeaCooldownSeconds * 1000 - Date.now()) / 1000)
  if (s > 0) {
    const err = new HttpError(429, 'ai/cooldown', `Please wait ${s} second${s === 1 ? '' : 's'} before asking the AI again.`)
    err.extra = { retryAfter: s }
    throw err
  }
}
const startCooldown = (userId) => {
  lastAiCall.set(userId, Date.now())
  if (lastAiCall.size > 10000) lastAiCall.delete(lastAiCall.keys().next().value)
}

// AI output we produced, remembered briefly so a saved idea can carry its model +
// raw response (the browser can't forge that provenance).
const drafts = new Map()
function remember(userId, model, raw) {
  const id = randomUUID()
  drafts.set(id, { userId, model, raw, at: Date.now() })
  for (const [k, v] of drafts) if (Date.now() - v.at > DRAFT_TTL_MS) drafts.delete(k)
  if (drafts.size > 5000) drafts.delete(drafts.keys().next().value)
  return id
}
const draftFor = (userId, id) => {
  const d = id && drafts.get(id)
  return d && d.userId === userId ? d : null
}

const istToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })

// The hackathon, only if this member has applied to it. Anything else looks like "not found".
async function myHackathon(userId, eventId) {
  const id = String(eventId || '').slice(0, 64)
  const [ev, bk] = await Promise.all([
    admin.from('events').select('*').eq('id', id).maybeSingle(),
    admin.from('bookings').select('id').eq('event_id', id).eq('user_id', userId).in('status', ACTIVE).limit(1),
  ])
  const e = must(ev)
  if (!e || e.category !== 'hackathon' || e.status === 'Draft' || !must(bk).length) {
    throw new HttpError(404, 'ideas/not_registered', 'The Idea Assistant works with hackathons you’ve applied to.')
  }
  return e
}

const toIdea = (r) => ({
  id: r.id,
  eventId: r.event_id,
  title: r.title,
  problemStatement: r.problem_statement,
  solution: r.solution,
  whyItFits: r.why_it_fits || '',
  targetUsers: r.target_users,
  features: r.features,
  techStack: r.tech_stack,
  mvpScope: r.mvp_scope,
  roadmap: r.roadmap,
  challenges: r.challenges,
  futureImprovements: r.future_improvements,
  assumptions: r.assumptions,
  inputs: r.inputs,
  aiGenerated: Boolean(r.model),
  model: r.model,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
})
const toRow = (idea) => ({
  title: idea.title,
  problem_statement: idea.problemStatement,
  solution: idea.solution,
  why_it_fits: idea.whyItFits,
  target_users: idea.targetUsers,
  features: idea.features,
  tech_stack: idea.techStack,
  mvp_scope: idea.mvpScope,
  roadmap: idea.roadmap,
  challenges: idea.challenges,
  future_improvements: idea.futureImprovements,
  assumptions: idea.assumptions,
})

const tags = (max, len) =>
  z.preprocess(
    (v) => (typeof v === 'string' ? v.split(',') : v),
    z.array(z.string().trim().max(len, `Keep each item under ${len} characters.`)).max(max, `At most ${max} items.`).transform((a) => [...new Set(a.filter(Boolean))]),
  )
const inputsSchema = z.object({
  eventId: z.string().trim().min(1).max(64),
  problemArea: z.string().trim().max(300, 'Keep the problem area under 300 characters.').default(''),
  skills: tags(20, 40).default([]),
  interests: tags(10, 40).default([]),
  experience: z.enum(['beginner', 'intermediate', 'advanced']).default('intermediate'),
  difficulty: z.enum(DIFFICULTY).default('intermediate'),
  hours: z.coerce.number().int().min(1, 'At least 1 hour.').max(240, 'At most 240 hours.'),
  teamSize: z.coerce.number().int().min(1, 'At least 1 person.').max(20),
  techPreference: z.string().trim().max(200, 'Keep technology preferences under 200 characters.').default(''),
})
const ideaSchema = z.object({
  title: z.string().trim().min(1, 'Give the idea a title.').max(120),
  problemStatement: z.string().max(2000).default(''),
  solution: z.string().max(3000).default(''),
  whyItFits: z.string().max(1500).default(''),
  targetUsers: z.string().max(1000).default(''),
  features: z.array(z.string().max(400)).max(8).default([]),
  techStack: z.array(z.string().max(60)).max(12).default([]),
  mvpScope: z.string().max(3000).default(''),
  roadmap: z.array(z.string().max(400)).max(10).default([]),
  challenges: z.array(z.string().max(400)).max(8).default([]),
  futureImprovements: z.array(z.string().max(400)).max(8).default([]),
  assumptions: z.array(z.string().max(400)).max(8).default([]),
})

// Run an AI call: cooldown first, then Gemini; AI failures become safe HTTP errors.
async function withAi(userId, fn) {
  checkCooldown(userId)
  if (!geminiConfigured()) throw new HttpError(503, 'ai/not_configured', 'AI Idea Assistant is not configured.')
  startCooldown(userId) // blocks parallel requests while this one runs
  try {
    return await fn()
  } catch (e) {
    if (e instanceof AIError) throw new HttpError(e.status, e.code, e.message)
    throw e
  } finally {
    startCooldown(userId) // the wait counts from when the answer arrives
  }
}

router.get('/hackathons', async (req, res) => {
  const bk = must(await admin.from('bookings').select('event_id').eq('user_id', req.user.id).in('status', ACTIVE))
  const ids = [...new Set(bk.map((b) => b.event_id))]
  const events = ids.length
    ? must(await admin.from('events').select('id, title, date, end_date, theme, status, category').in('id', ids).eq('category', 'hackathon').neq('status', 'Draft'))
    : []
  const mine = events.length ? must(await admin.from('hackathon_ideas').select('event_id').eq('user_id', req.user.id).in('event_id', events.map((e) => e.id))) : []
  const today = istToday()
  const rows = events
    .map((e) => ({ id: e.id, title: e.title, date: e.date, theme: e.theme, ended: (e.end_date || e.date) < today, saved: mine.filter((m) => m.event_id === e.id).length }))
    .sort((a, b) => a.ended - b.ended || (a.ended ? b.date.localeCompare(a.date) : a.date.localeCompare(b.date)))
  res.set('Cache-Control', 'no-store').json({ aiAvailable: geminiConfigured(), cooldownSeconds: config.aiIdeaCooldownSeconds, ideaCount: IDEA_COUNT, hackathons: rows })
})

router.get('/context', async (req, res) => {
  const ev = await myHackathon(req.user.id, req.query.event)
  const [profile, prefs, member] = await Promise.all([
    admin.from('profiles').select('skills').eq('id', req.user.id).single(),
    admin.from('team_preferences').select('interests, experience_level').eq('user_id', req.user.id).eq('event_id', ev.id).maybeSingle(),
    admin.from('team_members').select('team_id').eq('user_id', req.user.id).eq('event_id', ev.id).maybeSingle(),
  ])
  const team = must(member)
  const { count } = team ? await admin.from('team_members').select('user_id', { count: 'exact', head: true }).eq('team_id', team.team_id) : { count: null }
  const p = must(prefs)
  const hours = eventHours(ev)
  const hackathon = { id: ev.id, title: ev.title, teamMin: ev.team_min ?? 1, teamMax: ev.team_max ?? 4, date: ev.date, endDate: ev.end_date || ev.date, hours }
  // Only fields the listing actually has.
  if (ev.theme) hackathon.theme = ev.theme
  if (ev.description) hackathon.description = ev.description
  if (ev.requirements?.length) hackathon.requirements = ev.requirements
  if (ev.tags?.length) hackathon.tags = ev.tags
  const retry = Math.ceil(((lastAiCall.get(req.user.id) || 0) + config.aiIdeaCooldownSeconds * 1000 - Date.now()) / 1000)
  res.set('Cache-Control', 'no-store').json({
    aiAvailable: geminiConfigured(),
    cooldownSeconds: config.aiIdeaCooldownSeconds,
    cooldownLeft: Math.max(0, retry),
    ideaCount: IDEA_COUNT,
    hackathon,
    prefill: {
      skills: must(profile)?.skills || [],
      interests: p?.interests || [],
      experience: p?.experience_level || 'intermediate',
      hours: hours || 24,
      teamSize: count || 1,
      teamSizeFromTeam: Boolean(count),
    },
  })
})

router.post(
  '/generate',
  aiLimiter,
  async (req, res) => {
    const b = inputsSchema.extend({ count: z.coerce.number().int().min(IDEA_COUNT.min).max(IDEA_COUNT.max).default(IDEA_COUNT.default) }).parse(req.body)
    const { count, ...inputs } = b
    const ev = await myHackathon(req.user.id, inputs.eventId)
    const r = await withAi(req.user.id, () => generateIdeas(ev, inputs, count))
    res.json({
      ideas: r.ideas.map((idea, i) => ({ ...idea, draftId: remember(req.user.id, r.model, Array.isArray(r.raw?.ideas) ? r.raw.ideas[i] : r.raw) })),
      inputs,
      model: r.model,
      cooldownSeconds: config.aiIdeaCooldownSeconds,
    })
  },
)

router.post(
  '/refine',
  aiLimiter,
  async (req, res) => {
    const b = z.object({ action: z.enum(Object.keys(REFINE_ACTIONS)), idea: ideaSchema, inputs: inputsSchema }).parse(req.body)
    const ev = await myHackathon(req.user.id, b.inputs.eventId)
    const r = await withAi(req.user.id, () => refineIdea(ev, b.inputs, b.idea, b.action))
    res.json({ idea: { ...r.idea, draftId: remember(req.user.id, r.model, r.raw) }, inputs: b.inputs, model: r.model, action: b.action, cooldownSeconds: config.aiIdeaCooldownSeconds })
  },
)

router.get('/', async (req, res) => {
  let q = admin.from('hackathon_ideas').select('*').eq('user_id', req.user.id).order('updated_at', { ascending: false }).limit(100)
  if (req.query.event) q = q.eq('event_id', String(req.query.event).slice(0, 64))
  res.set('Cache-Control', 'no-store').json({ ideas: must(await q).map(toIdea) })
})

const own = async (req) => {
  if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) throw new HttpError(400, 'bad_id', 'Invalid id.')
  const row = must(await admin.from('hackathon_ideas').select('*').eq('id', req.params.id).eq('user_id', req.user.id).maybeSingle())
  // Someone else's idea looks exactly like a missing one.
  if (!row) throw new HttpError(404, 'idea/missing', 'Idea not found.')
  return row
}

router.get('/:id', async (req, res) => {
  res.set('Cache-Control', 'no-store').json({ idea: toIdea(await own(req)) })
})

const saveSchema = z.object({ idea: ideaSchema, inputs: inputsSchema, draftId: z.string().uuid().nullish() })

router.post('/', async (req, res) => {
  const b = saveSchema.parse(req.body)
  const ev = await myHackathon(req.user.id, b.inputs.eventId)
  const { count } = await admin.from('hackathon_ideas').select('id', { count: 'exact', head: true }).eq('user_id', req.user.id).eq('event_id', ev.id)
  if (count >= MAX_SAVED_PER_HACKATHON) throw new HttpError(409, 'idea/too_many', `You can save up to ${MAX_SAVED_PER_HACKATHON} ideas per hackathon. Delete one first.`)
  const d = draftFor(req.user.id, b.draftId)
  const row = must(
    await admin
      .from('hackathon_ideas')
      .insert({ user_id: req.user.id, event_id: ev.id, ...toRow(cleanIdea(b.idea)), inputs: b.inputs, model: d?.model || null, raw_ai_response: d?.raw || null })
      .select('*')
      .single(),
  )
  res.status(201).json({ idea: toIdea(row) })
})

router.put('/:id', async (req, res) => {
  const prev = await own(req)
  const b = saveSchema.parse(req.body)
  if (b.inputs.eventId !== prev.event_id) throw new HttpError(422, 'validation', 'An idea stays with its hackathon.')
  const d = draftFor(req.user.id, b.draftId)
  const row = must(
    await admin
      .from('hackathon_ideas')
      .update({ ...toRow(cleanIdea(b.idea)), inputs: b.inputs, ...(d ? { model: d.model, raw_ai_response: d.raw } : {}), updated_at: new Date().toISOString() })
      .eq('id', prev.id)
      .eq('user_id', req.user.id)
      .select('*')
      .single(),
  )
  res.json({ idea: toIdea(row) })
})

router.delete('/:id', async (req, res) => {
  const prev = await own(req)
  must(await admin.from('hackathon_ideas').delete().eq('id', prev.id).eq('user_id', req.user.id))
  res.status(204).end()
})

export default router
