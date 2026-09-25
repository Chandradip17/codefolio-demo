import { admin } from './supabase.js'
import { HttpError, must, notConfigured } from './errors.js'
import { toUser } from './mappers.js'

// Short-lived cache of token → profile so every request doesn't hit Supabase Auth.
const CACHE_MS = 30_000
const cache = new Map()

export function forgetToken(token) {
  cache.delete(token)
}

// Roles changed (e.g. a host request was approved): drop cached identities so
// the next request sees the new role immediately.
export function clearUserCache() {
  cache.clear()
}

export async function resolveUser(token) {
  const hit = cache.get(token)
  if (hit && hit.until > Date.now()) return hit.user

  const { data, error } = await admin.auth.getUser(token)
  // A network hiccup reaching Supabase Auth isn't an expired session: say so,
  // so the client doesn't refresh tokens / sign the member out for nothing.
  if (error && (error.name === 'AuthRetryableFetchError' || !error.status || error.status >= 500)) {
    console.warn('[auth] getUser failed:', error.name, error.message)
    throw new HttpError(503, 'auth/unavailable', "Can't reach the sign-in service right now. Please try again in a moment.")
  }
  if (error || !data?.user) throw new HttpError(401, 'auth/expired', 'Your session has expired. Please log in again.')

  const row = must(await admin.from('profiles').select('*').eq('id', data.user.id).maybeSingle())
  if (!row) throw new HttpError(401, 'auth/missing', 'Account profile not found.')

  const user = toUser(row)
  if (cache.size > 1000) cache.clear()
  cache.set(token, { user, until: Date.now() + CACHE_MS })
  return user
}

export const bearer = (req) => {
  const h = req.get('authorization') || ''
  return h.startsWith('Bearer ') ? h.slice(7).trim() : null
}

export async function requireAuth(req, res, next) {
  if (!admin) throw notConfigured()
  const token = bearer(req)
  if (!token) throw new HttpError(401, 'auth/required', 'Please log in first.')
  req.user = await resolveUser(token)
  req.token = token
  next()
}

export const requireRole = (role) => (req, res, next) => {
  if (req.user?.role !== role) {
    throw new HttpError(403, 'auth/forbidden', role === 'organizer' ? 'Only organizers can do that.' : 'Only attendees can do that.')
  }
  next()
}

// Invalidate cached profile after the user edits it.
export function refreshCachedUser(token, user) {
  const hit = cache.get(token)
  if (hit) hit.user = user
}
