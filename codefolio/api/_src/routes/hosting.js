// Host access: members request it, platform admins review it.
import { Router } from 'express'
import { randomUUID } from 'node:crypto'
import { admin } from '../lib/supabase.js'
import { HttpError, must, mustRow, notConfigured } from '../lib/errors.js'
import { clearUserCache, requireAuth } from '../lib/auth.js'
import { fileUploadSchema, hostRequestSchema, reviewSchema } from '../lib/validate.js'
import { formFor } from './bookings.js'
import { publish } from '../lib/realtime.js'

const toRequest = (r, p) => ({
  id: r.id,
  type: r.requested_type,
  organization: r.organization,
  city: r.city,
  reason: r.reason,
  status: r.status,
  reviewNote: r.review_note,
  reviewedAt: r.reviewed_at,
  createdAt: r.created_at,
  ...(p ? { applicant: { id: p.id, name: p.name, email: p.email, username: p.username, avatarUrl: p.avatar_url, role: p.role } } : {}),
})

// ---------- member side: /api/host-requests ----------
export const memberRouter = Router()
memberRouter.use((req, res, next) => {
  if (!admin) throw notConfigured()
  next()
})
memberRouter.use(requireAuth)

memberRouter.get('/me', async (req, res) => {
  const rows = must(await admin.from('host_requests').select('*').eq('user_id', req.user.id).order('created_at', { ascending: false }).limit(5))
  res.set('Cache-Control', 'no-store').json({ requests: rows.map((r) => toRequest(r)), isHost: req.user.role === 'organizer' })
})

memberRouter.post('/', async (req, res) => {
  const input = hostRequestSchema.parse(req.body)
  const row = mustRow(
    await admin.rpc('request_host', { p_user: req.user.id, p_type: input.type, p_org: input.organization, p_city: input.city, p_reason: input.reason }),
  )
  res.status(201).json({ request: toRequest(row) })
})

// ---------- platform admin side: /api/platform ----------
export const platformRouter = Router()
platformRouter.use((req, res, next) => {
  if (!admin) throw notConfigured()
  next()
})
platformRouter.use(requireAuth, (req, res, next) => {
  if (!req.user.isAdmin) throw new HttpError(403, 'auth/forbidden', 'Only platform admins can do that.')
  next()
})

// GET /api/platform/host-requests?status=pending|approved|rejected|all
platformRouter.get('/host-requests', async (req, res) => {
  const status = ['pending', 'approved', 'rejected'].includes(req.query.status) ? req.query.status : null
  let q = admin.from('host_requests').select('*, profile:profiles!host_requests_user_id_fkey(id, name, email, username, avatar_url, role)').order('created_at', { ascending: false }).limit(200)
  if (status) q = q.eq('status', status)
  const rows = must(await q)
  const counts = must(await admin.from('host_requests').select('status'))
  const tally = { pending: 0, approved: 0, rejected: 0 }
  for (const r of counts) tally[r.status]++
  res.set('Cache-Control', 'no-store').json({ requests: rows.map((r) => toRequest(r, r.profile)), counts: tally })
})

// POST /api/platform/host-requests/:id/approve|reject  { note? }
platformRouter.post('/host-requests/:id/:action', async (req, res) => {
  const decision = { approve: 'approved', reject: 'rejected' }[req.params.action]
  if (!decision) throw new HttpError(404, 'not_found', 'Unknown action.')
  const { note } = reviewSchema.parse(req.body || {})
  const row = mustRow(await admin.rpc('review_host_request', { p_admin: req.user.id, p_request: req.params.id, p_decision: decision, p_note: note }))
  clearUserCache()
  const p = must(await admin.from('profiles').select('id, name, email, username, avatar_url, role').eq('id', row.user_id).maybeSingle())
  const request = toRequest(row, p)
  res.json({ request })
  // Tell the applicant right away (their open tabs refresh their role).
  publish('host.request.updated', { request: toRequest(row) }, [row.user_id])
})

// GET /api/platform/overview: platform-wide counts for the admin overview
platformRouter.get('/overview', async (req, res) => {
  const c = async (table, match) => (await admin.from(table).select('id', { head: true, count: 'exact' }).match(match || {})).count ?? 0
  res.set('Cache-Control', 'no-store').json({
    users: await c('profiles'),
    hosts: await c('profiles', { role: 'organizer' }),
    pendingHostRequests: await c('host_requests', { status: 'pending' }),
    events: await c('events'),
    pendingBookings: await c('bookings', { status: 'Pending' }),
    attendance: await c('attendance'),
  })
})

// ---------- application file uploads (private bucket) ----------
export const uploadRouter = Router()
uploadRouter.use((req, res, next) => {
  if (!admin) throw notConfigured()
  next()
})
uploadRouter.use(requireAuth)
const MAX_FILE = 5 * 1024 * 1024
const EXT = { 'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/webp': 'webp', 'application/zip': 'zip', 'text/plain': 'txt' }

// POST /api/uploads/application-file  { name, dataUrl } → { path, name, size, type }
uploadRouter.post('/application-file', async (req, res) => {
  const { name, dataUrl } = fileUploadSchema.parse(req.body)
  const [, mime, b64] = dataUrl.match(/^data:([^;]+);base64,(.+)$/)
  const buf = Buffer.from(b64, 'base64')
  if (buf.length > MAX_FILE) throw new HttpError(413, 'too_large', 'Files must be under 5 MB.')
  const path = `${req.user.id}/${randomUUID()}.${EXT[mime] || 'bin'}`
  const { error } = await admin.storage.from('application-files').upload(path, buf, { contentType: mime, upsert: false })
  if (error) throw new HttpError(500, 'upload_failed', 'Could not store the file.', error.message)
  res.status(201).json({ file: { path, name: name.slice(0, 200), size: buf.length, type: mime } })
})

// ---------- event form for applicants: GET /api/events/:id/form ----------
export async function eventFormHandler(req, res) {
  const ev = must(await admin.from('events').select('*').eq('id', req.params.id).maybeSingle())
  if (!ev || ev.status === 'Draft') throw new HttpError(404, 'event/missing', 'Event not found.')
  const fee = ev.application_fee || 0
  res.set('Cache-Control', 'no-store').json({
    form: await formFor(ev),
    // Where to pay (members only; not in the public event list).
    payment: fee > 0 ? { fee, upiId: ev.upi_id, upiNumber: ev.upi_number, qrUrl: ev.upi_qr_url } : null,
  })
}

