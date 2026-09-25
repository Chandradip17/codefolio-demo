import { createClient } from '@supabase/supabase-js'

// Browser client: publishable key only, so every read/write is enforced by RLS.
// The service-role key lives only on the server (server/.env).
const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY
if (!url || !key) console.error('Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY (see codefolio/.env.example).')

export const supabase = createClient(url || 'http://localhost', key || 'missing', {
  auth: { flowType: 'pkce', detectSessionInUrl: true, persistSession: true, autoRefreshToken: true },
})

export function friendlyAuthError(error, fallback = 'Something went wrong. Please try again.') {
  const msg = error?.message || ''
  if (!msg) return fallback
  if (/invalid login credentials/i.test(msg)) return 'Incorrect email or password.'
  if (/email not confirmed/i.test(msg)) return 'Please confirm your email address first.'
  if (/expired|invalid.*(otp|token)|token has expired/i.test(msg)) return 'That code is invalid or has expired. Request a new one.'
  if (/rate limit|security purposes|too many/i.test(msg)) return 'Too many attempts. Please wait a minute and try again.'
  if (/provider is not enabled|unsupported provider/i.test(msg)) return 'Google sign-in isn’t enabled for Codefolio yet. Use an email code for now.'
  if (/signups not allowed/i.test(msg)) return 'New sign-ups are currently closed.'
  if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) return "Can't reach the server. Check your connection and try again."
  return msg
}

// Remember where a logged-out user was headed, across OAuth/email round-trips.
const NEXT_KEY = 'cf:next'
export function safePath(p) {
  if (typeof p !== 'string' || !p.startsWith('/') || p.startsWith('//') || p.startsWith('/\\')) return null
  if (/^\/(login|signup|auth\/callback|onboarding)\b/.test(p)) return null
  return p
}
export function rememberNext(p) {
  const s = safePath(p)
  try {
    if (s) sessionStorage.setItem(NEXT_KEY, s)
  } catch {
    /* storage blocked */
  }
}
export function peekNext() {
  try {
    return safePath(sessionStorage.getItem(NEXT_KEY))
  } catch {
    return null
  }
}
// Read without removing (render paths may run twice in React dev mode);
// the stored destination is cleared once the member actually gets into the app.
export function clearNext() {
  try {
    sessionStorage.removeItem(NEXT_KEY)
  } catch {
    /* ignore */
  }
}
