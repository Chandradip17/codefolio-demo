// HTTP client for the Codefolio API (server/, Node + Express + Supabase).
// In dev, Vite proxies /api to the server; in production set VITE_API_URL.
export const BASE = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '')
const SESSION_KEY = 'cf_session_v2'

export class ApiError extends Error {
  constructor(message, status = 0, code = 'error', fields) {
    super(message)
    this.status = status
    this.code = code
    this.fields = fields
  }
}

// ---------- session (Supabase access + refresh token, issued by our API) ----------
let session = readSession()
function readSession() {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY))
  } catch {
    return null
  }
}
export function setSession(s) {
  session = s || null
  try {
    if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s))
    else localStorage.removeItem(SESSION_KEY)
  } catch {
    /* storage blocked: session lives in memory only */
  }
}
export const hasSession = () => Boolean(session?.accessToken)

// A valid access token (refreshed if it's about to expire), or null.
export async function getAccessToken({ forceRefresh = false } = {}) {
  if (!session?.accessToken) return null
  if (forceRefresh || (session.expiresAt && session.expiresAt * 1000 - Date.now() < 60_000)) {
    if (!(await refreshSession())) return null
  }
  return session?.accessToken || null
}

let refreshing = null
async function refreshSession() {
  if (!session?.refreshToken) return false
  refreshing ??= fetch(`${BASE}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken: session.refreshToken }),
  })
    .then(async (res) => {
      if (!res.ok) throw new Error('refresh failed')
      setSession((await res.json()).session)
      return true
    })
    .catch(() => {
      setSession(null)
      window.dispatchEvent(new Event('cf:session-expired'))
      return false
    })
    .finally(() => {
      refreshing = null
    })
  return refreshing
}

async function request(path, { method = 'GET', body, auth = true, retry = true } = {}) {
  // Refresh a minute before the access token expires.
  if (auth && session?.expiresAt && session.expiresAt * 1000 - Date.now() < 60_000) await refreshSession()

  let res
  try {
    res = await fetch(BASE + path, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(auth && session?.accessToken ? { Authorization: `Bearer ${session.accessToken}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new ApiError("Can't reach the Codefolio server. Is the API running?", 0, 'network')
  }

  if (res.status === 401 && auth && retry && session?.refreshToken && (await refreshSession())) {
    return request(path, { method, body, auth, retry: false })
  }
  if (res.status === 204) return null

  let data = null
  try {
    data = await res.json()
  } catch {
    /* non-JSON (e.g. proxy error page) */
  }
  if (!res.ok) {
    const err = data?.error
    const fallback = res.status === 502 || res.status === 504 ? "Can't reach the Codefolio server. Is the API running?" : `Request failed (${res.status})`
    throw new ApiError(err?.message || fallback, res.status, err?.code || 'http', err?.fields)
  }
  return data
}

// ---------- auth ----------
export async function login(email, password) {
  const { user, session: s } = await request('/auth/login', { method: 'POST', body: { email, password }, auth: false })
  setSession(s)
  return user
}
export async function signup(input) {
  const { user, session: s } = await request('/auth/signup', { method: 'POST', body: input, auth: false })
  setSession(s)
  return user
}
export async function logout() {
  await request('/auth/logout', { method: 'POST' }).catch(() => {})
  setSession(null)
}
export const forgotPassword = (email) => request('/auth/forgot', { method: 'POST', body: { email }, auth: false })
export const resetPassword = (accessToken, password) => request('/auth/reset', { method: 'POST', body: { accessToken, password }, auth: false })
export const me = async () => (await request('/auth/me')).user
export const updateMe = async (patch) => (await request('/auth/me', { method: 'PATCH', body: patch })).user

// ---------- events (Codefolio-hosted) ----------
export const listEvents = async () => (await request('/events', { auth: false })).events
export const createEvent = async (input) => (await request('/events', { method: 'POST', body: input })).event
export const updateEvent = async (id, input) => (await request(`/events/${encodeURIComponent(id)}`, { method: 'PUT', body: input })).event
export const cancelEvent = async (id) => (await request(`/events/${encodeURIComponent(id)}/cancel`, { method: 'POST' })).event
export const deleteEvent = (id) => request(`/events/${encodeURIComponent(id)}`, { method: 'DELETE' })

// ---------- bookings ----------
export const myBookings = async () => (await request('/bookings/me')).bookings
export const createBooking = (eventId, seats) => request('/bookings', { method: 'POST', body: { eventId, seats } })
export const cancelBooking = (id) => request(`/bookings/${encodeURIComponent(id)}/cancel`, { method: 'POST' })

// ---------- organizer ----------
export const organizerBookings = async () => (await request('/admin/bookings')).bookings
export const uploadImage = async (dataUrl) => (await request('/admin/uploads', { method: 'POST', body: { dataUrl } })).url

// ---------- live listings (proxied + cached by the API) ----------
export const liveGdg = (force) => request(`/live/gdg${force ? '?refresh=1' : ''}`, { auth: false })
export const liveDevfolio = (force) => request(`/live/devfolio${force ? '?refresh=1' : ''}`, { auth: false })
export const liveGdgDetail = async (remoteId) => (await request(`/live/gdg/${remoteId}`, { auth: false })).detail
