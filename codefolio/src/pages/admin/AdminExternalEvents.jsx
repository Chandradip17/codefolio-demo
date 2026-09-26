import { useCallback, useEffect, useState } from 'react'
import Icon from '../../components/Icon'
import { Badge, Button, ErrorState } from '../../components/ui'
import { useData } from '../../context/DataContext'
import { useToast } from '../../context/ToastContext'
import * as api from '../../services/api'
import { formatDateTime } from '../../utils/format'

const when = (v) => (v ? formatDateTime(v) : '—')

// Platform admins: Unstop connection, cache and sync health + manual refresh.
// Listings are read-only here (they're replaced by every sync).
export default function AdminExternalEvents() {
  const toast = useToast()
  const { refreshLive } = useData()
  const [status, setStatus] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setError('')
    try {
      setStatus(await api.unstopStatus())
    } catch (e) {
      setError(e.message)
    }
  }, [])
  useEffect(() => {
    load()
  }, [load])

  async function sync() {
    setBusy(true)
    try {
      const { run, status: s } = await api.unstopSync()
      setStatus(s)
      toast({ title: 'Unstop synced', message: `${run.fetched} fetched · ${run.kept} kept · ${run.skipped} skipped` })
      refreshLive()
    } catch (e) {
      toast({ title: 'Sync failed', message: e.message, tone: 'error' })
      load()
    } finally {
      setBusy(false)
    }
  }

  const p = status?.provider
  const tone = !p ? 'neutral' : !p.configured ? 'neutral' : status.lastError ? 'danger' : p.mock ? 'warn' : 'success'
  const label = !p ? '' : !p.configured ? 'Not connected' : status.lastError ? 'Error' : p.mock ? 'Mock data' : 'Connected'

  return (
    <>
      <header className="dash-head">
        <div>
          <p className="eyebrow">Platform admin</p>
          <h1>External events</h1>
          <p className="muted">Listings from outside platforms shown on the Events page. They’re read-only and refreshed from the source.</p>
        </div>
        <Button icon="refresh" onClick={sync} loading={busy} disabled={!p?.configured}>
          Refresh now
        </Button>
      </header>

      {error ? (
        <ErrorState message={error} onRetry={load} />
      ) : !status ? (
        <div className="skeleton" style={{ height: 260, borderRadius: 20 }} />
      ) : (
        <>
          <div className="event-summary card">
            <div>
              <strong>Unstop</strong> <Badge tone={tone}>{label}</Badge>
              <p className="small muted">
                Mode: <code>{p.mode}</code>
                {p.feedHost ? ` · feed ${p.feedHost}` : ''}
                {p.configured && !p.mock ? ` · API key ${p.hasApiKey ? 'set' : 'not set'}` : ''} · stored in {status.persistence}
              </p>
            </div>
            <div className="event-summary__nums">
              <span>
                <strong>{status.cache.size}</strong> listings
              </span>
              <span>
                <strong>{status.lastRun?.fetched ?? status.persisted?.fetched ?? 0}</strong> fetched
              </span>
              <span>
                <strong>{status.lastRun?.skipped ?? status.persisted?.skipped ?? 0}</strong> skipped
              </span>
              <span>
                <strong>{Math.round(status.cache.ttlSeconds / 60)}m</strong> cache
              </span>
            </div>
          </div>

          {p.note && (
            <p className="form-error" role="status">
              <Icon name="info" size={15} /> {p.note}
            </p>
          )}

          <div className="chart-grid">
            <section className="card" aria-labelledby="sync-h">
              <div className="card__head">
                <h3 id="sync-h">Sync</h3>
              </div>
              <dl className="answers__list">
                <div>
                  <dt>Last sync</dt>
                  <dd>{when(status.lastRun?.at || status.persisted?.lastSyncAt)}</dd>
                </div>
                <div>
                  <dt>Last successful sync</dt>
                  <dd>{when(status.lastRun?.at || status.persisted?.lastSuccessAt)}</dd>
                </div>
                <div>
                  <dt>Automatic sync</dt>
                  <dd>{status.syncIntervalMinutes ? `Every ${status.syncIntervalMinutes} minutes` : 'When the cache expires and someone opens Events'}</dd>
                </div>
                <div>
                  <dt>Last error</dt>
                  <dd className="break">
                    {status.lastError ? `${status.lastError.message} (${when(status.lastError.at)})` : status.persisted?.lastError || 'None'}
                  </dd>
                </div>
              </dl>
            </section>
            <section className="card" aria-labelledby="cache-h">
              <div className="card__head">
                <h3 id="cache-h">Cache</h3>
              </div>
              <dl className="answers__list">
                <div>
                  <dt>Status</dt>
                  <dd>
                    {status.cache.refreshing ? 'Refreshing…' : status.cache.fresh ? 'Fresh' : status.cache.size ? 'Stale (served while refreshing)' : 'Empty'}
                  </dd>
                </div>
                <div>
                  <dt>Updated</dt>
                  <dd>{when(status.cache.updatedAt)}</dd>
                </div>
                <div>
                  <dt>Rate limit</dt>
                  <dd>{status.cache.rateLimitedUntil ? `Paused until ${when(status.cache.rateLimitedUntil)}` : 'OK'}</dd>
                </div>
              </dl>
            </section>
          </div>
          <p className="small muted table-foot">
            <Icon name="lock" size={14} /> Credentials stay on the server. See docs/unstop-integration.md to connect an authorized feed.
          </p>
        </>
      )}
    </>
  )
}
