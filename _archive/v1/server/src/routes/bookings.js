import { Router } from 'express'
import { admin } from '../lib/supabase.js'
import { must, mustRow, notConfigured } from '../lib/errors.js'
import { requireAuth, requireRole } from '../lib/auth.js'
import { toBooking, toEvent } from '../lib/mappers.js'
import { bookingSchema } from '../lib/validate.js'
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

// Live updates: new seat count for everyone; the booking only for the
// attendee (their other devices) and the event's organizer.
function broadcast(booking, event) {
  if (event) publish('event.updated', { event })
  publish('booking.updated', { booking }, [booking.userId, event?.createdBy])
}

// GET /api/bookings/me: the signed-in attendee's bookings
router.get('/me', async (req, res) => {
  const rows = must(await admin.from('bookings').select('*').eq('user_id', req.user.id).order('booked_at', { ascending: false }))
  res.set('Cache-Control', 'no-store').json({ bookings: rows.map(toBooking) })
})

// POST /api/bookings  { eventId, seats }: atomic seat booking (see book_seats in schema.sql)
router.post('/', requireRole('attendee'), async (req, res) => {
  const { eventId, seats } = bookingSchema.parse(req.body)
  const row = mustRow(await admin.rpc('book_seats', { p_user: req.user.id, p_event: eventId, p_seats: seats }))
  const ev = await eventRow(eventId)
  const booking = toBooking(row)
  const event = ev ? toEvent(ev) : null
  res.status(201).json({ booking, event })
  broadcast(booking, event)
})

// POST /api/bookings/:id/cancel: releases the seats
router.post('/:id/cancel', async (req, res) => {
  const row = mustRow(await admin.rpc('cancel_booking', { p_user: req.user.id, p_booking: req.params.id }))
  const ev = await eventRow(row.event_id)
  const booking = toBooking(row)
  const event = ev ? toEvent(ev) : null
  res.json({ booking, event })
  broadcast(booking, event)
})

export default router
