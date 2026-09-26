import { Router } from 'express'
import { admin } from '../lib/supabase.js'
import { HttpError, must, mustRow, notConfigured } from '../lib/errors.js'
import { requireAuth } from '../lib/auth.js'
import { TEAM_SELECT, toBooking, toEvent, toTeam } from '../lib/mappers.js'
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

// A booking with its team (members + code) embedded.
export async function bookingWithTeam(id) {
  return must(await admin.from('bookings').select(`*, ${TEAM_SELECT}`).eq('id', id).single())
}

// Tell a team's members (and the host) that the roster changed.
export async function announceTeam(teamId, hostId) {
  if (!teamId) return
  const t = must(
    await admin
      .from('teams')
      .select('id, name, code, leader_id, event_id, members:team_members(user_id, joined_at, profile:profiles!team_members_user_id_fkey(name, username))')
      .eq('id', teamId)
      .maybeSingle(),
  )
  if (!t) return // last member left: the team is gone
  const team = toTeam(t)
  publish('team.updated', { team }, [...team.members.map((m) => m.userId), hostId].filter(Boolean))
}

// GET /api/bookings/team-lookup?event=&code=: preview a team before joining it
router.get('/team-lookup', async (req, res) => {
  const code = String(req.query.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (code.length < 4) throw new HttpError(422, 'validation', 'Enter the team code.')
  const t = must(await admin.from('teams').select('id, name, event_id, leader_id, members:team_members(count)').eq('code', code).maybeSingle())
  if (!t) throw new HttpError(404, 'team/not_found', 'No team found with that code. Check it with your team leader.')
  if (t.event_id !== req.query.event) throw new HttpError(409, 'team/wrong_event', 'That team code belongs to a different hackathon.')
  const ev = must(await admin.from('events').select('team_max').eq('id', t.event_id).single())
  const leader = t.leader_id ? must(await admin.from('profiles').select('name').eq('id', t.leader_id).maybeSingle()) : null
  res.set('Cache-Control', 'no-store').json({
    team: { name: t.name, size: t.members?.[0]?.count ?? 0, max: ev.team_max ?? 4, leaderName: leader?.name || null },
  })
})

// GET /api/bookings/me: the signed-in member's bookings (requests + seats)
router.get('/me', async (req, res) => {
  const rows = must(await admin.from('bookings').select(`*, ${TEAM_SELECT}`).eq('user_id', req.user.id).order('booked_at', { ascending: false }))
  res.set('Cache-Control', 'no-store').json({ bookings: rows.map(toBooking) })
})

// POST /api/bookings  { eventId, seats, answers }: creates a PENDING request.
// Seats are only taken when the host approves (review_booking in SQL).
router.post('/', async (req, res) => {
  const { eventId, seats, answers, participation, teamName, teamCode, paymentRef, paymentProof } = bookingSchema.parse(req.body)
  const ev = await eventRow(eventId)
  if (!ev || ev.status === 'Draft') throw new HttpError(404, 'event/missing', 'This event no longer exists.')
  // Say "not open yet / closed" before asking the applicant to fix their answers
  // (request_booking enforces the same rules).
  const now = Date.now()
  if (ev.applications_open_at && now < new Date(ev.applications_open_at).getTime()) {
    const when = new Date(ev.applications_open_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })
    throw new HttpError(409, 'event/not_open', `Applications open on ${when} IST.`)
  }
  if (ev.applications_close_at && now > new Date(ev.applications_close_at).getTime()) {
    throw new HttpError(409, 'event/closed', 'Applications for this event have closed.')
  }
  const form = await formFor(ev)
  const clean = cleanAnswers(form.questions, answers, req.user.id)
  const created = mustRow(
    await admin.rpc('request_booking', {
      p_user: req.user.id,
      p_event: eventId,
      p_seats: seats,
      p_answers: clean,
      p_form_version: form.version,
      p_participation: ev.category === 'hackathon' ? participation || null : null,
      p_team_name: teamName || null,
      p_team_code: teamCode || null,
      p_payment_ref: paymentRef || null,
      p_payment_proof: paymentProof || null,
    }),
  )
  const booking = toBooking(await bookingWithTeam(created.id))
  const event = toEvent(ev)
  res.status(201).json({ booking, event })
  broadcast(booking, event)
  announceTeam(created.team_id, ev.created_by).catch(() => {})
})

// POST /api/bookings/:id/cancel: withdraw a request, or give back a seat
router.post('/:id/cancel', async (req, res) => {
  const row = mustRow(await admin.rpc('cancel_booking', { p_user: req.user.id, p_booking: req.params.id }))
  const ev = await eventRow(row.event_id)
  const booking = toBooking(row)
  const event = ev ? toEvent(ev) : null
  res.json({ booking, event })
  broadcast(booking, event)
  announceTeam(row.team_id, ev?.created_by).catch(() => {})
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
