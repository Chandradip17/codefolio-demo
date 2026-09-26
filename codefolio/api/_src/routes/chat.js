// /api/chat — Participant Chat (two-way, participant ↔ participant). Separate from
// the Communication Center's announcements (one-way, organizer → audience).
// Every rule (membership, room open, read-only after the end, mutes, cooldown,
// burst limit, duplicates) is enforced in the database by send_chat_message; the
// limits come from config.chat and are passed in, never from the browser.
//   GET    /hackathons                         hackathons I can chat in
//   GET    /:eventId                           room state + limits + latest page
//   GET    /:eventId/messages?before=<id>      older messages (cursor)
//   POST   /:eventId/messages                  send { message }
//   POST   /message/:id/report                 report { reason, details }
//   GET    /moderation/:eventId                organizer: reports, mutes, room state
//   PUT    /moderation/:eventId/room           organizer: open / close { active }
//   DELETE /moderation/message/:id             organizer: remove (soft delete)
//   POST   /moderation/report/:id              organizer: { status: dismissed | reviewed }
//   POST   /moderation/:eventId/mutes          organizer: { userId, minutes, reason?, reportId? }
//   DELETE /moderation/:eventId/mutes/:userId  organizer: unmute
import { Router } from 'express'
import { z } from 'zod'
import { admin } from '../lib/supabase.js'
import { config } from '../lib/config.js'
import { HttpError, must, mustRow, notConfigured } from '../lib/errors.js'
import { requireAuth } from '../lib/auth.js'
import { publish } from '../lib/realtime.js'

const router = Router()
router.use((req, res, next) => {
  if (!admin) throw notConfigured()
  next()
})
router.use(requireAuth)

const uuid = z.string().uuid()
const eventIdOf = (v) => z.string().trim().min(1).max(64).parse(v)
const limits = () => ({
  cooldownSeconds: config.chat.cooldownSeconds,
  maxPerMinute: config.chat.maxPerMinute,
  maxLength: config.chat.maxLength,
})

// Live updates go to this hackathon's chat members only (cached briefly).
const audienceCache = new Map()
async function audience(eventId) {
  const hit = audienceCache.get(eventId)
  if (hit && Date.now() - hit.at < 30000) return hit.ids
  const ids = must(await admin.rpc('chat_audience', { p_event: eventId })).map((x) => (typeof x === 'string' ? x : x.chat_audience))
  audienceCache.set(eventId, { ids, at: Date.now() })
  if (audienceCache.size > 500) audienceCache.delete(audienceCache.keys().next().value)
  return ids
}
const pushToChat = async (eventId, type, data) => publish(type, { eventId, ...data }, await audience(eventId))

// Send-result codes (returned, not raised, by send_chat_message) → HTTP status.
const SEND_STATUS = {
  'chat/forbidden': 404,
  'chat/not_participant': 403,
  'chat/closed': 409,
  'chat/read_only': 409,
  'chat/muted': 403,
  'chat/empty': 422,
  'chat/too_long': 422,
  'chat/cooldown': 429,
  'chat/rate_limited': 429,
  'chat/duplicate': 409,
}

router.get('/hackathons', async (req, res) => {
  const bk = must(await admin.from('bookings').select('event_id').eq('user_id', req.user.id).in('status', ['Pending', 'Confirmed', 'Attended']))
  const ids = [...new Set(bk.map((b) => b.event_id))]
  const events = ids.length
    ? must(await admin.from('events').select('id, title, date, end_date, status, category').in('id', ids).eq('category', 'hackathon').neq('status', 'Draft').order('date', { ascending: false }))
    : []
  res.set('Cache-Control', 'no-store').json({ hackathons: events.map((e) => ({ id: e.id, title: e.title, date: e.date, endDate: e.end_date })) })
})

router.get('/:eventId', async (req, res) => {
  const eventId = eventIdOf(req.params.eventId)
  const room = must(await admin.rpc('chat_room_for', { p_user: req.user.id, p_event: eventId, p_read_only_after_end: config.chat.readOnlyAfterEnd }))
  const [page, ev] = await Promise.all([
    admin.rpc('chat_messages_page', { p_user: req.user.id, p_event: eventId, p_before: null, p_limit: config.chat.pageSize }),
    admin.from('events').select('id, title, date, end_date').eq('id', eventId).single(),
  ])
  const now = Date.parse(room.serverNow)
  // Remaining cooldown from the server's clock, so the UI countdown matches what the database will enforce.
  const cooldownLeft = room.lastSentAt ? Math.max(0, Math.ceil((Date.parse(room.lastSentAt) + config.chat.cooldownSeconds * 1000 - now) / 1000)) : 0
  const e = must(ev)
  res.set('Cache-Control', 'no-store').json({
    event: { id: e.id, title: e.title, date: e.date, endDate: e.end_date },
    room: { ...room, cooldownLeft },
    limits: limits(),
    ...must(page),
  })
})

router.get('/:eventId/messages', async (req, res) => {
  const eventId = eventIdOf(req.params.eventId)
  const before = req.query.before ? uuid.parse(req.query.before) : null
  const page = must(await admin.rpc('chat_messages_page', { p_user: req.user.id, p_event: eventId, p_before: before, p_limit: config.chat.pageSize }))
  res.set('Cache-Control', 'no-store').json(page)
})

router.post('/:eventId/messages', async (req, res) => {
  const eventId = eventIdOf(req.params.eventId)
  // Only a sanity bound here; the configured limit is enforced (with a clear message) by the database.
  const { message } = z.object({ message: z.string().max(8000, 'That message is far too long.') }).parse(req.body)
  const c = config.chat
  const r = must(
    await admin.rpc('send_chat_message', {
      p_user: req.user.id, p_event: eventId, p_message: message,
      p_cooldown_seconds: c.cooldownSeconds, p_max_per_minute: c.maxPerMinute, p_max_length: c.maxLength,
      p_duplicate_window_seconds: c.duplicateWindowSeconds, p_read_only_after_end: c.readOnlyAfterEnd,
    }),
  )
  if (!r.ok) {
    const err = new HttpError(SEND_STATUS[r.code] || 422, r.code, r.message)
    if (r.retryAfter) {
      res.set('Retry-After', String(r.retryAfter))
      err.extra = { retryAfter: r.retryAfter }
    }
    if (r.mutedUntil) err.extra = { mutedUntil: r.mutedUntil }
    throw err
  }
  res.status(201).json({ message: r.message, cooldownSeconds: c.cooldownSeconds })
  pushToChat(eventId, 'chat.message', { message: { ...r.message, reportedByMe: false } }).catch((e) => console.warn(`[chat] push failed: ${e.message}`))
})

const REASONS = ['spam', 'harassment', 'inappropriate', 'off_topic', 'other']
router.post('/message/:id/report', async (req, res) => {
  const id = uuid.parse(req.params.id)
  const b = z.object({ reason: z.enum(REASONS), details: z.string().trim().max(500).default('') }).parse(req.body)
  const rep = mustRow(await admin.rpc('report_chat_message', { p_user: req.user.id, p_message: id, p_reason: b.reason, p_details: b.details }))
  res.status(201).json({ report: { id: rep.id, status: rep.status } })
  // Let the organizer know (moderation is the only chat notification besides mutes).
  try {
    const room = must(await admin.from('chat_messages').select('room:chat_rooms(event_id, events(created_by, title))').eq('id', id).single()).room
    publish('chat.report', { eventId: room.event_id, eventTitle: room.events?.title }, [room.events?.created_by])
  } catch (e) {
    console.warn(`[chat] report notification failed: ${e.message}`)
  }
})

// ---------- moderation (organizer of the hackathon or platform admin; checked in SQL) ----------
router.get('/moderation/:eventId', async (req, res) => {
  const eventId = eventIdOf(req.params.eventId)
  const data = must(await admin.rpc('chat_moderation', { p_actor: req.user.id, p_event: eventId }))
  res.set('Cache-Control', 'no-store').json({ ...data, limits: { ...limits(), duplicateWindowSeconds: config.chat.duplicateWindowSeconds, readOnlyAfterEnd: config.chat.readOnlyAfterEnd } })
})

router.put('/moderation/:eventId/room', async (req, res) => {
  const eventId = eventIdOf(req.params.eventId)
  const { active } = z.object({ active: z.boolean() }).parse(req.body)
  const r = mustRow(await admin.rpc('chat_set_room_active', { p_actor: req.user.id, p_event: eventId, p_active: active }))
  res.json({ room: { id: r.id, active: r.is_active } })
  pushToChat(eventId, 'chat.room', { active: r.is_active }).catch(() => {})
})

router.delete('/moderation/message/:id', async (req, res) => {
  const id = uuid.parse(req.params.id)
  const cm = mustRow(await admin.rpc('chat_delete_message', { p_actor: req.user.id, p_message: id }))
  const room = must(await admin.from('chat_rooms').select('event_id').eq('id', cm.room_id).single())
  res.json({ ok: true })
  pushToChat(room.event_id, 'chat.deleted', { id }).catch(() => {})
})

router.post('/moderation/report/:id', async (req, res) => {
  const id = uuid.parse(req.params.id)
  const { status } = z.object({ status: z.enum(['dismissed', 'reviewed']) }).parse(req.body)
  const rep = mustRow(await admin.rpc('chat_review_report', { p_actor: req.user.id, p_report: id, p_status: status }))
  res.json({ report: { id: rep.id, status: rep.status } })
})

router.post('/moderation/:eventId/mutes', async (req, res) => {
  const eventId = eventIdOf(req.params.eventId)
  const b = z
    .object({ userId: uuid, minutes: z.coerce.number().int().min(5, 'At least 5 minutes.').max(43200, 'At most 30 days.'), reason: z.string().trim().max(300).default(''), reportId: uuid.nullish() })
    .parse(req.body)
  const until = new Date(Date.now() + b.minutes * 60000).toISOString()
  const mu = mustRow(await admin.rpc('chat_mute_user', { p_actor: req.user.id, p_event: eventId, p_user: b.userId, p_until: until, p_reason: b.reason }))
  if (b.reportId) await admin.rpc('chat_review_report', { p_actor: req.user.id, p_report: b.reportId, p_status: 'action_taken' })
  res.status(201).json({ mute: { userId: mu.user_id, mutedUntil: mu.muted_until } })
  publish('chat.muted', { eventId, mutedUntil: mu.muted_until }, [b.userId])
})

router.delete('/moderation/:eventId/mutes/:userId', async (req, res) => {
  const eventId = eventIdOf(req.params.eventId)
  const userId = uuid.parse(req.params.userId)
  must(await admin.rpc('chat_unmute_user', { p_actor: req.user.id, p_event: eventId, p_user: userId }))
  res.status(204).end()
  publish('chat.muted', { eventId, mutedUntil: null }, [userId])
})

export default router
