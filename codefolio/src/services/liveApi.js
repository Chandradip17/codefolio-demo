// Live GDG Community + Devfolio listings. The API server fetches, filters to
// India, normalizes and caches them (server/src/lib/live.js); the client only
// adds fallback artwork for events without a cover image.
import { fallbackImage } from '../data/images'
import { CITIES } from '../data/chapters'
import { liveDevfolio, liveGdg, liveGdgDetail, unstopEvents } from './api'

const withArt = (e) => ({ ...e, hasRealImage: Boolean(e.image), image: e.image || fallbackImage(e.category, e.id) })

export async function fetchGdgIndiaEvents(force) {
  const res = await liveGdg(force)
  return { ...res, events: res.events.map(withArt) }
}

export async function fetchDevfolioHackathons(force) {
  const res = await liveDevfolio(force)
  return { ...res, events: res.events.map(withArt) }
}

export const fetchGdgDetail = (remoteId) => liveGdgDetail(remoteId)

// ---------- Unstop ----------
const IST = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
function ist(isoString) {
  const p = Object.fromEntries(IST.formatToParts(new Date(isoString)).map((x) => [x.type, x.value]))
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` }
}
// Unstop's types → Codefolio's catalogue sections.
const UNSTOP_CATEGORY = { hackathon: 'hackathon', workshop: 'workshop', webinar: 'workshop', competition: 'competition', quiz: 'competition', conference: 'event', other: 'event' }
const TYPE_LABEL = { hackathon: 'Hackathon', competition: 'Competition', workshop: 'Workshop', webinar: 'Webinar', conference: 'Conference', quiz: 'Quiz', other: 'Event' }

export function unstopToEvent(item) {
  const when = item.startAt || item.registrationDeadline
  if (!when) return null // can't place it on the calendar
  const start = ist(when)
  const end = item.endAt ? ist(item.endAt) : null
  const online = item.mode === 'online'
  const place = (item.location || '').split(',')[0].trim()
  const city = online ? 'Online' : CITIES.find((c) => c.toLowerCase() === place.toLowerCase()) || place || 'India'
  const category = UNSTOP_CATEGORY[item.eventType] || 'event'
  return withArt({
    id: item.id,
    remoteId: item.externalId,
    source: 'unstop',
    mock: Boolean(item.mock),
    title: item.title,
    tagline: '',
    type: category === 'hackathon' ? 'Hackathon' : 'Event',
    category,
    eventTypeLabel: TYPE_LABEL[item.eventType] || 'Event',
    mode: online ? 'Online' : 'In-person',
    hybrid: item.mode === 'hybrid',
    city,
    rawCity: item.location || '',
    venue: item.location || (online ? 'Online' : 'TBA'),
    date: start.date,
    time: item.startAt ? start.time : null,
    dateIsDeadline: !item.startAt,
    endDate: end?.date || null,
    endTime: end?.time || null,
    organizerChapter: item.organizer || 'Listed on Unstop',
    capacity: null,
    availableSeats: null,
    description: item.description || '',
    image: item.banner || null,
    logo: item.logo || null,
    status: 'Published',
    externalUrl: item.registrationUrl,
    sourceUrl: item.sourceUrl,
    registrationDeadline: item.registrationDeadline ? ist(item.registrationDeadline).date : null,
    registrationDeadlineAt: item.registrationDeadline || null,
    registrationStatus: item.status,
    prizes: item.prize ? [item.prize] : [],
    eligibility: item.eligibility || '',
    skills: item.skills || [],
    tags: [...(item.tags || []), ...(item.skills || [])].slice(0, 10),
    enriched: true,
  })
}

// Up to 200 open listings for the catalogue (search/filters then run in the page).
export async function fetchUnstopEvents() {
  const first = await unstopEvents({ status: 'open', sort: 'deadline', limit: 100 })
  let items = first.items
  if (first.hasMore) items = items.concat((await unstopEvents({ status: 'open', sort: 'deadline', limit: 100, page: 2 })).items)
  return {
    events: items.map(unstopToEvent).filter(Boolean),
    configured: first.source.configured,
    mock: first.source.mock,
    stale: first.source.stale,
    updatedAt: first.source.updatedAt ? Date.parse(first.source.updatedAt) : null,
  }
}

export function applyGdgDetail(event, patch) {
  return withArt({
    ...event,
    ...patch,
    venue: patch.venue || event.venue,
    image: patch.image || (event.hasRealImage ? event.image : null),
    enriched: true,
  })
}
