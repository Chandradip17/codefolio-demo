// Small realtime UI pieces: connection indicator and a number that flashes when it changes.
import { useEffect, useRef, useState } from 'react'
import { useData } from '../context/DataContext'
import { useNow } from '../hooks/useNow'
import { cx } from '../utils/format'

const LABELS = {
  live: 'Live',
  connecting: 'Connecting…',
  reconnecting: 'Reconnecting…',
  offline: 'Offline',
}

function ago(ms) {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 5) return 'just now'
  if (s < 60) return `${s}s ago`
  const m = Math.round(s / 60)
  return m < 60 ? `${m}m ago` : `${Math.round(m / 60)}h ago`
}

export function LiveIndicator({ compact, className }) {
  const { live } = useData()
  const now = useNow(5000)
  const since = live.lastEventAt || live.connectedAt
  return (
    <span className={cx('live-ind', `live-ind--${live.status}`, compact && 'live-ind--compact', className)} role="status" aria-live="polite">
      <span className="live-ind__dot" aria-hidden="true" />
      <span className="live-ind__label">{LABELS[live.status] || live.status}</span>
      {!compact && live.status === 'live' && since && (
        <span className="live-ind__meta">· {live.lastEventAt ? `last update ${ago(now - live.lastEventAt)}` : 'waiting for updates'}</span>
      )}
    </span>
  )
}

// Renders a value and briefly highlights it whenever it changes (not on first render).
export function LiveNumber({ value, className, children }) {
  const prev = useRef(value)
  const [dir, setDir] = useState(null)
  useEffect(() => {
    if (prev.current === value) return
    setDir(typeof value === 'number' && typeof prev.current === 'number' ? (value > prev.current ? 'up' : 'down') : 'up')
    prev.current = value
    const t = setTimeout(() => setDir(null), 1400)
    return () => clearTimeout(t)
  }, [value])
  return <span className={cx('live-num', dir && `is-${dir}`, className)}>{children ?? value}</span>
}
