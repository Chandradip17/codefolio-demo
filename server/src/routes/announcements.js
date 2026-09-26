// /api/announcements — Hackathon Communication Center. Who may see what is decided
// in the database (announcements_for / cf_can_see_announcement); the API never
// trusts a role, team or user id from the browser.
//   GET  /hackathons          hackathons I take part in / judge / organize (+ unread counts)
//   GET  /?event=&before=     the feed I'm allowed to see (+ deadlines; organizers also get teams)
//   POST /                    organizer: create (optionally scheduled)
//   PUT  /:id                 organizer: edit
//   POST /:id/archive         organizer: archive (never hard-deleted)
//   POST /read                mark read { eventId, ids? }
//   GET  /unread              unread counts per hackathon
import { Router } from 'express'
import { z } from 'zod'
import { admin } from '../lib/supabase.js'
import { HttpError, must, mustRow, notConfigured } from '../lib/errors.js'
import { requireAuth } from '../lib/auth.js'
import { publish } from '../lib/realtime.js'

const router = Router()
router.use((req, res, next) => {
  if (!admin) throw notConfigured()
  next()
})
router.use(requireAuth)

async function roleIn(userId, eventId) {
  return mustRow(await admin.rpc('cf_event_role', { p_user: userId, p_event: String(eventId || '') }))
}
async function hackathon(eventId) {
  const ev = must(await admin.from('events').select('*').eq('id', String(eventId || '')).maybeSingle())
  if (!ev || ev.category !== 'hackathon' || ev.status === 'Draft') throw new HttpError(404, 'event/missing', 'Hackathon not found.')
  return ev
}

const toAnnouncement = (r) => ({
  id: r.id,
  eventId: r.event_id,
  title: r.title,
  message: r.message,
  audience: r.audience_type,
  teamId: r.team_id,
  teamName: r.team_name ?? null,
  important: r.is_important,
  pinned: r.is_pinned,
  publishAt: r.publish_at,
  editedAt: r.edited_at,
  archivedAt: r.archived_at,
  author: r.created_by_name ?? null,
  read: r.is_read ?? false,
  // Rows straight from a write: compare with the row's own (database) creation time,
  // so a small clock difference between the API and the database can't flip it.
  scheduled: r.scheduled ?? Date.parse(r.publish_at) > Math.max(Date.now(), Date.parse(r.created_at) + 1000),
})

// Upcoming deadlines straight from the hackathon listing (IST), no extra notifications.
function deadlines(ev) {
  const out = []
  const now = Date.now()
  if (ev.applications_close_at) out.push({ key: 'applications', label: 'Applications close', at: ev.applications_close_at })
  if (ev.date && ev.start_time) out.push({ key: 'start', label: 'Hacking starts', at: new Date(`${ev.date}T${ev.start_time}+05:30`).toISOString() })
  if (ev.end_time) out.push({ key: 'submission', label: 'Hacking ends · submit your project', at: new Date(`${ev.end_date || ev.date}T${ev.end_time}+05:30`).toISOString() })
  return out.filter((d) => Date.parse(d.at) > now).sort((a, b) => a.at.localeCompare(b.at))
}

// Push every announcement whose time has come (once each), to exactly its audience.
export async function deliverDue() {
  if (!admin) return 0
  const due = must(await admin.rpc('claim_due_announcements'))
  for (const a of due) {
    const [to, ev] = await Promise.all([admin.rpc('announcement_audience', { p_id: a.id }), admin.from('events').select('title').eq('id', a.event_id).single()])
    const users = must(to).map((x) => (typeof x === 'string' ? x : x.announcement_audience)).filter((u) => u && u !== a.created_by)
    publish('announcement.published', { id: a.id, eventId: a.event_id, eventTitle: must(ev)?.title, title: a.title, important: a.is_important }, users)
  }
  return due.length
}
let ticker = null
export function startAnnouncementTicker() {
  if (ticker || !admin) return
  ticker = setInterval(() => deliverDue().catch((e) => console.warn(`[announcements] delivery failed: ${e.message}`)), 30000)
  ticker.unref()
}

router.get('/hackathons', async (req, res) => {
  const [bk, jd, counts] = await Promise.all([
    admin.from('bookings').select('event_id').eq('user_id', req.user.id).in('status', ['Pending', 'Confirmed', 'Attended']),
    admin.from('judge_assignments').select('event_id').eq('judge_id', req.user.id),
    admin.rpc('announcement_unread_counts', { p_user: req.user.id }),
  ])
  const ids = [...new Set([...must(bk), ...must(jd)].map((r) => r.event_id))]
  const events = ids.length ? must(await admin.from('events').select('id, title, date, end_date').in('id', ids).eq('category', 'hackathon').order('date', { ascending: false })) : []
  const unread = new Map(must(counts).map((c) => [c.event_id, c.unread]))
  const judged = new Set(must(jd).map((r) => r.event_id))
  res.set('Cache-Control', 'no-store').json({
    hackathons: events.map((e) => ({ id: e.id, title: e.title, date: e.date, endDate: e.end_date, role: judged.has(e.id) ? 'judge' : 'participant', unread: unread.get(e.id) || 0 })),
  })
})

router.get('/unread', async (req, res) => {
  const counts = must(await admin.rpc('announcement_unread_counts', { p_user: req.user.id }))
  res.set('Cache-Control', 'no-store').json({ total: counts.reduce((a, c) => a + c.unread, 0), byHackathon: Object.fromEntries(counts.map((c) => [c.event_id, c.unread])) })
})

router.get('/', async (req, res) => {
  const q = z.object({ event: z.string().trim().min(1).max(64), before: z.string().datetime({ offset: true }).optional(), limit: z.coerce.number().int().min(1).max(50).default(20) }).parse(req.query)
  const ev = await hackathon(q.event)
  const role = await roleIn(req.user.id, ev.id)
  if (!role.manager && !role.participant && !role.judge) throw new HttpError(404, 'event/missing', 'Hackathon not found.')
  const rows = must(await admin.rpc('announcements_for', { p_user: req.user.id, p_event: ev.id, p_limit: q.limit + 1, p_before: q.before || null }))
  let teams
  if (role.manager) {
    const t = must(await admin.from('teams').select('id, name, members:team_members(user_id)').eq('event_id', ev.id).order('name'))
    teams = t.map((x) => ({ id: x.id, name: x.name, size: x.members?.length || 0 })).filter((x) => x.size > 0)
  }
  res.set('Cache-Control', 'no-store').json({
    event: { id: ev.id, title: ev.title, date: ev.date, endDate: ev.end_date },
    role: { manager: role.manager, judge: role.judge, participant: role.participant, inTeam: Boolean(role.team_id) },
    announcements: rows.slice(0, q.limit).map(toAnnouncement),
    hasMore: rows.length > q.limit,
    deadlines: deadlines(ev),
    teams,
  })
})

const bodySchema = z
  .object({
    eventId: z.string().trim().min(1).max(64),
    title: z.string().trim().min(3, 'Give it a title (3+ characters).').max(140),
    message: z.string().trim().min(1, 'Write the message.').max(5000),
    audience: z.enum(['all', 'participants', 'judges', 'team']),
    teamId: z.string().uuid().nullish(),
    important: z.boolean().default(false),
    pinned: z.boolean().default(false),
    publishAt: z.string().datetime({ offset: true }).nullish(),
  })
  .refine((b) => b.audience !== 'team' || b.teamId, { message: 'Choose the team.', path: ['teamId'] })

async function save(req, id) {
  const b = bodySchema.parse(req.body)
  const row = mustRow(
    await admin.rpc('save_announcement', {
      p_actor: req.user.id, p_event: b.eventId, p_id: id, p_title: b.title, p_message: b.message, p_audience: b.audience,
      p_team: b.audience === 'team' ? b.teamId : null, p_important: b.important, p_pinned: b.pinned, p_publish_at: b.publishAt || null,
    }),
  )
  return row
}

router.post('/', async (req, res) => {
  const row = await save(req, null)
  res.status(201).json({ announcement: toAnnouncement(row) })
  deliverDue().catch((e) => console.warn(`[announcements] delivery failed: ${e.message}`))
})

// Tell everyone who can see it that the feed changed (no toast for edits).
async function refreshAudience(a) {
  const to = must(await admin.rpc('announcement_audience', { p_id: a.id })).map((x) => (typeof x === 'string' ? x : x.announcement_audience))
  const ev = must(await admin.from('events').select('created_by').eq('id', a.event_id).single())
  publish('announcement.updated', { id: a.id, eventId: a.event_id }, [...to, ev.created_by])
}

router.put('/:id', async (req, res) => {
  if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) throw new HttpError(400, 'bad_id', 'Invalid id.')
  const row = await save(req, req.params.id)
  res.json({ announcement: toAnnouncement(row) })
  if (row.notified_at) refreshAudience(row).catch(() => {})
})

router.post('/:id/archive', async (req, res) => {
  if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) throw new HttpError(400, 'bad_id', 'Invalid id.')
  // Audience first: once archived it's no longer anyone's audience.
  const to = must(await admin.rpc('announcement_audience', { p_id: req.params.id })).map((x) => (typeof x === 'string' ? x : x.announcement_audience))
  const row = mustRow(await admin.rpc('archive_announcement', { p_actor: req.user.id, p_id: req.params.id }))
  res.json({ announcement: toAnnouncement(row) })
  const ev = must(await admin.from('events').select('created_by').eq('id', row.event_id).single())
  publish('announcement.updated', { id: row.id, eventId: row.event_id }, [...to, ev.created_by])
})

router.post('/read', async (req, res) => {
  const b = z.object({ eventId: z.string().trim().min(1).max(64), ids: z.array(z.string().uuid()).max(100).nullish() }).parse(req.body)
  const n = must(await admin.rpc('mark_announcements_read', { p_user: req.user.id, p_event: b.eventId, p_ids: b.ids?.length ? b.ids : null }))
  res.json({ marked: typeof n === 'number' ? n : 0 })
})

export default router
