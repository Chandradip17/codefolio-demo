// Client for GET /api/stream (Server-Sent Events).
// Uses fetch + ReadableStream instead of EventSource so it can send the
// Authorization header, and reconnects with backoff on its own.
import { BASE, getAccessToken } from './api'

const MIN_DELAY = 1000
const MAX_DELAY = 30000

export function connectStream({ authed, onMessage, onStatus }) {
  let stopped = false
  let controller = null
  let delay = MIN_DELAY
  let timer = null
  let forceRefresh = false
  let everConnected = false
  let gen = 0 // bumps on manual reconnect so an aborted attempt doesn't also reschedule

  const status = (s, extra) => !stopped && onStatus?.(s, extra)

  async function run() {
    if (stopped) return
    const my = gen
    status(everConnected ? 'reconnecting' : 'connecting')
    controller = new AbortController()
    let opened = false
    try {
      const token = authed ? await getAccessToken({ forceRefresh }) : null
      forceRefresh = false
      const res = await fetch(`${BASE}/stream`, {
        headers: { Accept: 'text/event-stream', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        signal: controller.signal,
        cache: 'no-store',
      })
      if (res.status === 401) {
        forceRefresh = true // expired token: refresh, then reconnect
        throw new Error('unauthorized')
      }
      if (!res.ok || !res.body) throw new Error(`stream ${res.status}`)

      opened = true
      const reconnected = everConnected
      everConnected = true
      delay = MIN_DELAY
      status('live', { reconnected })

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n')
        let i
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i)
          buf = buf.slice(i + 2)
          let type = 'message'
          let data = ''
          for (const line of block.split('\n')) {
            if (line.startsWith('event:')) type = line.slice(6).trim()
            else if (line.startsWith('data:')) data += line.slice(5).trim()
          }
          if (!data) continue // comments / heartbeats
          try {
            onMessage(type, JSON.parse(data))
          } catch (e) {
            console.warn('[stream] bad message', type, e)
          }
        }
      }
    } catch {
      /* network error, abort, or 401: fall through to reconnect */
    }
    if (stopped || my !== gen) return
    // Server ended the stream (e.g. token expiry) → reconnect quickly; errors back off.
    const wait = opened ? MIN_DELAY : delay
    if (!opened) delay = Math.min(delay * 2, MAX_DELAY)
    status(navigator.onLine === false ? 'offline' : 'reconnecting', { retryIn: wait })
    timer = setTimeout(run, wait)
  }

  const reconnectNow = () => {
    if (stopped) return
    gen++
    clearTimeout(timer)
    controller?.abort()
    delay = MIN_DELAY
    timer = setTimeout(run, 0)
  }
  const onOffline = () => status('offline')
  window.addEventListener('online', reconnectNow)
  window.addEventListener('offline', onOffline)

  run()

  return {
    close() {
      stopped = true
      clearTimeout(timer)
      controller?.abort()
      window.removeEventListener('online', reconnectNow)
      window.removeEventListener('offline', onOffline)
    },
    reconnectNow,
  }
}
