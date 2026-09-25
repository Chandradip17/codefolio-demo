import { Router } from 'express'
import { admin } from '../lib/supabase.js'
import { HttpError, must, notConfigured } from '../lib/errors.js'
import { bearer, requireAuth, requireRole, resolveUser } from '../lib/auth.js'
import { eventColumns, toBooking, toEvent } from '../lib/mappers.js'
import { publish } from '../lib/realtime.js'
import { eventSchema, newEventSchema } from '../lib/validate.js'
import { eventFormHandler } from './hosting.js'

const router = Router()

router.use((req, res, next) => {
  if (!admin) throw notConfigured()
  next()
})

const organizerOnly = [requireAuth, requireRole('organizer')]

// Drafts are visible only to their host: find out who's asking (optional auth).
async function viewerId(req) {
  const token = bearer(req)
  if (!token) return null
  try {
    return (await resolveUser(token)).id
  } catch {
    return null
  }
}
const visibleTo = (row, uid) => row.status !== 'Draft' || row.created_by === uid

// Everyone hears about published events; a draft only reaches its host.
function announce(event) {
  const { payment, ...pub } = event // UPI details go only to the host (in the HTTP response)
  void payment
  if (pub.status === 'Draft') publish('event.updated', { event: pub }, [pub.createdBy])
  else publish('event.updated', { event: pub })
}

async function loadOwned(id, user) {
  const row = must(await admin.from('events').select('*').eq('id', id).maybeSingle())
  if (!row) throw new HttpError(404, 'event/missing', 'Event not found.')
  if (row.created_by !== user.id) throw new HttpError(403, 'auth/forbidden', 'You can only manage events you created.')
  return row
}

// GET /api/events: all Codefolio-hosted events (public) + the caller's own drafts
router.get('/', async (req, res) => {
  const [rows, uid] = await Promise.all([must(await admin.from('events').select('*').order('date').order('start_time')), viewerId(req)])
  res.set('Cache-Control', 'no-store').json({
    events: rows.filter((r) => visibleTo(r, uid)).map((r) => toEvent(r, { withPayment: Boolean(uid) && r.created_by === uid })),
  })
})

// GET /api/events/:id/form: the application form applicants fill in (members only)
router.get('/:id/form', requireAuth, eventFormHandler)

// GET /api/events/:id
router.get('/:id', async (req, res) => {
  const row = must(await admin.from('events').select('*').eq('id', req.params.id).maybeSingle())
  const uid = await viewerId(req)
  if (!row || !visibleTo(row, uid)) throw new HttpError(404, 'event/missing', 'Event not found.')
  res.json({ event: toEvent(row, { withPayment: Boolean(uid) && row.created_by === uid }) })
})

// POST /api/events (organizer)
router.post('/', ...organizerOnly, async (req, res) => {
  const input = newEventSchema.parse(req.body)
  const row = must(
    await admin
      .from('events')
      .insert({
        ...eventColumns(input),
        capacity: input.capacity,
        available_seats: input.capacity,
        is_sample: false,
        organizer_name: req.user.name,
        organizer_email: req.user.email,
        created_by: req.user.id,
      })
      .select('*')
      .single(),
  )
  const event = toEvent(row, { withPayment: true })
  res.status(201).json({ event })
  announce(event)
})

// PUT /api/events/:id (organizer, owner)
router.put('/:id', ...organizerOnly, async (req, res) => {
  const input = eventSchema.parse(req.body)
  const current = await loadOwned(req.params.id, req.user)
  const cols = eventColumns(input)
  // Cancelling has its own action; editing never brings a cancelled event back.
  if (current.status === 'Cancelled') cols.status = 'Cancelled'
  else if (cols.status === 'Draft' && current.status !== 'Draft') {
    const { count } = await admin.from('bookings').select('id', { head: true, count: 'exact' }).eq('event_id', current.id).in('status', ['Pending', 'Confirmed', 'Attended'])
    if (count) throw new HttpError(409, 'event/has_bookings', 'People have already applied, so this event can’t go back to draft. Cancel it instead.')
  }
  // Capacity goes through a locked SQL function so booked seats are preserved.
  if (input.capacity !== current.capacity) {
    must(await admin.rpc('set_event_capacity', { p_event: current.id, p_capacity: input.capacity }))
  }
  const row = must(await admin.from('events').update(cols).eq('id', current.id).select('*').single())
  const event = toEvent(row, { withPayment: true })
  res.json({ event })
  announce(event)
  // Published → draft: other viewers should drop it from their lists.
  if (event.status === 'Draft' && current.status !== 'Draft') publish('event.deleted', { id: event.id, createdBy: event.createdBy, draft: true })
})

// POST /api/events/:id/cancel (organizer, owner): stops new bookings
router.post('/:id/cancel', ...organizerOnly, async (req, res) => {
  const current = await loadOwned(req.params.id, req.user)
  if (current.status === 'Draft') throw new HttpError(409, 'event/draft', 'Drafts aren’t public yet. Delete the draft instead of cancelling it.')
  const row = must(await admin.from('events').update({ status: 'Cancelled' }).eq('id', current.id).select('*').single())
  const event = toEvent(row, { withPayment: true })
  res.json({ event })
  announce(event)
})

// DELETE /api/events/:id (organizer, owner): permanent; active bookings become Cancelled
router.delete('/:id', ...organizerOnly, async (req, res) => {
  const current = await loadOwned(req.params.id, req.user)
  const affected = must(await admin.from('bookings').select('*').eq('event_id', current.id).eq('status', 'Confirmed'))
  must(await admin.rpc('delete_event', { p_event: current.id }))
  res.status(204).end()
  publish('event.deleted', { id: current.id })
  for (const row of affected) {
    const booking = { ...toBooking(row), status: 'Cancelled', eventId: null }
    publish('booking.updated', { booking }, [booking.userId, current.created_by])
  }
})

export default router
