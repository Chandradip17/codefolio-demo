import { useMemo } from 'react'
import Icon from './Icon'
import { LiveNumber } from './LiveBits'
import { useAuth } from '../context/AuthContext'
import { useData } from '../context/DataContext'
import { useOpenEvent } from '../hooks/useOpenEvent'
import { cx, formatDate, todayISO } from '../utils/format'

// Bookable events you haven't booked, ranked by how full they are; seat counts update live.
export default function FillingFast({ limit = 4 }) {
  const { user } = useAuth()
  const { events, bookings } = useData()
  const openEvent = useOpenEvent()

  const list = useMemo(() => {
    const today = todayISO()
    const mine = new Set(bookings.filter((b) => b.userId === user?.id && b.status === 'Confirmed').map((b) => b.eventId))
    return events
      .filter((e) => e.status === 'Published' && e.date >= today && e.availableSeats > 0 && !mine.has(e.id))
      .map((e) => ({ e, fill: (e.capacity - e.availableSeats) / e.capacity, near: user?.city && e.city === user.city }))
      .sort((a, b) => Number(b.near) - Number(a.near) || b.fill - a.fill)
      .slice(0, limit)
  }, [events, bookings, user, limit])

  if (!list.length) return null
  return (
    <section className="card fast" aria-labelledby="fast-title">
      <div className="card__head">
        <h3 id="fast-title">Filling fast</h3>
        <span className="small muted">{user?.city ? `${user.city} first` : 'Across India'}</span>
      </div>
      <ul className="fast__list">
        {list.map(({ e, fill, near }) => {
          const pct = Math.round(fill * 100)
          const tone = e.availableSeats <= Math.max(5, e.capacity * 0.1) ? 'danger' : pct >= 60 ? 'warn' : 'ok'
          return (
            <li key={e.id}>
              <button type="button" className="fast__row" onClick={() => openEvent(e.id)}>
                <span className="fast__title">
                  <strong>{e.title}</strong>
                  <small>
                    {near && <Icon name="pin" size={12} />} {e.city} · {formatDate(e.date, { weekday: true, year: false })}
                  </small>
                </span>
                <span className={cx('fast__left', `fast__left--${tone}`)}>
                  <LiveNumber value={e.availableSeats} /> left
                </span>
                <span className="meter fast__meter" aria-hidden="true">
                  <span className={cx('meter__fill', `meter__fill--${tone}`)} style={{ width: `${pct}%` }} />
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
