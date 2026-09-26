// Live listings from the public GDG Community (Bevy) and Devfolio endpoints.
// These are undocumented public APIs, so everything here is defensive:
// in-memory cache, shared in-flight requests, and stale data served if a
// refresh fails.

const GDG = 'https://gdg.community.dev/api'
const DEVFOLIO = 'https://api.devfolio.co/api'
const LIST_TTL = 10 * 60 * 1000
const DETAIL_TTL = 6 * 60 * 60 * 1000
const ONGOING_WINDOW_DAYS = 21
const ENRICH_CONCURRENCY = 3
const UA = 'CodefolioBot/1.0 (+community event calendar)'

// ---------- time helpers (always IST, regardless of server TZ) ----------
const istParts = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})
function ist(dateLike) {
  const p = Object.fromEntries(istParts.formatToParts(new Date(dateLike)).map((x) => [x.type, x.value]))
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` }
}
const todayIST = () => ist(Date.now()).date
const daysAgoIST = (n) => ist(Date.now() - n * 86400000).date

function isCurrent(e) {
  const today = todayIST()
  if (e.date >= today) return true
  // Recently started and still running; skip long-running programs that began months ago.
  return (e.endDate || e.date) >= today && e.date >= daysAgoIST(ONGOING_WINDOW_DAYS)
}

// ---------- text helpers ----------
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" }
export function stripHtml(html = '') {
  return html
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6])\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#\d+|#x[0-9a-f]+|\w+);/gi, (m, e) => {
      if (e[0] === '#') return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10))
      return ENTITIES[e.toLowerCase()] ?? m
    })
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
export function stripMarkdown(md = '') {
  return md
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`#>]+/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// ---------- city + category ----------
const CITY_ALIASES = {
  bangalore: 'Bengaluru', bengaluru: 'Bengaluru',
  'new delhi': 'Delhi', delhi: 'Delhi', gurgaon: 'Delhi', gurugram: 'Delhi', noida: 'Delhi', 'greater noida': 'Delhi', ghaziabad: 'Delhi',
  pune: 'Pune',
  hyderabad: 'Hyderabad', secunderabad: 'Hyderabad',
  mumbai: 'Mumbai', 'navi mumbai': 'Mumbai', thane: 'Mumbai',
  chennai: 'Chennai',
  kolkata: 'Kolkata', calcutta: 'Kolkata',
}
export function normalizeCity(raw) {
  if (!raw) return ''
  const first = String(raw).split(',')[0].trim()
  return CITY_ALIASES[first.toLowerCase()] || first
}

const HACK_RE = /hack|buildathon|ideathon|codathon|solution challenge|shipaton|hunt challenge|code for communities/i
const WORKSHOP_RE = /workshop|bootcamp|study ?jam|hands[- ]on|code ?lab|lab\b|masterclass|training|session:|creative lab/i
export function categorize(title = '', tags = []) {
  if (HACK_RE.test(title) || tags.some((t) => /hackathon/i.test(t))) return 'hackathon'
  if (WORKSHOP_RE.test(`${title} ${tags.join(' ')}`)) return 'workshop'
  return 'gdg'
}
const typeFor = (category) => (category === 'hackathon' ? 'Hackathon' : 'Event')

// ---------- fetch helpers ----------
async function getJSON(url, init = {}) {
  const res = await fetch(url, {
    ...init,
    headers: { accept: 'application/json', 'user-agent': UA, ...(init.headers || {}) },
    signal: AbortSignal.timeout(25_000),
  })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} from ${url}`)
  return res.json()
}

// Cache entry: { value, at, promise, error }
function cached(ttl, loader) {
  const entries = new Map()
  async function get(key = '_', { force = false } = {}) {
    const e = entries.get(key) || {}
    const age = e.value !== undefined ? Date.now() - e.at : Infinity
    // A forced refresh only goes upstream if our copy is at least a minute old.
    if (age < ttl && !(force && age > 60_000)) return { value: e.value, at: e.at, stale: false }
    if (!e.promise) {
      e.promise = loader(key)
        .then((value) => {
          Object.assign(e, { value, at: Date.now(), error: null })
          return value
        })
        .finally(() => {
          e.promise = null
        })
      entries.set(key, e)
    }
    try {
      await e.promise
      return { value: e.value, at: e.at, stale: false }
    } catch (err) {
      e.error = err
      // Serve the last good copy rather than failing outright.
      if (e.value !== undefined) return { value: e.value, at: e.at, stale: true }
      throw err
    }
  }
  // Whatever is cached (even if past TTL), without triggering a fetch.
  get.peek = (key = '_') => entries.get(key)?.value
  return get
}

// ---------- GDG ----------
function normalizeGdg(e) {
  const start = e.start_date.slice(0, 16) // Bevy returns the chapter's local (IST) offset
  const end = e.end_date ? e.end_date.slice(0, 16) : null
  const category = categorize(e.title)
  return {
    id: `gdg-${e.id}`,
    remoteId: e.id,
    source: 'gdg',
    title: e.title,
    type: typeFor(category),
    category,
    mode: 'In-person',
    city: normalizeCity(e.chapter?.city),
    rawCity: e.chapter?.city || '',
    state: e.chapter?.state || '',
    venue: [e.chapter?.city, e.chapter?.state].filter(Boolean).join(', '),
    date: start.slice(0, 10),
    time: start.slice(11, 16),
    endDate: end?.slice(0, 10) || null,
    endTime: end?.slice(11, 16) || null,
    organizerChapter: e.chapter?.title || 'GDG',
    chapterUrl: e.chapter?.url || null,
    capacity: null,
    availableSeats: null,
    description: '',
    image: null,
    status: 'Published',
    externalUrl: e.url,
    tags: [],
    enriched: false,
  }
}

function gdgDetailPatch(d, title) {
  const tags = d.tags || []
  const capacity = d.total_capacity > 0 ? d.total_capacity : null
  const attendees = d.total_attendees || 0
  const venue = [d.venue_name, d.venue_address].filter((v) => v && !/^(to be announced|coming soon|tba)$/i.test(v.trim())).join(', ')
  const virtual = d.audience_type === 'VIRTUAL'
  const category = categorize(title || d.title, tags)
  return {
    tags,
    category,
    type: typeFor(category),
    mode: virtual ? 'Online' : 'In-person',
    hybrid: d.audience_type === 'HYBRID',
    venue: virtual ? 'Online' : venue || null,
    description: stripHtml(d.description || '') || d.description_short || '',
    shortDescription: d.description_short || '',
    image: d.cropped_banner_url || d.picture?.url || null,
    capacity,
    availableSeats: capacity ? Math.max(capacity - attendees, 0) : null,
    registered: attendees,
    enriched: true,
  }
}

const gdgDetail = cached(DETAIL_TTL, async (remoteId) => gdgDetailPatch(await getJSON(`${GDG}/event/${remoteId}/`)))


const gdgList = cached(LIST_TTL, async () => {
  // The API ignores country filters, so pull the (~1k) global live list and
  // filter to India here. Pages 1+2 in parallel; more if the count grows.
  const PAGE = 500
  const url = (n) => `${GDG}/event/?status=Live&page_size=${PAGE}&page=${n}`
  const [first, second] = await Promise.all([getJSON(url(1)), getJSON(url(2)).catch(() => null)])
  const pages = Math.min(5, Math.ceil((first.count || 0) / PAGE))
  const rest = await Promise.all(Array.from({ length: Math.max(0, pages - 2) }, (_, i) => getJSON(url(i + 3))))
  const events = [first, pages >= 2 ? second : null, ...rest]
    .flatMap((d) => d?.results || [])
    .filter((e) => e.chapter?.country === 'IN' && !e.is_hidden && !e.is_test)
    .map(normalizeGdg)
    .filter(isCurrent)
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))
  warmDetails(events)
  return events
})

// Fetch event details in the background so later list responses arrive enriched.
// Upstream throttles bursts, so keep concurrency low and retry with backoff.
function warmDetails(events) {
  const queue = events.map((e) => ({ id: String(e.remoteId), tries: 0 }))
  const failures = {}
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const worker = async () => {
    while (queue.length) {
      const job = queue.shift()
      try {
        await gdgDetail(job.id)
      } catch (err) {
        job.tries++
        if (job.tries < 3) {
          await sleep(1500 * job.tries)
          queue.push(job)
        } else {
          const why = String(err.message).split(' from ')[0]
          failures[why] = (failures[why] || 0) + 1
        }
      }
    }
  }
  const t0 = Date.now()
  Promise.all(Array.from({ length: ENRICH_CONCURRENCY }, worker)).then(() => {
    const failed = Object.values(failures).reduce((a, b) => a + b, 0)
    console.log(`[live] GDG details warmed: ${events.length - failed}/${events.length} in ${Math.round((Date.now() - t0) / 1000)}s` +
      (failed ? ` (failed: ${JSON.stringify(failures)})` : ''))
  })
}

export async function getGdgEvents({ force = false } = {}) {
  const { value, at, stale } = await gdgList('_', { force })
  const events = value.map((e) => {
    const d = gdgDetail.peek(String(e.remoteId))
    return d ? { ...e, ...d, venue: d.venue || e.venue } : e
  })
  return { events, updatedAt: at, stale }
}

export async function getGdgDetail(remoteId) {
  const { value } = await gdgDetail(String(remoteId))
  return value
}

// ---------- Devfolio ----------
function normalizeDevfolio(s) {
  const start = ist(s.starts_at)
  const end = s.ends_at ? ist(s.ends_at) : null
  const hs = s.hackathon_setting || {}
  const online = Boolean(s.is_online)
  return {
    id: `df-${s.uuid}`,
    remoteId: s.uuid,
    source: 'devfolio',
    title: s.name,
    tagline: s.tagline || '',
    type: 'Hackathon',
    category: 'hackathon',
    mode: online ? 'Online' : 'In-person',
    city: online ? 'Online' : normalizeCity(s.city) || 'India',
    rawCity: s.city || '',
    state: s.state || '',
    venue: online ? 'Online' : s.location || s.city || 'TBA',
    date: start.date,
    time: start.time,
    endDate: end?.date || null,
    endTime: end?.time || null,
    organizerChapter: s.hosted_by?.name || s.name,
    capacity: null,
    availableSeats: null,
    registered: s.participants_count || 0,
    teamSize: s.team_size ? `${s.team_min || 1}–${s.team_size}` : null,
    description: stripMarkdown(s.desc || s.tagline || ''),
    shortDescription: s.tagline || '',
    image: s.cover_img || null,
    logo: hs.logo || null,
    status: 'Published',
    externalUrl: `https://${hs.subdomain || s.slug}.devfolio.co/`,
    site: hs.site || null,
    registrationDeadline: hs.reg_ends_at ? ist(hs.reg_ends_at).date : null,
    prizes: (s.prizes || []).slice(0, 4).map((p) => p.name).filter(Boolean),
    tags: [...(s.themes || []).map((t) => t?.name || t).filter((t) => typeof t === 'string'), online ? 'Online' : s.city].filter(Boolean),
    enriched: true,
  }
}

const devfolioList = cached(LIST_TTL, async () => {
  const data = await getJSON(`${DEVFOLIO}/search/hackathons`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'application_open', from: 0, size: 60 }),
  })
  return (data.hits?.hits || [])
    .map((h) => h._source)
    .filter((s) => s && !s.private && (s.country === 'India' || (s.is_online && !s.country)))
    .map(normalizeDevfolio)
    .filter(isCurrent)
    .sort((a, b) => a.date.localeCompare(b.date))
})

export async function getDevfolioEvents({ force = false } = {}) {
  const { value, at, stale } = await devfolioList('_', { force })
  return { events: value, updatedAt: at, stale }
}
