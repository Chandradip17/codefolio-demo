// Remembers where a logged-out user was headed, across the OAuth/email
// round-trip, so we can send them back after login + onboarding.
const KEY = 'cf:next'

// Only same-app paths; never "//evil.com" or absolute URLs (open-redirect guard).
export function safePath(p) {
  if (typeof p !== 'string') return null
  if (!p.startsWith('/') || p.startsWith('//') || p.startsWith('/\\')) return null
  if (/^\/(login|auth\/callback|onboarding)\b/.test(p)) return null
  return p
}

export function rememberNext(p) {
  const safe = safePath(p)
  try {
    if (safe) sessionStorage.setItem(KEY, safe)
  } catch {
    /* storage blocked */
  }
}

export function peekNext() {
  try {
    return safePath(sessionStorage.getItem(KEY))
  } catch {
    return null
  }
}

export function takeNext(fallback = '/home') {
  const p = peekNext()
  try {
    sessionStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
  return p || fallback
}
