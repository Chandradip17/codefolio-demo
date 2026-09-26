// Unstop provider. Unstop publishes no public developer API or data feed
// (verified Sept 2026: no developer docs/RSS, and unstop.com/robots.txt disallows
// /api/* for automated clients), so this provider never calls unstop.com itself.
//
// Modes (UNSTOP_PROVIDER):
//   off  — default. Nothing is fetched; the UI simply shows no Unstop listings.
//   feed — reads a JSON feed from UNSTOP_FEED_URL (official Unstop API access or a
//          licensed partner feed) in the contract documented in docs/unstop-integration.md.
//   mock — clearly labelled mock listings for local development. Refused in production.

export class ProviderError extends Error {
  constructor(kind, message, { retryAfterMs = null, status = null } = {}) {
    super(message)
    this.kind = kind // not_configured | rate_limited | timeout | http | network | malformed
    this.retryAfterMs = retryAfterMs
    this.status = status
  }
}

const MAX_PAGES = 10
const UA = 'CodefolioBot/1.0 (+community event calendar)'
const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms))

function retryAfterMs(res) {
  const h = res.headers.get('retry-after')
  if (!h) return 60_000
  const secs = Number(h)
  const ms = Number.isFinite(secs) ? secs * 1000 : Date.parse(h) - Date.now()
  return Math.min(Math.max(ms || 60_000, 5_000), 60 * 60 * 1000)
}

export function createUnstopProvider(cfg, { fetchImpl = globalThis.fetch, sleep = defaultSleep, log = console } = {}) {
  const mode = cfg.provider
  const mockBlocked = mode === 'mock' && cfg.production
  const configured = mode === 'feed' ? Boolean(cfg.feedUrl) : mode === 'mock' ? !mockBlocked : false

  const feedHost = (() => {
    try {
      return cfg.feedUrl ? new URL(cfg.feedUrl).host : null
    } catch {
      return null
    }
  })()

  async function getPage(url) {
    let lastErr
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt) await sleep(500 * 2 ** (attempt - 1)) // 0.5s, 1s
      let res
      try {
        res = await fetchImpl(url, {
          headers: {
            accept: 'application/json',
            'user-agent': UA,
            ...(cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {}),
          },
          signal: AbortSignal.timeout(cfg.timeoutMs),
        })
      } catch (e) {
        lastErr =
          e?.name === 'TimeoutError' || e?.name === 'AbortError'
            ? new ProviderError('timeout', `Feed did not respond within ${cfg.timeoutMs} ms`)
            : new ProviderError('network', `Network error: ${e?.cause?.code || e?.message || 'unknown'}`)
        continue
      }
      if (res.status === 429) {
        // Respect the provider's limit: no retries, back off until Retry-After.
        throw new ProviderError('rate_limited', 'Feed rate limit reached', { retryAfterMs: retryAfterMs(res), status: 429 })
      }
      if (res.status >= 500) {
        lastErr = new ProviderError('http', `Feed returned HTTP ${res.status}`, { status: res.status })
        continue
      }
      if (!res.ok) throw new ProviderError('http', `Feed returned HTTP ${res.status}`, { status: res.status }) // 4xx: don't retry
      try {
        return await res.json()
      } catch {
        throw new ProviderError('malformed', 'Feed response was not valid JSON')
      }
    }
    throw lastErr
  }

  async function fetchFeed() {
    const records = []
    let url = cfg.feedUrl
    for (let page = 0; url && page < MAX_PAGES; page++) {
      const body = await getPage(url)
      const batch = Array.isArray(body) ? body : body?.events ?? body?.items ?? body?.data
      if (!Array.isArray(batch)) throw new ProviderError('malformed', 'Feed response has no events array')
      records.push(...batch)
      if (records.length >= cfg.maxEvents * 1.5) break
      // Follow pagination only on the same host.
      const next = !Array.isArray(body) && typeof body?.next === 'string' ? body.next : null
      url = next && new URL(next, url).host === feedHost ? new URL(next, url).toString() : null
    }
    return records
  }

  return {
    name: 'unstop',
    label: 'Unstop',
    mode,
    configured,
    mock: mode === 'mock' && configured,
    allowedHosts: cfg.allowedHosts,
    describe() {
      return {
        mode,
        configured,
        mock: mode === 'mock' && configured,
        feedHost, // never the full URL (may contain tokens) and never the key
        hasApiKey: Boolean(cfg.apiKey),
        note: mockBlocked
          ? 'Mock mode is disabled in production.'
          : !configured
            ? 'Not connected. Unstop has no public API; set UNSTOP_PROVIDER=feed with an authorized UNSTOP_FEED_URL.'
            : null,
      }
    },
    async fetchRecords() {
      if (!configured) throw new ProviderError('not_configured', this.describe().note)
      if (mode === 'mock') return mockRecords()
      return fetchFeed()
    },
  }
}

// ---------- mock data (local development only; every record says so) ----------
function mockRecords(now = Date.now()) {
  const day = 86400000
  const at = (d, h = 10) => new Date(Math.floor((now + d * day) / day) * day + (h - 5.5) * 3600000).toISOString()
  const mk = (i, o) => ({
    id: `mock-${i}`,
    url: `https://example.com/mock-unstop/${i}`,
    organizer: 'Mock Organizer (not real)',
    description: 'MOCK DATA for local development. This listing is not real and does not exist on Unstop.',
    ...o,
    title: `[Mock] ${o.title}`,
  })
  return [
    mk(1, { title: 'AI for Bharat Hackathon', type: 'hackathon', mode: 'online', location: 'Online', startAt: at(9), endAt: at(10, 18), registrationDeadline: at(6, 23), prize: '₹1,50,000 (mock)', eligibility: 'Students and professionals (mock)', skills: ['Machine Learning', 'Python'], tags: ['AI', 'GenAI'] }),
    mk(2, { title: 'Web Dev Sprint', type: 'hackathon', mode: 'offline', location: 'Bengaluru', startAt: at(14), endAt: at(15, 18), registrationDeadline: at(2, 23), prize: '₹50,000 (mock)', skills: ['React', 'Node.js'], tags: ['Web development'] }),
    mk(3, { title: 'Data Structures Coding Challenge', type: 'competition', mode: 'online', location: 'Online', startAt: at(4), registrationDeadline: at(3, 23), prize: 'Internship interviews (mock)', skills: ['DSA', 'C++'], tags: ['Coding competition'] }),
    mk(4, { title: 'Startup Pitch Competition', type: 'competition', mode: 'hybrid', location: 'Pune', startAt: at(20), registrationDeadline: at(12, 23), prize: '₹2,00,000 seed grant (mock)', eligibility: 'Early-stage founders (mock)', tags: ['Startup', 'Pitching'] }),
    mk(5, { title: 'Cloud Native Workshop', type: 'workshop', mode: 'online', location: 'Online', startAt: at(5, 18), endAt: at(5, 20), registrationDeadline: at(5, 12), skills: ['Kubernetes', 'Docker'], tags: ['Cloud', 'Workshop'] }),
    mk(6, { title: 'Machine Learning Webinar', type: 'webinar', mode: 'online', location: 'Online', startAt: at(3, 19), tags: ['Machine learning', 'Webinar'] }),
    mk(7, { title: 'Tech Leaders Conference', type: 'conference', mode: 'offline', location: 'Hyderabad', startAt: at(25), endAt: at(26, 18), registrationDeadline: at(22, 23), tags: ['Tech event', 'Networking'] }),
    mk(8, { title: 'Closed Registration Hackathon', type: 'hackathon', mode: 'online', location: 'Online', startAt: at(8), registrationDeadline: at(-1, 23), tags: ['AI'] }),
  ]
}
