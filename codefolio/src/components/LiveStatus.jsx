import { useEffect, useState } from 'react'
import Icon from './Icon'
import { useData } from '../context/DataContext'
import { cx, timeAgo } from '../utils/format'

// "Live · synced 2 min ago · Refresh" indicator for the GDG + Devfolio feeds.
export default function LiveStatus({ className }) {
  const { gdg, devfolio, gdgStatus, dfStatus, refreshLive } = useData()
  const [, tick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => tick((x) => x + 1), 30000)
    return () => clearInterval(t)
  }, [])

  const loading = gdgStatus.loading || dfStatus.loading
  const updated = Math.max(gdgStatus.updatedAt || 0, dfStatus.updatedAt || 0)
  const failed = [gdgStatus.error && 'GDG', dfStatus.error && 'Devfolio'].filter(Boolean)

  return (
    <div className={cx('live-status', failed.length && 'has-error', className)} role="status">
      <span className={cx('live-dot', loading && 'is-syncing', failed.length === 2 && 'is-off')} aria-hidden="true" />
      <span>
        {loading ? (
          'Syncing live feeds…'
        ) : failed.length ? (
          <>Couldn&apos;t reach {failed.join(' & ')}</>
        ) : (
          <>
            <strong>{gdg.length}</strong> GDG · <strong>{devfolio.length}</strong> Devfolio live
            {updated > 0 && <span className="live-status__ago"> · synced {timeAgo(updated)}</span>}
          </>
        )}
      </span>
      <button className="icon-btn icon-btn--sm" onClick={() => refreshLive({ force: true })} disabled={loading} aria-label="Refresh live events">
        <Icon name="refresh" size={15} className={loading ? 'spin' : undefined} />
      </button>
    </div>
  )
}
