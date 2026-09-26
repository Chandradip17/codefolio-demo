// Realtime fan-out for the dashboard.
//
// Browsers hold a Server-Sent Events stream open to GET /api/stream. When the
// API changes an event or booking it calls publish(), which:
//   1. delivers to this instance's connected browsers immediately, and
//   2. relays over a Supabase Realtime *broadcast* channel so other API
//      instances (horizontal scaling) deliver it to their browsers too.
// Relayed messages are HMAC-signed with the service-role key, so anyone who
// knows the channel name and the public anon key can't inject fake updates.
//
// Audience: messages without `to` are public (event details, seat counts).
// Messages with `to: [userId…]` go only to those users (bookings, which
// include attendee names/emails).
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { admin } from './supabase.js'
import { config } from './config.js'

const INSTANCE = randomUUID()
const HEARTBEAT_MS = 25_000
const MAX_CLIENTS = 2000

const clients = new Map() // id → { res, userId }
let channel = null
let relay = 'local' // 'local' | 'connecting' | 'supabase'

const sign = (msg) =>
  createHmac('sha256', config.supabaseServiceKey).update(JSON.stringify([msg.id, msg.type, msg.to || null, msg.data])).digest('base64url')

function verify(msg) {
  if (!msg?.sig) return false
  const a = Buffer.from(sign(msg))
  const b = Buffer.from(String(msg.sig))
  return a.length === b.length && timingSafeEqual(a, b)
}

function send(res, type, data, id) {
  res.write(`${id ? `id: ${id}\n` : ''}event: ${type}\ndata: ${JSON.stringify(data)}\n\n`)
}

function deliver(msg) {
  for (const c of clients.values()) {
    if (msg.to && !(c.userId && msg.to.includes(c.userId))) continue
    try {
      send(c.res, msg.type, msg.data, msg.id)
    } catch {
      /* socket already gone; the close handler cleans up */
    }
  }
}

export function publish(type, data, to) {
  const msg = { id: randomUUID(), type, data, to: to?.filter(Boolean) || null, at: Date.now() }
  if (msg.to && !msg.to.length) return
  deliver(msg)
  if (relay === 'supabase') {
    channel
      .send({ type: 'broadcast', event: 'change', payload: { ...msg, from: INSTANCE, sig: sign(msg) } })
      .catch((e) => console.warn('[realtime] relay failed:', e.message))
  }
}

export function addClient(res, user) {
  if (clients.size >= MAX_CLIENTS) return null
  const id = randomUUID()
  clients.set(id, { res, userId: user?.id || null })
  return () => clients.delete(id)
}

export const realtimeStatus = () => ({ clients: clients.size, relay })

// Keep proxies/load balancers from closing idle streams.
setInterval(() => {
  for (const c of clients.values()) {
    try {
      c.res.write(`: ping ${Date.now()}\n\n`)
    } catch {
      /* ignore */
    }
  }
}, HEARTBEAT_MS).unref()

// Cross-instance relay via Supabase Realtime broadcast (no SQL setup needed).
export function startRelay() {
  if (!admin || channel) return
  relay = 'connecting'
  channel = admin.channel('codefolio-live', { config: { broadcast: { self: false, ack: false } } })
  channel
    .on('broadcast', { event: 'change' }, ({ payload }) => {
      if (!payload || payload.from === INSTANCE) return
      if (!verify(payload)) return console.warn('[realtime] dropped unsigned relay message')
      deliver(payload)
    })
    .subscribe((status, err) => {
      if (status === 'SUBSCRIBED') {
        relay = 'supabase'
        console.log('[realtime] Supabase broadcast relay connected')
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        // Local delivery keeps working; supabase-js retries the channel itself.
        if (relay !== 'local') console.warn(`[realtime] relay ${status.toLowerCase()}${err ? `: ${err.message}` : ''}; local delivery only`)
        relay = 'local'
      }
    })
}
