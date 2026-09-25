import express from 'express'
import cors from 'cors'
import { config, supabaseConfigured, missingSupabaseVars } from './lib/config.js'
import { admin } from './lib/supabase.js'
import { errorHandler, HttpError } from './lib/errors.js'
import authRoutes from './routes/auth.js'
import eventRoutes from './routes/events.js'
import bookingRoutes from './routes/bookings.js'
import adminRoutes from './routes/admin.js'
import liveRoutes from './routes/live.js'
import streamRoutes from './routes/stream.js'
import { memberRouter as hostRequestRoutes, platformRouter, uploadRouter } from './routes/hosting.js'
import { realtimeStatus } from './lib/realtime.js'

export function createApp() {
  const app = express()
  app.disable('x-powered-by')
  app.set('trust proxy', 1)

  app.use(
    cors({
      origin: (origin, cb) => cb(null, !origin || config.corsOrigins.includes(origin) || config.corsOrigins.includes('*')),
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      allowedHeaders: ['Content-Type', 'Authorization'],
      maxAge: 600,
    }),
  )
  // Image uploads arrive as base64 data URLs; everything else is small JSON.
  app.use('/api/admin/uploads', express.json({ limit: '3mb' }))
  app.use('/api/uploads', express.json({ limit: '7mb' }))
  app.use(express.json({ limit: '100kb' }))

  app.get('/api/health', async (req, res) => {
    const out = { ok: true, supabase: supabaseConfigured ? 'configured' : `missing ${missingSupabaseVars().join(', ')}`, realtime: realtimeStatus() }
    if (admin) {
      const { error } = await admin.from('events').select('id', { head: true, count: 'exact' })
      out.database = error ? `error: ${error.message}` : 'ok'
      if (error) out.ok = false
    }
    res.status(out.ok ? 200 : 503).json(out)
  })

  app.use('/api/auth', authRoutes)
  app.use('/api/events', eventRoutes)
  app.use('/api/bookings', bookingRoutes)
  app.use('/api/admin', adminRoutes)
  app.use('/api/live', liveRoutes)
  app.use('/api/stream', streamRoutes)
  app.use('/api/host-requests', hostRequestRoutes)
  app.use('/api/platform', platformRouter)
  app.use('/api/uploads', uploadRouter)

  app.use('/api', (req, res, next) => next(new HttpError(404, 'not_found', `No route for ${req.method} ${req.originalUrl}`)))
  app.use(errorHandler)
  return app
}
