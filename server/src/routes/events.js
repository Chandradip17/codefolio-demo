import { Router } from 'express'
import { admin } from '../lib/supabase.js'
import { HttpError, must, notConfigured } from '../lib/errors.js'
import { requireAuth, requireRole } from '../lib/auth.js'
import { eventColumns, toEvent } from '../lib/mappers.js'
import { eventSchema, newEventSchema } from '../lib/validate.js'

const router = Router()

router.use((req, res, next) => {
  if (!admin) throw notConfigured()
  next()
})

const organizerOnly = [requireAuth, requireRole('organizer')]

async function loadOwned(id, user) {
  const row = must(await admin.from('events').select('*').eq('id', id).maybeSingle())
  if (!row) throw new HttpError(404, 'event/missing', 'Event not found.')
  if (row.created_by !== user.id) throw new HttpError(403, 'auth/forbidden', 'You can only manage events you created.')
  return row
}

// GET /api/events: all Codefolio-hosted events (public)
router.get('/', async (req, res) => {
  const rows = must(await admin.from('events').select('*').order('date').order('start_time'))
  res.set('Cache-Control', 'no-store').json({ events: rows.map(toEvent) })
})

// GET /api/events/:id
router.get('/:id', async (req, res) => {
  const row = must(await admin.from('events').select('*').eq('id', req.params.id).maybeSingle())
  if (!row) throw new HttpError(404, 'event/missing', 'Event not found.')
  res.json({ event: toEvent(row) })
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
  res.status(201).json({ event: toEvent(row) })
})

// PUT /api/events/:id (organizer, owner)
router.put('/:id', ...organizerOnly, async (req, res) => {
  const input = eventSchema.parse(req.body)
  const current = await loadOwned(req.params.id, req.user)
  // Capacity goes through a locked SQL function so booked seats are preserved.
  if (input.capacity !== current.capacity) {
    must(await admin.rpc('set_event_capacity', { p_event: current.id, p_capacity: input.capacity }))
  }
  const row = must(await admin.from('events').update(eventColumns(input)).eq('id', current.id).select('*').single())
  res.json({ event: toEvent(row) })
})

// POST /api/events/:id/cancel (organizer, owner): stops new bookings
router.post('/:id/cancel', ...organizerOnly, async (req, res) => {
  const current = await loadOwned(req.params.id, req.user)
  const row = must(await admin.from('events').update({ status: 'Cancelled' }).eq('id', current.id).select('*').single())
  res.json({ event: toEvent(row) })
})

// DELETE /api/events/:id (organizer, owner): permanent; active bookings become Cancelled
router.delete('/:id', ...organizerOnly, async (req, res) => {
  const current = await loadOwned(req.params.id, req.user)
  must(await admin.rpc('delete_event', { p_event: current.id }))
  res.status(204).end()
})

export default router
