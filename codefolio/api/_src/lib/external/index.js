// Wiring for external listing sources. Today: Unstop (see unstopProvider.js).
// Another source = another provider object with the same shape
// ({ name, label, mode, configured, mock, allowedHosts, describe(), fetchRecords() }).
import { config } from '../config.js'
import { admin } from '../supabase.js'
import { createCatalog } from './catalog.js'
import { createSupabaseStore } from './store.js'
import { createUnstopProvider } from './unstopProvider.js'

export const unstopCatalog = createCatalog({
  provider: createUnstopProvider({ ...config.unstop, production: config.production }),
  store: admin && config.unstop.persist ? createSupabaseStore(admin) : null,
  cfg: config.unstop,
})

// Optional periodic sync (UNSTOP_SYNC_INTERVAL_MINUTES). Without it, listings
// refresh lazily when a request finds the cache older than the TTL.
export function startExternalSync() {
  const p = unstopCatalog.provider
  if (!p.configured) {
    console.info(`[unstop] provider: ${p.mode}${p.describe().note ? ` — ${p.describe().note}` : ''}`)
    return
  }
  console.info(`[unstop] provider: ${p.mode}${p.mock ? ' (MOCK DATA — local development only)' : ''}`)
  const run = () => unstopCatalog.sync().catch(() => {}) // failures are logged by the catalog
  run()
  if (config.unstop.syncIntervalMs) setInterval(run, config.unstop.syncIntervalMs).unref()
}
