// Data client. Auth + profiles talk to Supabase directly (RLS enforced);
// events/bookings go through the Codefolio API (server/) with the same
// Supabase access token. In dev, Vite proxies /api to the server.
import { friendlyAuthError, supabase } from './supabase'

export const BASE = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '')

export class ApiError extends Error {
  constructor(message, status = 0, code = 'error', fields) {
    super(message)
    this.status = status
    this.code = code
    this.fields = fields
  }
}

// ---------- session (Supabase Auth in the browser; auto-refreshed) ----------
// A valid access token, or null when signed out.
export async function getAccessToken({ forceRefresh = false } = {}) {
  if (forceRefresh) {
    const { data } = await supabase.auth.refreshSession()
    return data.session?.access_token || null
  }
  const { data } = await supabase.auth.getSession()
  return data.session?.access_token || null
}

async function request(path, { method = 'GET', body, auth = true, retry = true } = {}) {
  const token = auth ? await getAccessToken() : null
  let res
  try {
    res = await fetch(BASE + path, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new ApiError("Can't reach the Codefolio server. Is the API running?", 0, 'network')
  }

  if (res.status === 401 && token && retry && (await getAccessToken({ forceRefresh: true }))) {
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
const authError = (error) => new ApiError(friendlyAuthError(error), error?.status || 400, 'auth')

export async function login(email, password) {
  const { error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password })
  if (error) throw authError(error)
  return me()
}
// Password sign-up stays server-side so the organizer role is set in app_metadata
// (which users can't edit); the returned session is then adopted by the browser.
export async function signup(input) {
  const { session: s } = await request('/auth/signup', { method: 'POST', body: input, auth: false })
  const { error } = await supabase.auth.setSession({ access_token: s.accessToken, refresh_token: s.refreshToken })
  if (error) throw authError(error)
  return me()
}
export async function signInWithGoogle() {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: `${window.location.origin}/auth/callback` },
  })
  if (error) throw authError(error)
}
export async function sendEmailCode(email) {
  const { error } = await supabase.auth.signInWithOtp({
    email: email.trim().toLowerCase(),
    options: { shouldCreateUser: true, emailRedirectTo: `${window.location.origin}/auth/callback` },
  })
  if (error) throw authError(error)
}
export async function verifyEmailCode(email, token) {
  const { error } = await supabase.auth.verifyOtp({ email: email.trim().toLowerCase(), token, type: 'email' })
  if (error) throw authError(error)
  return me()
}
export async function logout() {
  await supabase.auth.signOut().catch(() => {})
}
export const forgotPassword = (email) => request('/auth/forgot', { method: 'POST', body: { email }, auth: false })
export const resetPassword = (accessToken, password) => request('/auth/reset', { method: 'POST', body: { accessToken, password }, auth: false })

// ---------- profiles (direct, RLS) ----------
const PROFILE_COLS =
  'id, name, username, avatar_url, college, company, bio, skills, github_url, linkedin_url, portfolio_url, city, chapter, role, platform_role, onboarding_completed, created_at'

export function toUser(r, email) {
  return {
    id: r.id,
    name: r.name,
    email,
    role: r.role,
    city: r.city || '',
    chapter: r.chapter || '',
    bio: r.bio || '',
    createdAt: r.created_at,
    username: r.username,
    avatarUrl: r.avatar_url,
    college: r.college || '',
    company: r.company || '',
    skills: r.skills || [],
    githubUrl: r.github_url || '',
    linkedinUrl: r.linkedin_url || '',
    portfolioUrl: r.portfolio_url || '',
    isAdmin: r.platform_role === 'admin',
    onboarded: Boolean(r.onboarding_completed),
  }
}

const dbError = (error) => {
  if (error?.code === '23505') return new ApiError('That username was just taken. Try another.', 409, 'username_taken', { username: 'That username is taken.' })
  if (error?.code === '23514') {
    const c = error.message.match(/constraint "([a-z_]+)"/)?.[1] || ''
    const field = c.startsWith('username') ? 'username' : c.startsWith('github') ? 'githubUrl' : c.startsWith('linkedin') ? 'linkedinUrl' : c.startsWith('portfolio') ? 'portfolioUrl' : c.startsWith('bio') ? 'bio' : null
    return new ApiError('Some details aren’t in the right format.', 422, 'validation', field ? { [field]: 'Check this value.' } : undefined)
  }
  if (/Failed to fetch/i.test(error?.message || '')) return new ApiError("Can't reach the server. Check your connection.", 0, 'network')
  return new ApiError(error?.message || 'Something went wrong.', 500, error?.code || 'db')
}

// The signed-in member (null when signed out).
export async function me() {
  const { data } = await supabase.auth.getSession()
  const u = data.session?.user
  if (!u) return null
  const { data: row, error } = await supabase.from('profiles').select(PROFILE_COLS).eq('id', u.id).maybeSingle()
  if (error) throw dbError(error)
  if (!row) throw new ApiError('Your profile record is missing. Sign out and back in.', 500, 'profile_missing')
  return toUser(row, u.email)
}

// Accepts the v1 shape ({ name, city, chapter, bio }) plus the Phase 1 fields.
export async function updateMe(patch) {
  const { data } = await supabase.auth.getSession()
  const u = data.session?.user
  if (!u) throw new ApiError('Please log in first.', 401, 'auth')
  const map = {
    name: 'name',
    city: 'city',
    chapter: 'chapter',
    bio: 'bio',
    username: 'username',
    avatarUrl: 'avatar_url',
    college: 'college',
    company: 'company',
    skills: 'skills',
    githubUrl: 'github_url',
    linkedinUrl: 'linkedin_url',
    portfolioUrl: 'portfolio_url',
    onboarded: 'onboarding_completed',
  }
  const row = {}
  for (const [k, col] of Object.entries(map)) {
    if (patch[k] === undefined) continue
    row[col] = typeof patch[k] === 'string' ? patch[k].trim() || (['name', 'city', 'chapter', 'bio'].includes(k) ? '' : null) : patch[k]
  }
  const { error } = await supabase.from('profiles').update(row).eq('id', u.id)
  if (error) throw dbError(error)
  return me()
}

export async function usernameAvailable(username) {
  const { data, error } = await supabase.rpc('username_available', { p_username: username })
  if (error) throw dbError(error)
  return Boolean(data)
}

export async function profileByUsername(username) {
  const { data, error } = await supabase
    .from('profiles')
    .select(PROFILE_COLS)
    .eq('username', username.toLowerCase())
    .eq('onboarding_completed', true)
    .maybeSingle()
  if (error) throw dbError(error)
  return data ? toUser(data) : null
}

// Uploads a square JPEG (already resized in the browser) to avatars/<uid>/…
export async function uploadAvatar(blob) {
  const { data } = await supabase.auth.getSession()
  const uid = data.session?.user?.id
  if (!uid) throw new ApiError('Please log in first.', 401, 'auth')
  const path = `${uid}/${Date.now()}.jpg`
  const { error } = await supabase.storage.from('avatars').upload(path, blob, { contentType: 'image/jpeg', cacheControl: '31536000' })
  if (error) throw new ApiError(/size|large/i.test(error.message) ? 'That image is too large (max 2 MB).' : error.message, 400, 'upload')
  return supabase.storage.from('avatars').getPublicUrl(path).data.publicUrl
}

// Real numbers for the landing page (sample content excluded).
export async function platformStats() {
  const { data, error } = await supabase.rpc('platform_stats')
  if (error) throw dbError(error)
  return data
}

// ---------- events (Codefolio-hosted) ----------
export const listEvents = async () => (await request('/events', { auth: false })).events
export const createEvent = async (input) => (await request('/events', { method: 'POST', body: input })).event
export const updateEvent = async (id, input) => (await request(`/events/${encodeURIComponent(id)}`, { method: 'PUT', body: input })).event
export const cancelEvent = async (id) => (await request(`/events/${encodeURIComponent(id)}/cancel`, { method: 'POST' })).event
export const deleteEvent = (id) => request(`/events/${encodeURIComponent(id)}`, { method: 'DELETE' })

// ---------- bookings (requests → approved seats) ----------
export const myBookings = async () => (await request('/bookings/me')).bookings
export const createBooking = (eventId, seats, answers = {}) => request('/bookings', { method: 'POST', body: { eventId, seats, answers } })
export const cancelBooking = (id) => request(`/bookings/${encodeURIComponent(id)}/cancel`, { method: 'POST' })
export const eventForm = async (eventId) => (await request(`/events/${encodeURIComponent(eventId)}/form`)).form
export const bookingCredential = async (id) => (await request(`/bookings/${encodeURIComponent(id)}/credential`)).credential
export const regenerateCredential = async (id) => (await request(`/bookings/${encodeURIComponent(id)}/credential/regenerate`, { method: 'POST' })).credential
export const uploadApplicationFile = async (name, dataUrl) => (await request('/uploads/application-file', { method: 'POST', body: { name, dataUrl } })).file

// ---------- host access ----------
export const myHostRequests = () => request('/host-requests/me')
export const requestHostAccess = async (input) => (await request('/host-requests', { method: 'POST', body: input })).request

// ---------- organizer ----------
export const organizerBookings = async () => (await request('/admin/bookings')).bookings
export const uploadImage = async (dataUrl) => (await request('/admin/uploads', { method: 'POST', body: { dataUrl } })).url
export const reviewBooking = (id, action, note = '') => request(`/admin/bookings/${encodeURIComponent(id)}/${action}`, { method: 'POST', body: { note } })
export const bookingAnswers = (id) => request(`/admin/bookings/${encodeURIComponent(id)}/answers`)
export const checkIn = async (eventId, code) => (await request('/admin/checkin', { method: 'POST', body: { eventId, code } })).result
export const eventAttendance = async (eventId) => (await request(`/admin/events/${encodeURIComponent(eventId)}/attendance`)).attendance
export const adminEventForm = (eventId) => request(`/admin/events/${encodeURIComponent(eventId)}/form`)
export const saveEventForm = async (eventId, questions) => (await request(`/admin/events/${encodeURIComponent(eventId)}/form`, { method: 'PUT', body: { questions } })).form

// ---------- platform admin ----------
export const hostRequests = (status) => request(`/platform/host-requests${status ? `?status=${status}` : ''}`)
export const reviewHostRequest = async (id, action, note = '') =>
  (await request(`/platform/host-requests/${encodeURIComponent(id)}/${action}`, { method: 'POST', body: { note } })).request
export const platformOverview = () => request('/platform/overview')

// ---------- live listings (proxied + cached by the API) ----------
export const liveGdg = (force) => request(`/live/gdg${force ? '?refresh=1' : ''}`, { auth: false })
export const liveDevfolio = (force) => request(`/live/devfolio${force ? '?refresh=1' : ''}`, { auth: false })
export const liveGdgDetail = async (remoteId) => (await request(`/live/gdg/${remoteId}`, { auth: false })).detail
