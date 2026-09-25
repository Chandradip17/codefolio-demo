// Client-side mirror of the profiles table constraints
// (supabase/migrations/20260925120000_phase1_foundation.sql). The database is
// the real enforcement; this just gives instant, specific feedback.
export const RESERVED = ['admin', 'root', 'support', 'codefolio', 'api', 'me', 'settings', 'host', 'null', 'undefined']
export const USERNAME_RE = /^[a-z0-9_]{3,20}$/
export const LIMITS = { fullName: 80, college: 120, company: 120, bio: 600, skills: 30, skill: 32 }

export function usernameProblem(u) {
  if (!u) return 'Choose a username.'
  if (u.length < 3) return 'At least 3 characters.'
  if (u.length > 20) return 'At most 20 characters.'
  if (!USERNAME_RE.test(u)) return 'Use lowercase letters, numbers and underscores only.'
  if (RESERVED.includes(u)) return 'That username is reserved.'
  return null
}

// Accept a handle, "github.com/x" or a full URL; return a canonical URL or ''.
export function normalizeGithub(v) {
  const s = v.trim()
  if (!s) return ''
  const handle = s.replace(/^https?:\/\//i, '').replace(/^(www\.)?github\.com\//i, '').replace(/\/+$/, '')
  return /^[A-Za-z0-9_.-]+$/.test(handle) ? `https://github.com/${handle}` : s
}
export function normalizeLinkedin(v) {
  const s = v.trim()
  if (!s) return ''
  if (/^[A-Za-z0-9_-]+$/.test(s)) return `https://www.linkedin.com/in/${s}`
  const url = /^https?:\/\//i.test(s) ? s : `https://${s}`
  return url.replace(/^http:\/\//i, 'https://').replace(/\/+$/, '')
}
export function normalizeUrl(v) {
  const s = v.trim()
  if (!s) return ''
  return /^https?:\/\//i.test(s) ? s : `https://${s}`
}

export const GITHUB_RE = /^https:\/\/(www\.)?github\.com\/[A-Za-z0-9_.-]+\/?$/i
export const LINKEDIN_RE = /^https:\/\/([a-z]{2,3}\.)?linkedin\.com\/(in|company)\/[^\s/]+\/?$/i
export const PORTFOLIO_RE = /^https?:\/\/[^\s]+\.[^\s]+$/i

// Map a Postgres constraint violation back to the form field.
export function constraintField(message = '') {
  const m = message.match(/constraint "([a-z_]+)"/i)?.[1] || ''
  if (m.startsWith('username') || m === 'profiles_username_key') return 'username'
  if (m.startsWith('full_name')) return 'full_name'
  if (m.startsWith('github')) return 'github_url'
  if (m.startsWith('linkedin')) return 'linkedin_url'
  if (m.startsWith('portfolio')) return 'portfolio_url'
  if (m.startsWith('bio')) return 'bio'
  if (m.startsWith('skills')) return 'skills'
  return null
}
