import { Router } from 'express'
import { admin } from '../lib/supabase.js'
import { HttpError, must, mustRow, notConfigured } from '../lib/errors.js'
import { requireAuth } from '../lib/auth.js'
import { toBooking, toEvent } from '../lib/mappers.js'
import { bookingSchema } from '../lib/validate.js'
import { cleanAnswers, defaultForm } from '../lib/forms.js'
import { publish } from '../lib/realtime.js'

const router = Router()

router.use((req, res, next) => {
  if (!admin) throw notConfigured()
  next()
})
router.use(requireAuth)

async function eventRow(id) {
  if (!id) return null
  return must(await admin.from('events').select('*').eq('id', id).maybeSingle())
}

export async function formFor(event) {
  const row = must(await admin.from('event_forms').select('version, schema').eq('event_id', event.id).maybeSingle())
  return row ? { version: row.version, isDefault: false, questions: row.schema.questions } : defaultForm(event)
}

// Live updates: seat counts for everyone; the booking only for the attendee
// (their other devices) and the event's host.
export function broadcast(booking, event) {
  if (event) publish('event.updated', { event })
  publish('booking.updated', { booking }, [booking.userId, event?.createdBy])
}

// GET /api/bookings/me: the signed-in member's bookings (requests + seats)
router.get('/me', async (req, res) => {
  const rows = must(await admin.from('bookings').select('*').eq('user_id', req.user.id).order('booked_at', { ascending: false }))
  res.set('Cache-Control', 'no-store').json({ bookings: rows.map(toBooking) })
})

// POST /api/bookings  { eventId, seats, answers }: creates a PENDING request.
// Seats are only taken when the host approves (review_booking in SQL).
router.post('/', async (req, res) => {
  const { eventId, seats, answers } = bookingSchema.parse(req.body)
  const ev = await eventRow(eventId)
  if (!ev) throw new HttpError(404, 'event/missing', 'This event no longer exists.')
  const form = await formFor(ev)
  const clean = cleanAnswers(form.questions, answers, req.user.id)
  const row = mustRow(
    await admin.rpc('request_booking', { p_user: req.user.id, p_event: eventId, p_seats: seats, p_answers: clean, p_form_version: form.version }),
  )
  const booking = toBooking(row)
  const event = toEvent(ev)
  res.status(201).json({ booking, event })
  broadcast(booking, event)
})

// POST /api/bookings/:id/cancel: withdraw a request, or give back a seat
router.post('/:id/cancel', async (req, res) => {
  const row = mustRow(await admin.rpc('cancel_booking', { p_user: req.user.id, p_booking: req.params.id }))
  const ev = await eventRow(row.event_id)
  const booking = toBooking(row)
  const event = ev ? toEvent(ev) : null
  res.json({ booking, event })
  broadcast(booking, event)
})

// GET /api/bookings/:id/credential: the participant's check-in QR (approved only)
router.get('/:id/credential', async (req, res) => {
  const data = must(await admin.rpc('booking_credential', { p_actor: req.user.id, p_booking: req.params.id, p_regenerate: false }))
  res.set('Cache-Control', 'no-store').json({ credential: data })
})

// POST /api/bookings/:id/credential/regenerate: new QR, old one stops working
router.post('/:id/credential/regenerate', async (req, res) => {
  const data = must(await admin.rpc('booking_credential', { p_actor: req.user.id, p_booking: req.params.id, p_regenerate: true }))
  res.json({ credential: data })
})

export default router
