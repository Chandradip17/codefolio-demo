import { Router } from 'express'
import { randomUUID } from 'node:crypto'
import { admin } from '../lib/supabase.js'
import { config } from '../lib/config.js'
import { HttpError, must, notConfigured } from '../lib/errors.js'
import { requireAuth, requireRole } from '../lib/auth.js'
import { toBooking } from '../lib/mappers.js'
import { uploadSchema } from '../lib/validate.js'

const router = Router()

router.use((req, res, next) => {
  if (!admin) throw notConfigured()
  next()
})
router.use(requireAuth, requireRole('organizer'))

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

export default router
