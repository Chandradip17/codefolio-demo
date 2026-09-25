import { Router } from 'express'
import { bearer, resolveUser } from '../lib/auth.js'
import { admin } from '../lib/supabase.js'
import { HttpError } from '../lib/errors.js'
import { addClient, realtimeStatus } from '../lib/realtime.js'

const router = Router()

// Seconds until a JWT expires (already verified by resolveUser; this only reads `exp`).
function secondsLeft(token) {
  try {
    const { exp } = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString())
    return exp - Date.now() / 1000
  } catch {
    return 3600
  }
}

// GET /api/stream: Server-Sent Events. Anonymous clients get public updates;
// signed-in clients (Authorization: Bearer …) also get their own bookings.
router.get('/', async (req, res) => {
  const token = bearer(req)
  let user = null
  if (token) {
    if (!admin) throw new HttpError(503, 'supabase_not_configured', "Supabase isn't configured.")
    user = await resolveUser(token) // 401 → the client refreshes its token and reconnects
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // disable nginx buffering
  })
  res.flushHeaders()
  req.socket.setNoDelay(true)

  const remove = addClient(res, user)
  if (!remove) {
    res.write(`event: busy\ndata: {}\n\n`)
    return res.end()
  }
  res.write('retry: 3000\n\n')
  res.write(`event: hello\ndata: ${JSON.stringify({ userId: user?.id || null, serverTime: Date.now(), ...realtimeStatus() })}\n\n`)

  // End the stream when the access token expires so the client reconnects
  // with a fresh one (and we never keep serving a revoked session).
  const expiry = token ? setTimeout(() => res.end(), Math.max(5, secondsLeft(token) - 5) * 1000) : null

  req.on('close', () => {
    clearTimeout(expiry)
    remove()
  })
})

export default router
