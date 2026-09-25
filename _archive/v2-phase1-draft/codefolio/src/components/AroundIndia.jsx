import { useCallback, useEffect, useState } from 'react'
import Icon from './Icon'
import { EmptyState, ErrorState, Skeleton } from './ui'
import { fetchAroundIndia } from '../lib/liveApi'
import { dateParts, formatTime, todayISO } from '../utils/format'

// External listings (GDG Community + Devfolio). Always link out; never presented
// as Codefolio-hosted events.
export default function AroundIndia({ limit = 8, category }) {
  const [state, setState] = useState({ loading: true, error: null, items: [] })

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }))
    try {
      const all = await fetchAroundIndia()
      const today = todayISO()
      const items = all.filter((e) => e.date >= today && (!category || e.category === category)).slice(0, limit)
      setState({ loading: false, error: null, items })
    } catch (e) {
      setState({ loading: false, error: e.message, items: [] })
    }
  }, [limit, category])

  useEffect(() => {
    load()
  }, [load])

  if (state.loading) {
    return (
      <ul className="listing" aria-busy="true" aria-label="Loading listings">
        {Array.from({ length: Math.min(limit, 5) }, (_, i) => (
          <li key={i} className="listing__row">
            <Skeleton w={44} h={40} />
            <span style={{ flex: 1, display: 'grid', gap: 6 }}>
              <Skeleton w="60%" />
              <Skeleton w="35%" h={11} />
            </span>
          </li>
        ))}
      </ul>
    )
  }
  if (state.error) return <ErrorState title="Listings are unavailable right now" message={state.error} onRetry={load} />
  if (!state.items.length) return <EmptyState icon="calendar" title="No upcoming listings right now" />

  return (
    <ul className="listing">
      {state.items.map((e) => {
        const { day, month } = dateParts(e.date)
        return (
          <li key={e.id}>
            <a className="listing__row" href={e.externalUrl} target="_blank" rel="noopener noreferrer">
              <span className="listing__date" aria-hidden="true">
                <span>{month}</span>
                <strong>{day}</strong>
              </span>
              <span className="listing__main">
                <span className="listing__title">{e.title}</span>
                <span className="listing__meta">
                  {e.organizerChapter} · {e.mode === 'Online' ? 'Online' : e.city || e.rawCity} · {formatTime(e.time)}
                </span>
              </span>
              <span className="listing__src">
                {e.source === 'gdg' ? 'GDG' : 'Devfolio'}
                <Icon name="external" size={13} />
              </span>
            </a>
          </li>
        )
      })}
    </ul>
  )
}
