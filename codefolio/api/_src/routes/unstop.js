// /api/unstop — external Unstop listings (discovery only; registration happens on Unstop).
//   GET  /events        search + filters + pagination   (public, like /api/live/*)
//   GET  /events/:id    one listing
//   GET  /status        provider / cache / last sync    (platform admins)
//   POST /sync          refresh now                     (platform admins)
import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { z } from 'zod'
import { HttpError } from '../lib/errors.js'
import { requireAuth } from '../lib/auth.js'
import { EVENT_TYPES } from '../lib/external/normalize.js'
import { queryItems, toPublic } from '../lib/external/catalog.js'

const UNAVAILABLE = 'Unable to load external events right now. Please try again later.'

const listSchema = z.object({
  q: z.string().trim().max(100, 'Search is limited to 100 characters.').default(''),
  page: z.coerce.number().int('page must be a whole number').min(1).max(1000).default(1),
  limit: z.coerce.number().int('limit must be a whole number').min(1).max(100).default(20),
  category: z.enum(['all', ...EVENT_TYPES]).default('all'),
  mode: z.enum(['all', 'online', 'offline', 'hybrid']).default('all'),
  location: z.string().trim().max(60).default(''),
  status: z.enum(['open', 'closing_soon', 'upcoming', 'closed', 'all']).default('open'),
  sort: z.enum(['deadline', 'start', 'recent', 'title']).default('deadline'),
})

export function createUnstopRouter(catalog) {
  const router = Router()
  // Protects this server (the provider is already shielded by the cache).
  router.use(
    rateLimit({
      windowMs: 60_000,
      limit: 120,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      message: { error: { code: 'rate_limited', message: 'Too many requests. Please slow down.' } },
    }),
  )

  const snapshotOr503 = async () => {
    try {
      return await catalog.snapshot()
    } catch (e) {
      throw new HttpError(503, 'upstream_unavailable', UNAVAILABLE, e.message)
    }
  }
  const sourceMeta = (snap) => ({
    name: catalog.provider.name,
    label: catalog.provider.label,
    configured: snap.configured,
    mock: catalog.provider.mock,
    updatedAt: snap.updatedAt ? new Date(snap.updatedAt).toISOString() : null,
    stale: snap.stale,
  })

  router.get('/events', async (req, res) => {
    const p = listSchema.parse(req.query)
    const snap = await snapshotOr503()
    const { items, total, hasMore } = queryItems(snap.items, p)
    res.set('Cache-Control', 'public, max-age=60')
    if (snap.stale) res.set('Warning', '110 - "Response is stale"')
    res.json({ items: items.map(toPublic), page: p.page, limit: p.limit, total, hasMore, source: sourceMeta(snap) })
  })

  router.get('/events/:id', async (req, res) => {
    if (!/^[a-z]{2}-[0-9a-f]{16}$/.test(req.params.id)) throw new HttpError(400, 'bad_id', 'Invalid event id.')
    const snap = await snapshotOr503()
    const item = snap.items.find((i) => i.id === req.params.id)
    if (!item) throw new HttpError(404, 'not_found', 'This listing is no longer available.')
    const [withStatus] = queryItems([item], { page: 1, limit: 1, status: 'all', sort: 'deadline' }).items
    res.set('Cache-Control', 'public, max-age=60').json({ event: toPublic(withStatus), source: sourceMeta(snap) })
  })

  const adminOnly = [
    requireAuth,
    (req, res, next) => {
      if (!req.user.isAdmin) throw new HttpError(403, 'auth/forbidden', 'Only platform admins can do that.')
      next()
    },
  ]

  router.get('/status', ...adminOnly, async (req, res) => {
    res.set('Cache-Control', 'no-store').json({ status: await catalog.status() })
  })

  router.post('/sync', ...adminOnly, async (req, res) => {
    if (!catalog.provider.configured) throw new HttpError(409, 'not_configured', catalog.provider.describe().note)
    try {
      const run = await catalog.sync({ force: true })
      res.json({ run, status: await catalog.status() })
    } catch (e) {
      const code = e.kind === 'rate_limited' ? 429 : 502
      throw new HttpError(code, `sync/${e.kind || 'failed'}`, `Sync failed: ${e.message}`)
    }
  })

  return router
}
