import { Router } from 'express'
import { randomUUID } from 'node:crypto'
import { admin } from '../lib/supabase.js'
import { config } from '../lib/config.js'
import { HttpError, must, mustRow, notConfigured } from '../lib/errors.js'
import { requireAuth } from '../lib/auth.js'
import { toBooking, toEvent } from '../lib/mappers.js'
import { checkInSchema, reviewSchema, uploadSchema } from '../lib/validate.js'
import { EVENT_DEFAULT, HACKATHON_DEFAULT, cleanFormSchema } from '../lib/forms.js'
import { broadcast, formFor } from './bookings.js'

const router = Router()

router.use((req, res, next) => {
  if (!admin) throw notConfigured()
  next()
})
router.use(requireAuth, (req, res, next) => {
  if (req.user.role !== 'organizer' && !req.user.isAdmin) throw new HttpError(403, 'auth/forbidden', 'Only approved hosts can do that.')
  next()
})

// GET /api/admin/bookings: attendees for events this organizer created
router.get('/bookings', async (req, res) => {
  const rows = must(
    await admin
      .from('bookings')
      .select('*, events!inner(created_by)')
      .eq('events.created_by', req.user.id)
      .order('booked_at', { ascending: false }),
  )
  res.set('Cache-Control', 'no-store').json({ bookings: rows.map(toBooking) })
})

// POST /api/admin/uploads  { dataUrl }: stores an event image in Supabase Storage
const MAX_BYTES = 2 * 1024 * 1024
router.post('/uploads', async (req, res) => {
  const { dataUrl } = uploadSchema.parse(req.body)
  const [, mime, b64] = dataUrl.match(/^data:(image\/[a-z]+);base64,(.+)$/)
  const buf = Buffer.from(b64, 'base64')
  if (buf.length > MAX_BYTES) throw new HttpError(413, 'too_large', 'Image must be under 2 MB after resizing.')

  const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg'
  const path = `${req.user.id}/${randomUUID()}.${ext}`
  const bucket = admin.storage.from(config.imageBucket)

  let { error } = await bucket.upload(path, buf, { contentType: mime, cacheControl: '31536000', upsert: false })
  if (error && /not found|bucket/i.test(error.message)) {
    // First upload on a fresh project: create the public bucket, then retry.
    await admin.storage.createBucket(config.imageBucket, { public: true, fileSizeLimit: MAX_BYTES })
    ;({ error } = await bucket.upload(path, buf, { contentType: mime, cacheControl: '31536000', upsert: false }))
  }
  if (error) throw new HttpError(500, 'upload_failed', 'Could not store the image.', error.message)

  res.status(201).json({ url: bucket.getPublicUrl(path).data.publicUrl })
})

// ---------- booking review (host side) ----------
async function ownedBooking(id, user) {
  const b = must(await admin.from('bookings').select('*').eq('id', id).maybeSingle())
  if (!b || !b.event_id) throw new HttpError(404, 'booking/missing', 'Booking not found.')
  const ev = must(await admin.from('events').select('*').eq('id', b.event_id).maybeSingle())
  if (!ev || (ev.created_by !== user.id && !user.isAdmin)) throw new HttpError(404, 'booking/missing', 'Booking not found.')
  return { b, ev }
}

// POST /api/admin/bookings/:id/approve|reject|remove  { note? }
router.post('/bookings/:id/:action', async (req, res) => {
  const map = { approve: 'approve', reject: 'reject', remove: 'remove' }
  const decision = map[req.params.action]
  if (!decision) throw new HttpError(404, 'not_found', 'Unknown action.')
  const { note } = reviewSchema.parse(req.body || {})
  const row = mustRow(await admin.rpc('review_booking', { p_host: req.user.id, p_booking: req.params.id, p_decision: decision, p_note: note }))
  const ev = row.event_id ? must(await admin.from('events').select('*').eq('id', row.event_id).maybeSingle()) : null
  const booking = toBooking(row)
  const event = ev ? toEvent(ev) : null
  res.json({ booking, event })
  broadcast(booking, event)
})

// GET /api/admin/bookings/:id/answers: the applicant's form answers (+ private file links)
router.get('/bookings/:id/answers', async (req, res) => {
  const { b, ev } = await ownedBooking(req.params.id, req.user)
  const form = await formFor(ev)
  const rows = must(await admin.from('booking_answers').select('question_id, answer, form_version').eq('booking_id', b.id))
  const answers = {}
  for (const r of rows) {
    let value = r.answer
    if (value && typeof value === 'object' && !Array.isArray(value) && value.path) {
      const { data } = await admin.storage.from('application-files').createSignedUrl(value.path, 600)
      value = { ...value, url: data?.signedUrl || null }
    }
    answers[r.question_id] = value
  }
  const profile = must(
    await admin.from('profiles').select('username, avatar_url, college, company, skills, github_url, linkedin_url, portfolio_url, city').eq('id', b.user_id).maybeSingle(),
  )
  res.set('Cache-Control', 'no-store').json({ questions: form.questions, answers, profile })
})

// ---------- check-in ----------
// POST /api/admin/checkin  { eventId, code }: code = scanned QR payload or manual code
router.post('/checkin', async (req, res) => {
  const { eventId, code } = checkInSchema.parse(req.body)
  const result = must(await admin.rpc('check_in', { p_host: req.user.id, p_event: eventId, p_code: code }))
  res.json({ result })
  const row = must(await admin.from('bookings').select('*').eq('id', result.bookingDbId).maybeSingle())
  const ev = must(await admin.from('events').select('*').eq('id', eventId).maybeSingle())
  if (row && ev) broadcast(toBooking(row), toEvent(ev))
})

// GET /api/admin/events/:id/attendance: who has checked in, newest first
router.get('/events/:id/attendance', async (req, res) => {
  const ev = must(await admin.from('events').select('id, created_by').eq('id', req.params.id).maybeSingle())
  if (!ev || (ev.created_by !== req.user.id && !req.user.isAdmin)) throw new HttpError(404, 'event/missing', 'Event not found.')
  const rows = must(
    await admin
      .from('attendance')
      .select('checked_in_at, booking:bookings(id, booking_id, attendee_name, seats)')
      .eq('event_id', ev.id)
      .order('checked_in_at', { ascending: false }),
  )
  res.set('Cache-Control', 'no-store').json({
    attendance: rows.map((r) => ({ checkedInAt: r.checked_in_at, bookingDbId: r.booking?.id, bookingId: r.booking?.booking_id, attendeeName: r.booking?.attendee_name, seats: r.booking?.seats })),
  })
})

// ---------- application form builder ----------
async function ownedEvent(id, user) {
  const ev = must(await admin.from('events').select('*').eq('id', id).maybeSingle())
  if (!ev || (ev.created_by !== user.id && !user.isAdmin)) throw new HttpError(404, 'event/missing', 'Event not found.')
  return ev
}

router.get('/events/:id/form', async (req, res) => {
  const ev = await ownedEvent(req.params.id, req.user)
  res.set('Cache-Control', 'no-store').json({ form: await formFor(ev), defaults: { hackathon: HACKATHON_DEFAULT, event: EVENT_DEFAULT } })
})

// PUT /api/admin/events/:id/form  { questions }: saves a new version
router.put('/events/:id/form', async (req, res) => {
  const ev = await ownedEvent(req.params.id, req.user)
  const schema = cleanFormSchema(req.body)
  const current = must(await admin.from('event_forms').select('version').eq('event_id', ev.id).maybeSingle())
  const version = (current?.version || 0) + 1
  must(await admin.from('event_forms').upsert({ event_id: ev.id, version, schema, updated_at: new Date().toISOString() }))
  res.json({ form: { version, isDefault: false, questions: schema.questions } })
})

export default router
