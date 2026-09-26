// Supabase persistence for external listings: durable cache + deduplication.
// Writes go through upsert_external_events(), which keys on (source, identity_key),
// so repeated syncs update rows instead of creating duplicates.
import { publicId } from './normalize.js'

const CHUNK = 200
const MAX_RAW_CHARS = 20000

const rowToItem = (r) => ({
  id: publicId(r.source, r.identity_key),
  identityKey: r.identity_key,
  source: r.source,
  externalId: r.external_id,
  title: r.title,
  description: r.description,
  organizer: r.organizer,
  logo: r.logo_url,
  banner: r.banner_url,
  eventType: r.event_type,
  mode: r.mode,
  location: r.location,
  startAt: r.start_at,
  endAt: r.end_at,
  registrationDeadline: r.registration_deadline,
  registrationUrl: r.registration_url,
  sourceUrl: r.source_url,
  prize: r.prize,
  eligibility: r.eligibility,
  skills: r.skills || [],
  tags: r.tags || [],
  fetchedAt: r.fetched_at,
  mock: false,
})

const toRow = ({ raw, ...item }) => {
  const rawJson = raw ? JSON.stringify(raw) : ''
  return { ...item, raw: rawJson && rawJson.length <= MAX_RAW_CHARS ? raw : null }
}

export function createSupabaseStore(admin) {
  return {
    async load(source, limit) {
      const { data, error } = await admin
        .from('external_events')
        .select('*')
        .eq('source', source)
        .or(`end_at.is.null,end_at.gte.${new Date().toISOString()}`)
        .order('registration_deadline', { ascending: true, nullsFirst: false })
        .limit(limit)
      if (error) throw new Error(error.message)
      return data.map(rowToItem)
    },
    async save(source, items) {
      const total = { inserted: 0, updated: 0 }
      for (let i = 0; i < items.length; i += CHUNK) {
        const { data, error } = await admin.rpc('upsert_external_events', { p_source: source, p_items: items.slice(i, i + CHUNK).map(toRow) })
        if (error) throw new Error(`database upsert failed: ${error.message}`)
        total.inserted += data.inserted
        total.updated += data.updated
      }
      return total
    },
    async recordRun(source, { ok, fetched = 0, upserted = 0, skipped = 0, error = null }) {
      const { error: e } = await admin.rpc('record_external_sync', { p_source: source, p_ok: ok, p_fetched: fetched, p_upserted: upserted, p_skipped: skipped, p_error: error })
      if (e) throw new Error(e.message)
    },
    async lastRun(source) {
      const { data, error } = await admin.from('external_sources').select('*').eq('source', source).maybeSingle()
      if (error) throw new Error(error.message)
      return data
        ? { lastSyncAt: data.last_sync_at, lastSuccessAt: data.last_success_at, fetched: data.fetched, upserted: data.upserted, skipped: data.skipped, lastError: data.last_error }
        : null
    },
  }
}
