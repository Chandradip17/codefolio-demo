// Normalization of external listings into Codefolio's external-event shape.
// Input: one record of the documented feed contract (docs/unstop-integration.md).
// Output: a clean, validated item — or { error } so the caller can skip + log it.
import { createHash } from 'node:crypto'
import { stripHtml } from '../live.js'

export const EVENT_TYPES = ['hackathon', 'competition', 'workshop', 'webinar', 'conference', 'quiz', 'other']
export const MODES = ['online', 'offline', 'hybrid', 'unknown']

const TYPE_ALIASES = {
  hackathon: 'hackathon', hackathons: 'hackathon', 'coding hackathon': 'hackathon',
  competition: 'competition', competitions: 'competition', challenge: 'competition', contest: 'competition', 'case study': 'competition',
  workshop: 'workshop', workshops: 'workshop', bootcamp: 'workshop',
  webinar: 'webinar', webinars: 'webinar', talk: 'webinar',
  conference: 'conference', conferences: 'conference', summit: 'conference', fest: 'conference', meetup: 'conference',
  quiz: 'quiz', quizzes: 'quiz',
}
const MODE_ALIASES = {
  online: 'online', virtual: 'online', remote: 'online',
  offline: 'offline', 'in-person': 'offline', inperson: 'offline', onsite: 'offline', 'on-site': 'offline', physical: 'offline',
  hybrid: 'hybrid', 'online & offline': 'hybrid', 'online and offline': 'hybrid',
}

const pick = (o, ...keys) => {
  for (const k of keys) if (o[k] !== undefined && o[k] !== null && o[k] !== '') return o[k]
  return undefined
}
const str = (v, max) => (typeof v === 'string' || typeof v === 'number' ? String(v).trim().slice(0, max) : '')
const list = (v, maxItems = 30, maxLen = 40) => {
  const arr = Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : []
  return [...new Set(arr.map((x) => (typeof x === 'string' ? x : x?.name)).filter((x) => typeof x === 'string').map((x) => x.trim().slice(0, maxLen)).filter(Boolean))].slice(0, maxItems)
}
const date = (v) => {
  if (v == null || v === '') return null
  const d = new Date(typeof v === 'number' && v < 1e12 ? v * 1000 : v) // accept epoch seconds or ms
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}
function httpsUrl(v, allowedHosts) {
  if (typeof v !== 'string') return null
  let u
  try {
    u = new URL(v.trim())
  } catch {
    return null
  }
  if (u.protocol !== 'https:') return null
  if (allowedHosts && !allowedHosts.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`))) return null
  return u.toString()
}

const normText = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

// Stable identity: the provider's id when present, otherwise a fingerprint of
// normalized title + organizer + start (or deadline) date.
export function identityKey({ externalId, title, organizer, startAt, registrationDeadline }) {
  if (externalId) return `id:${String(externalId).slice(0, 180)}`
  const day = (startAt || registrationDeadline || '').slice(0, 10)
  const h = createHash('sha1').update(`${normText(title)}|${normText(organizer)}|${day}`).digest('hex').slice(0, 32)
  return `fp:${h}`
}

// Short public id used in URLs (/api/unstop/events/:id).
export const publicId = (source, key) => `${source.slice(0, 2)}-${createHash('sha1').update(`${source}|${key}`).digest('hex').slice(0, 16)}`

export function normalizeRecord(raw, { source, allowedHosts, fetchedAt = new Date().toISOString(), mock = false }) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'not an object' }
  const title = str(pick(raw, 'title', 'name'), 300)
  if (title.length < 2) return { error: 'missing title' }
  const sourceUrl = httpsUrl(pick(raw, 'url', 'sourceUrl', 'source_url', 'link'), mock ? null : allowedHosts)
  if (!sourceUrl) return { error: `missing or disallowed listing url (${str(pick(raw, 'url', 'link'), 80) || 'none'})` }
  const registrationUrl = httpsUrl(pick(raw, 'registrationUrl', 'registration_url', 'applyUrl', 'apply_url'), null) || sourceUrl

  const rawType = normText(pick(raw, 'type', 'eventType', 'event_type', 'category'))
  const eventType = TYPE_ALIASES[rawType] || (EVENT_TYPES.includes(rawType) ? rawType : 'other')
  const modeText = String(pick(raw, 'mode', 'format') ?? '').toLowerCase().trim()
  const mode = MODE_ALIASES[modeText] || MODE_ALIASES[modeText.replace(/\s+/g, '-')] || 'unknown'

  const externalIdRaw = pick(raw, 'id', 'externalId', 'external_id')
  const externalId = externalIdRaw == null ? null : str(externalIdRaw, 180) || null
  const organizer = str(pick(raw, 'organizer', 'organiser', 'organization', 'host'), 200)
  const startAt = date(pick(raw, 'startAt', 'start_at', 'startDate', 'start_date'))
  const endAt = date(pick(raw, 'endAt', 'end_at', 'endDate', 'end_date'))
  const registrationDeadline = date(pick(raw, 'registrationDeadline', 'registration_deadline', 'deadline', 'regnEndDate'))

  const item = {
    source,
    externalId,
    title,
    description: stripHtml(str(pick(raw, 'description', 'details', 'summary'), 20000)),
    organizer,
    logo: httpsUrl(pick(raw, 'logo', 'logoUrl', 'logo_url'), null),
    banner: httpsUrl(pick(raw, 'banner', 'bannerUrl', 'banner_url', 'image'), null),
    eventType,
    mode,
    location: str(pick(raw, 'location', 'city', 'venue'), 200),
    startAt,
    endAt: endAt && startAt && endAt < startAt ? null : endAt,
    registrationDeadline,
    registrationUrl,
    sourceUrl,
    prize: str(pick(raw, 'prize', 'prizes', 'prizePool', 'prize_pool'), 300),
    eligibility: str(pick(raw, 'eligibility', 'eligible'), 1000),
    skills: list(pick(raw, 'skills')),
    tags: list(pick(raw, 'tags', 'themes')),
    fetchedAt,
    mock,
    raw, // kept for the database (debugging); never sent to browsers
  }
  item.identityKey = identityKey(item)
  item.id = publicId(source, item.identityKey)
  return { item }
}
// Normalize + validate + dedupe a whole batch. Invalid records are skipped and reported.
export function normalizeBatch(records, opts) {
  const byKey = new Map()
  const skipped = []
  for (const [i, raw] of records.entries()) {
    const { item, error } = normalizeRecord(raw, opts)
    if (error) {
      skipped.push({ index: i, id: raw && typeof raw === 'object' ? raw.id ?? null : null, reason: error })
      continue
    }
    byKey.set(item.identityKey, item) // later duplicates win (same identity = same event)
  }
  return { items: [...byKey.values()], skipped }
}

// Registration / timing status relative to `now`.
export function statusOf(item, now = Date.now()) {
  const end = item.endAt ? Date.parse(item.endAt) : item.startAt ? Date.parse(item.startAt) + 86400000 : null
  if (end != null && end < now) return 'ended'
  const deadline = item.registrationDeadline ? Date.parse(item.registrationDeadline) : null
  if (deadline != null && deadline < now) return 'closed'
  if (deadline != null && deadline - now <= 3 * 86400000) return 'closing_soon'
  return 'open'
}
