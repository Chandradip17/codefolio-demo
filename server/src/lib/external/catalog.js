// A cached catalog of one external source's listings.
//
//   fresh cache (age < TTL)     → served immediately
//   expired cache               → served immediately (stale: true) while one refresh runs
//   no cache                    → wait for the refresh
//   provider unavailable        → last good copy (memory, else database) with stale: true
//   rate limited (429)          → no upstream calls until Retry-After passes
//
// Refreshes are shared (one in flight at a time) and at least MIN_GAP_MS apart,
// so browsers never cause extra upstream traffic.
import { ProviderError } from './unstopProvider.js'
import { normalizeBatch, statusOf } from './normalize.js'

const MIN_GAP_MS = 30_000

export function createCatalog({ provider, store = null, cfg, log = console, now = () => Date.now() }) {
  const tag = `[${provider.name}]`
  const persist = Boolean(store) && !provider.mock // mock data never reaches the database
  const state = { items: [], updatedAt: null, loaded: false, inflight: null, lastError: null, lastAttemptAt: 0, blockedUntil: 0, lastRun: null, lastHitLog: 0 }

  async function ensureLoaded() {
    if (state.loaded) return
    state.loaded = true
    if (!persist || !provider.configured) return
    try {
      const rows = await store.load(provider.name, cfg.maxEvents)
      if (rows.length && !state.items.length) {
        state.items = rows
        state.updatedAt = Math.max(...rows.map((r) => Date.parse(r.fetchedAt) || 0))
        log.info?.(`${tag} restored ${rows.length} events from the database`)
      }
    } catch (e) {
      log.warn(`${tag} could not read the database cache: ${e.message}`)
    }
  }

  function sync({ force = false } = {}) {
    if (!provider.configured) return Promise.reject(new ProviderError('not_configured', provider.describe().note))
    if (state.inflight) return state.inflight
    const t = now()
    if (t < state.blockedUntil) {
      return Promise.reject(new ProviderError('rate_limited', `Rate limited; next attempt after ${new Date(state.blockedUntil).toISOString()}`))
    }
    if (t - state.lastAttemptAt < MIN_GAP_MS && state.lastRun && !state.lastError) return Promise.resolve(state.lastRun)
    if (force) log.info?.(`${tag} manual sync requested`)

    state.inflight = (async () => {
      log.info?.(`${tag} fetching events`)
      const fetchedAt = new Date(now()).toISOString()
      const records = await provider.fetchRecords()
      const { items, skipped } = normalizeBatch(records, { source: provider.name, allowedHosts: provider.allowedHosts, fetchedAt, mock: provider.mock })
      for (const s of skipped.slice(0, 20)) log.warn(`${tag} skipped invalid event #${s.index}${s.id != null ? ` (id ${String(s.id).slice(0, 40)})` : ''}: ${s.reason}`)
      if (skipped.length > 20) log.warn(`${tag} …and ${skipped.length - 20} more invalid events`)
      if (records.length && !items.length) throw new ProviderError('malformed', `All ${records.length} events were invalid`)
      const kept = items
        .filter((i) => statusOf(i, now()) !== 'ended')
        .sort((a, b) => (a.registrationDeadline || '9').localeCompare(b.registrationDeadline || '9'))
        .slice(0, cfg.maxEvents)
      let written = { inserted: 0, updated: 0 }
      if (persist) written = await store.save(provider.name, kept)
      state.items = kept
      state.updatedAt = now()
      state.lastError = null
      state.lastRun = { at: new Date(state.updatedAt).toISOString(), fetched: records.length, kept: kept.length, skipped: skipped.length, ...written }
      log.info?.(`${tag} fetched ${records.length} events (${kept.length} kept, ${skipped.length} skipped)`)
      if (persist) await store.recordRun(provider.name, { ok: true, fetched: records.length, upserted: kept.length, skipped: skipped.length }).catch(() => {})
      return state.lastRun
    })()
      .catch(async (err) => {
        state.lastError = { kind: err.kind || 'error', message: err.message, at: new Date(now()).toISOString() }
        if (err.kind === 'rate_limited') state.blockedUntil = now() + (err.retryAfterMs || 60_000)
        log.warn(`${tag} provider unavailable: ${err.message}`)
        if (persist) await store.recordRun(provider.name, { ok: false, error: `${err.kind || 'error'}: ${err.message}` }).catch(() => {})
        throw err
      })
      .finally(() => {
        state.inflight = null
        state.lastAttemptAt = now()
      })
    return state.inflight
  }

  // Current listings plus freshness info. Throws only when there's nothing to serve.
  async function snapshot() {
    await ensureLoaded()
    if (!provider.configured) return { items: [], configured: false, stale: false, updatedAt: null }
    const age = state.updatedAt ? now() - state.updatedAt : Infinity
    if (age < cfg.cacheTtlMs) {
      if (now() - state.lastHitLog > 60_000) {
        state.lastHitLog = now()
        log.info?.(`${tag} cache hit (${state.items.length} events, age ${Math.round(age / 1000)}s)`)
      }
      return { items: state.items, configured: true, stale: false, updatedAt: state.updatedAt }
    }
    if (state.items.length) {
      sync().catch(() => {}) // stale-while-revalidate
      return { items: state.items, configured: true, stale: true, updatedAt: state.updatedAt }
    }
    await sync()
    return { items: state.items, configured: true, stale: false, updatedAt: state.updatedAt }
  }

  async function status() {
    let persisted = null
    if (persist) persisted = await store.lastRun(provider.name).catch(() => null)
    return {
      source: provider.name,
      provider: provider.describe(),
      cache: {
        size: state.items.length,
        updatedAt: state.updatedAt ? new Date(state.updatedAt).toISOString() : null,
        ttlSeconds: Math.round(cfg.cacheTtlMs / 1000),
        fresh: Boolean(state.updatedAt) && now() - state.updatedAt < cfg.cacheTtlMs,
        refreshing: Boolean(state.inflight),
        rateLimitedUntil: state.blockedUntil > now() ? new Date(state.blockedUntil).toISOString() : null,
      },
      lastRun: state.lastRun,
      lastError: state.lastError,
      persisted,
      persistence: persist ? 'database' : provider.mock ? 'memory only (mock data is never stored)' : 'memory only',
      syncIntervalMinutes: cfg.syncIntervalMs ? cfg.syncIntervalMs / 60000 : 0,
    }
  }

  return { provider, snapshot, sync, status, _state: state }
}

// ---------- querying (search, filters, sort, pagination) ----------
const words = (s) => String(s || '').toLowerCase().split(/\s+/).filter(Boolean)

export function queryItems(items, p, nowMs = Date.now()) {
  const qWords = words(p.q)
  const loc = (p.location || '').toLowerCase()
  let list = items.map((i) => ({ ...i, status: statusOf(i, nowMs) }))
  list = list.filter((i) => {
    switch (p.status) {
      case 'all':
        break
      case 'closing_soon':
        if (i.status !== 'closing_soon') return false
        break
      case 'upcoming':
        if (!i.startAt || Date.parse(i.startAt) <= nowMs || i.status === 'ended') return false
        break
      case 'closed':
        if (i.status !== 'closed') return false
        break
      default: // open: registration still open
        if (i.status !== 'open' && i.status !== 'closing_soon') return false
    }
    if (p.category && p.category !== 'all' && i.eventType !== p.category) return false
    if (p.mode && p.mode !== 'all' && i.mode !== p.mode) return false
    if (loc && !i.location.toLowerCase().includes(loc)) return false
    if (qWords.length) {
      const hay = `${i.title} ${i.organizer} ${i.eventType} ${i.location} ${i.tags.join(' ')} ${i.skills.join(' ')} ${i.description}`.toLowerCase()
      if (!qWords.every((w) => hay.includes(w))) return false
    }
    return true
  })
  const nullsLast = (a, b) => (a || '9999').localeCompare(b || '9999')
  const sorters = {
    deadline: (a, b) => nullsLast(a.registrationDeadline, b.registrationDeadline) || a.title.localeCompare(b.title),
    start: (a, b) => nullsLast(a.startAt, b.startAt) || a.title.localeCompare(b.title),
    recent: (a, b) => b.fetchedAt.localeCompare(a.fetchedAt) || a.title.localeCompare(b.title),
    title: (a, b) => a.title.localeCompare(b.title),
  }
  list.sort(sorters[p.sort] || sorters.deadline)
  const total = list.length
  const start = (p.page - 1) * p.limit
  return { items: list.slice(start, start + p.limit), total, hasMore: start + p.limit < total }
}

// What the browser gets (no raw provider payload, no internal keys).
export const toPublic = ({ raw, identityKey, ...item }) => {
  void raw
  void identityKey
  return item
}
