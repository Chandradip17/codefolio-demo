import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabaseConfigured = Boolean(url && key)
if (!supabaseConfigured) {
  console.error('Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. Copy codefolio/.env.example to .env.local.')
}

// Browser client: publishable key only, so everything is enforced by RLS.
export const supabase = createClient(url || 'http://localhost', key || 'missing', {
  auth: {
    flowType: 'pkce', // OAuth + email links come back as ?code=…
    detectSessionInUrl: true,
    persistSession: true,
    autoRefreshToken: true,
  },
})

// Turn Supabase/PostgREST errors into sentences people can act on.
export function friendlyError(error, fallback = 'Something went wrong. Please try again.') {
  if (!error) return fallback
  const msg = error.message || String(error)
  if (error.code === '23505') return 'That already exists.'
  if (error.code === '42501' || /permission denied|row-level security/i.test(msg)) return "You don't have permission to do that."
  if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) return "Can't reach the server. Check your connection and try again."
  if (/rate limit|too many/i.test(msg)) return 'Too many attempts. Please wait a minute and try again.'
  if (/expired|invalid.*(otp|token)|otp.*invalid/i.test(msg)) return 'That code is invalid or has expired. Request a new one.'
  return msg || fallback
}
