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
    const e = new ApiError(err?.message || fallback, res.status, err?.code || 'http', err?.fields)
    if (err?.retryAfter) e.retryAfter = err.retryAfter // e.g. chat cooldown / rate limit (seconds, from the server)
    throw e
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
// Which sign-in providers are switched on in Supabase (public endpoint).
async function authProviders() {
  const url = import.meta.env.VITE_SUPABASE_URL
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY
  try {
    const res = await fetch(`${url}/auth/v1/settings`, { headers: { apikey: key } })
    return res.ok ? (await res.json()).external || null : null
  } catch {
    return null // unknown: let the redirect try anyway
  }
}

export async function signInWithGoogle() {
  // A disabled provider would otherwise send the visitor to a raw JSON error page.
  const providers = await authProviders()
  if (providers && !providers.google) {
    throw new ApiError('Google sign-in isn’t switched on for Codefolio yet. Use an email code or password for now.', 400, 'auth/google_disabled')
  }
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
  'id, name, username, avatar_url, college, company, bio, skills, github_url, linkedin_url, portfolio_url, city, chapter, role, platform_role, is_judge, onboarding_completed, created_at'

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
    isJudge: Boolean(r.is_judge),
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
// Signed in, the list also includes the member's own drafts (hidden from everyone else).
export const listEvents = async () => (await request('/events')).events
export const createEvent = async (input) => (await request('/events', { method: 'POST', body: input })).event
export const updateEvent = async (id, input) => (await request(`/events/${encodeURIComponent(id)}`, { method: 'PUT', body: input })).event
export const cancelEvent = async (id) => (await request(`/events/${encodeURIComponent(id)}/cancel`, { method: 'POST' })).event
export const deleteEvent = (id) => request(`/events/${encodeURIComponent(id)}`, { method: 'DELETE' })

// ---------- bookings (requests → approved seats) ----------
export const myBookings = async () => (await request('/bookings/me')).bookings
// extra: hackathon participation { participation, teamName?, teamCode? } and/or paid-event
// payment { paymentRef, paymentProof? }
export const createBooking = (eventId, seats, answers = {}, extra = {}) =>
  request('/bookings', { method: 'POST', body: { eventId, seats, answers, ...extra } })
export const teamLookup = async (eventId, code) =>
  (await request(`/bookings/team-lookup?event=${encodeURIComponent(eventId)}&code=${encodeURIComponent(code)}`)).team
export const cancelBooking = (id) => request(`/bookings/${encodeURIComponent(id)}/cancel`, { method: 'POST' })
export const eventForm = async (eventId) => (await request(`/events/${encodeURIComponent(eventId)}/form`)).form
// The form plus where to pay (paid events only): { form, payment: { fee, upiId, upiNumber, qrUrl } | null }
export const eventApplication = (eventId) => request(`/events/${encodeURIComponent(eventId)}/form`)
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

// ---------- judges ----------
export const myJudgeApplications = () => request('/judge-applications/me')
export const applyAsJudge = async (input) => (await request('/judge-applications', { method: 'POST', body: input })).application
export const judgeApplications = (status) => request(`/platform/judge-applications${status ? `?status=${status}` : ''}`)
export const judgeApplication = async (id) => (await request(`/platform/judge-applications/${encodeURIComponent(id)}`)).application
export const reviewJudgeApplication = async (id, action, note = '') =>
  (await request(`/platform/judge-applications/${encodeURIComponent(id)}/${action}`, { method: 'POST', body: { note } })).application

// ---------- hackathon projects (participants) ----------
export const myProjects = async () => (await request('/projects/mine')).projects
export const submitProject = async (input) => (await request('/projects', { method: 'POST', body: input })).project

// ---------- judge workspace ----------
export const judgeOverview = () => request('/judge/overview')
export const judgeProject = (id) => request(`/judge/projects/${encodeURIComponent(id)}`)
export const submitReview = async (id, scores) => (await request(`/judge/projects/${encodeURIComponent(id)}/review`, { method: 'POST', body: scores })).review
export const analyzeProject = async (id) => (await request(`/judge/projects/${encodeURIComponent(id)}/analysis`, { method: 'POST' })).analysis

// ---------- organizer judging ----------
export const organizerHackathons = async () => (await request('/organizer/hackathons')).hackathons
export const hackathonJudging = (id) => request(`/organizer/hackathons/${encodeURIComponent(id)}/judging`)
export const approvedJudges = async (q = '') => (await request(`/organizer/judges?q=${encodeURIComponent(q)}`)).judges
export const assignJudge = (eventId, judgeId) => request(`/organizer/hackathons/${encodeURIComponent(eventId)}/judges`, { method: 'POST', body: { judgeId } })
export const unassignJudge = (eventId, judgeId) =>
  request(`/organizer/hackathons/${encodeURIComponent(eventId)}/judges/${encodeURIComponent(judgeId)}`, { method: 'DELETE' })
export const hackathonResults = (id) => request(`/organizer/hackathons/${encodeURIComponent(id)}/results`)
export const publishResults = (id, publish) => request(`/organizer/hackathons/${encodeURIComponent(id)}/results`, { method: 'POST', body: { publish } })
export const publicResults = (id) => request(`/events/${encodeURIComponent(id)}/results`)

// ---------- live listings (proxied + cached by the API) ----------
export const liveGdg = (force) => request(`/live/gdg${force ? '?refresh=1' : ''}`, { auth: false })
export const liveDevfolio = (force) => request(`/live/devfolio${force ? '?refresh=1' : ''}`, { auth: false })
export const liveGdgDetail = async (remoteId) => (await request(`/live/gdg/${remoteId}`, { auth: false })).detail

// ---------- Unstop listings (server-side cached; see docs/unstop-integration.md) ----------
export const unstopEvents = (params = {}) => {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== '' && v !== null))
  return request(`/unstop/events${qs.size ? `?${qs}` : ''}`, { auth: false })
}
export const unstopEvent = (id) => request(`/unstop/events/${encodeURIComponent(id)}`, { auth: false })
export const unstopStatus = async () => (await request('/unstop/status')).status
export const unstopSync = () => request('/unstop/sync', { method: 'POST' })

// ---------- team matcher ----------
const q = (params) => new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString()
export const matcherHackathons = () => request('/team-matcher/hackathons')
export const teamPreferences = (eventId) => request(`/team-matcher/preferences?${q({ event: eventId })}`)
export const saveTeamPreferences = async (input) => (await request('/team-matcher/preferences', { method: 'PUT', body: input })).preferences
export const teamMatches = (eventId, page = 1) => request(`/team-matcher/matches?${q({ event: eventId, page })}`)
export const interpretSkills = async (text) => (await request('/team-matcher/interpret', { method: 'POST', body: { text } })).suggestions
export const teamRequests = (eventId) => request(`/team-matcher/requests?${q({ event: eventId })}`)
export const sendTeamRequest = async (eventId, userId, message = '') => (await request('/team-matcher/requests', { method: 'POST', body: { eventId, userId, message } })).request
export const respondTeamRequest = async (id, action) => (await request(`/team-matcher/requests/${encodeURIComponent(id)}/${action}`, { method: 'POST' })).request

// ---------- GitHub (tokens stay on the server; the browser only sees metadata) ----------
export const githubConnection = () => request('/github/connection')
export const githubConnectUrl = async () => (await request('/github/connect', { method: 'POST' })).url
export const githubDisconnect = () => request('/github/connection', { method: 'DELETE' })
export const githubRepos = async () => (await request('/github/repos')).repos
export const projectRepository = (projectId) => request(`/github/projects/${encodeURIComponent(projectId)}/repository`)
export const connectProjectRepository = (projectId, repository) =>
  request(`/github/projects/${encodeURIComponent(projectId)}/repository`, { method: 'POST', body: { repository } })
export const syncProjectRepository = (projectId) => request(`/github/projects/${encodeURIComponent(projectId)}/repository/sync`, { method: 'POST' })
export const disconnectProjectRepository = (projectId) => request(`/github/projects/${encodeURIComponent(projectId)}/repository`, { method: 'DELETE' })

// ---------- Demo Day ----------
export const demoState = (eventId) => request(`/demo/${encodeURIComponent(eventId)}`)
export const saveDemoSession = (eventId, input) => request(`/demo/${encodeURIComponent(eventId)}`, { method: 'PUT', body: input })
export const demoControl = (eventId, action, presentationId) =>
  request(`/demo/${encodeURIComponent(eventId)}/control`, { method: 'POST', body: { action, presentationId } })
export const judgeNotes = (projectId) => request(`/judge/projects/${encodeURIComponent(projectId)}/notes`)
export const saveJudgeNotes = (projectId, notes) => request(`/judge/projects/${encodeURIComponent(projectId)}/notes`, { method: 'PUT', body: { notes } })

// ---------- AI Idea Assistant (Gemini runs on the server; the key never reaches the browser) ----------
export const ideaHackathons = () => request('/ideas/hackathons')
export const ideaContext = (eventId) => request(`/ideas/context?event=${encodeURIComponent(eventId)}`)
export const generateIdea = (inputs) => request('/ideas/generate', { method: 'POST', body: inputs })
export const refineIdea = (action, idea, inputs) => request('/ideas/refine', { method: 'POST', body: { action, idea, inputs } })
export const myIdeas = async (eventId) => (await request(`/ideas${eventId ? `?event=${encodeURIComponent(eventId)}` : ''}`)).ideas
export const saveIdea = async (idea, inputs, draftId) => (await request('/ideas', { method: 'POST', body: { idea, inputs, draftId } })).idea
export const updateIdea = async (id, idea, inputs, draftId) => (await request(`/ideas/${encodeURIComponent(id)}`, { method: 'PUT', body: { idea, inputs, draftId } })).idea
export const deleteIdea = (id) => request(`/ideas/${encodeURIComponent(id)}`, { method: 'DELETE' })

// ---------- Communication Center ----------
export const announcementHackathons = async () => (await request('/announcements/hackathons')).hackathons
export const announcements = (eventId, before) => request(`/announcements?event=${encodeURIComponent(eventId)}${before ? `&before=${encodeURIComponent(before)}` : ''}`)
export const unreadAnnouncements = () => request('/announcements/unread')
export const createAnnouncement = async (input) => (await request('/announcements', { method: 'POST', body: input })).announcement
export const updateAnnouncement = async (id, input) => (await request(`/announcements/${encodeURIComponent(id)}`, { method: 'PUT', body: input })).announcement
export const archiveAnnouncement = async (id) => (await request(`/announcements/${encodeURIComponent(id)}/archive`, { method: 'POST' })).announcement
export const markAnnouncementsRead = (eventId, ids) => request('/announcements/read', { method: 'POST', body: { eventId, ids } })

// ---------- Organizer analytics ----------
export const hackathonAnalytics = (id) => request(`/organizer/hackathons/${encodeURIComponent(id)}/analytics`)

// ---------- Participant chat (two-way; separate from announcements) ----------
export const chatHackathons = async () => (await request('/chat/hackathons')).hackathons
export const chatRoom = (eventId) => request(`/chat/${encodeURIComponent(eventId)}`)
export const chatOlder = (eventId, before) => request(`/chat/${encodeURIComponent(eventId)}/messages?before=${encodeURIComponent(before)}`)
export const sendChatMessage = (eventId, message) => request(`/chat/${encodeURIComponent(eventId)}/messages`, { method: 'POST', body: { message } })
export const reportChatMessage = (id, reason, details) => request(`/chat/message/${encodeURIComponent(id)}/report`, { method: 'POST', body: { reason, details } })
export const chatModeration = (eventId) => request(`/chat/moderation/${encodeURIComponent(eventId)}`)
export const setChatRoomActive = (eventId, active) => request(`/chat/moderation/${encodeURIComponent(eventId)}/room`, { method: 'PUT', body: { active } })
export const deleteChatMessage = (id) => request(`/chat/moderation/message/${encodeURIComponent(id)}`, { method: 'DELETE' })
export const reviewChatReport = (id, status) => request(`/chat/moderation/report/${encodeURIComponent(id)}`, { method: 'POST', body: { status } })
export const muteChatUser = (eventId, userId, minutes, reason, reportId) =>
  request(`/chat/moderation/${encodeURIComponent(eventId)}/mutes`, { method: 'POST', body: { userId, minutes, reason, reportId } })
export const unmuteChatUser = (eventId, userId) => request(`/chat/moderation/${encodeURIComponent(eventId)}/mutes/${encodeURIComponent(userId)}`, { method: 'DELETE' })
