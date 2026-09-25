import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { BarList, ColumnChart } from '../../components/Charts'
import Icon from '../../components/Icon'
import { Button, ErrorState, StatusBadge } from '../../components/ui'
import { useAuth } from '../../context/AuthContext'
import { useData } from '../../context/DataContext'
import { addDays, formatDate, formatDateTime, isPast } from '../../utils/format'
import { eventStatus } from './adminUtils'

export default function AdminOverview() {
  const { user } = useAuth()
  const { myEvents: events, bookings, catalogue, localStatus, loadLocal } = useData()

  const kpis = useMemo(() => {
    const upcoming = events.filter((e) => !isPast(e.date) && e.status !== 'Cancelled')
    return [
      { label: 'Total Events', value: events.length, icon: 'calendar', tone: 'indigo' },
      { label: 'Upcoming Events', value: upcoming.length, icon: 'zap', tone: 'saffron' },
      { label: 'Total Bookings', value: bookings.filter((b) => b.status !== 'Cancelled').length, icon: 'ticket', tone: 'green' },
      { label: 'Seats Available', value: upcoming.reduce((s, e) => s + e.availableSeats, 0).toLocaleString('en-IN'), icon: 'users', tone: 'indigo' },
      { label: 'Cancelled Events', value: events.filter((e) => e.status === 'Cancelled').length, icon: 'ban', tone: 'coral' },
    ]
  }, [events, bookings])

  // Seats booked per week, last 8 weeks (oldest → newest).
  const weekly = useMemo(() => {
    const now = new Date()
    const weeks = Array.from({ length: 8 }, (_, i) => {
      const end = addDays(now, -7 * (7 - i))
      const start = addDays(end, -7)
      return { start, end, value: 0 }
    })
    for (const b of bookings) {
      if (b.status === 'Cancelled') continue
      const t = new Date(b.bookedAt)
      const w = weeks.find((w) => t > w.start && t <= w.end)
      if (w) w.value += b.seats
    }
    return weeks.map((w, i) => ({
      label: i === 7 ? 'This wk' : `${7 - i}w ago`,
      full: `${formatDate(w.start, { year: false })} – ${formatDate(w.end, { year: false })}`,
      value: w.value,
    }))
  }, [bookings])

  const byCity = useMemo(() => {
    const m = {}
    for (const e of catalogue) if (e.city) m[e.city] = (m[e.city] || 0) + 1
    // Live GDG events span 40+ cities; an "Other" bucket would dwarf every
    // real bar, so show the top 10 and say so in the subtitle.
    return Object.entries(m)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 10)
      .map(([label, value]) => ({ label, value }))
  }, [catalogue])

  const recent = bookings.filter((b) => b.status === 'Confirmed').slice(0, 5)
  const upcoming = events
    .filter((e) => !isPast(e.date))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 4)

  if (localStatus.error) return <ErrorState message={localStatus.error} onRetry={loadLocal} />

  return (
    <>
      <header className="dash-head">
        <div>
          <p className="eyebrow">Admin Panel</p>
          <h1>Hi {user.name.split(' ')[0]}, here&apos;s your overview</h1>
          <p className="muted">Codefolio-hosted events, bookings and capacity at a glance.</p>
        </div>
        <Button to="/admin/events/new" icon="plus">
          Add Event
        </Button>
      </header>

      <div className="kpis kpis--5">
        {kpis.map((k) => (
          <div key={k.label} className={`kpi kpi--${k.tone}`}>
            <span className="kpi__icon" aria-hidden="true">
              <Icon name={k.icon} size={20} />
            </span>
            <strong className="kpi__value">{localStatus.loading ? '–' : k.value}</strong>
            <span className="kpi__label">{k.label}</span>
          </div>
        ))}
      </div>

      <div className="chart-grid">
        <ColumnChart title="Bookings over time" subtitle="Seats booked per week, last 8 weeks" data={weekly} valueLabel="Seats" />
        <BarList title="Events by city" subtitle="Top 10 cities · upcoming events across all sources" data={byCity} valueLabel="Events" />
      </div>

      <div className="chart-grid">
        <section className="card">
          <div className="card__head">
            <h3>Coming up</h3>
            <Link to="/admin/events" className="link link--arrow">
              Manage <Icon name="arrowRight" size={14} />
            </Link>
          </div>
          <ul className="mini-list">
            {upcoming.map((e) => (
              <li key={e.id}>
                <div>
                  <strong>{e.title}</strong>
                  <small>
                    {formatDate(e.date, { weekday: true, year: false })} · {e.city}
                  </small>
                </div>
                <span className="mini-list__right">
                  <span className="small muted">
                    {e.capacity - e.availableSeats}/{e.capacity}
                  </span>
                  <StatusBadge status={eventStatus(e)} />
                </span>
              </li>
            ))}
          </ul>
        </section>
        <section className="card">
          <div className="card__head">
            <h3>Latest bookings</h3>
            <Link to="/admin/bookings" className="link link--arrow">
              All bookings <Icon name="arrowRight" size={14} />
            </Link>
          </div>
          <ul className="mini-list">
            {recent.map((b) => (
              <li key={b.id}>
                <div>
                  <strong>{b.attendeeName}</strong>
                  <small className="truncate">{b.event.title}</small>
                </div>
                <span className="mini-list__right">
                  <code className="small">{b.bookingId}</code>
                  <small className="muted">{formatDateTime(b.bookedAt).split(',')[0]}</small>
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  )
}
