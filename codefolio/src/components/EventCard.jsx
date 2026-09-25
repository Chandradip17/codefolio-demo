import { useState } from 'react'
import Icon from './Icon'
import { Button, CategoryBadge, SourceBadge } from './ui'
import { useOpenEvent } from '../hooks/useOpenEvent'
import { compactNumber, cx, dateParts, formatDate, formatTime, todayISO } from '../utils/format'
import { fallbackImage } from '../data/images'

export function seatInfo(event) {
  if (event.status === 'Cancelled') return { label: 'Cancelled', tone: 'danger', pct: 0 }
  if (event.source === 'devfolio') {
    return { label: event.registered ? `${compactNumber(event.registered)} registered` : 'Applications open', tone: 'live', pct: null }
  }
  if (event.capacity == null || event.availableSeats == null) {
    return { label: event.registered ? `${compactNumber(event.registered)} going` : 'Free registration', tone: 'live', pct: null }
  }
  const left = event.availableSeats
  const pct = event.capacity ? Math.round(((event.capacity - left) / event.capacity) * 100) : 0
  if (left <= 0) return { label: 'Sold Out', tone: 'danger', pct: 100 }
  if (left <= Math.max(10, event.capacity * 0.1)) return { label: `Only ${left} seats left`, tone: 'warn', pct }
  return { label: `${left} of ${event.capacity} seats left`, tone: 'ok', pct }
}

export default function EventCard({ event, compact }) {
  const openEvent = useOpenEvent()
  const [imgFailed, setImgFailed] = useState(false)
  const { day, month } = dateParts(event.date)
  const seats = seatInfo(event)
  const soldOut = seats.label === 'Sold Out'
  const cancelled = event.status === 'Cancelled'
  const ongoing = event.date < todayISO()
  const img = imgFailed ? fallbackImage(event.category, event.id) : event.image

  return (
    <article className={cx('ticket', compact && 'ticket--compact', cancelled && 'is-cancelled')}>
      <div className="ticket__media">
        <img src={img} alt="" loading="lazy" onError={() => setImgFailed(true)} />
        <div className="ticket__badges">
          <CategoryBadge category={event.category} />
          <SourceBadge event={event} />
          {ongoing && <span className="badge badge--warn">Ongoing</span>}
        </div>
        <div className="ticket__date" aria-hidden="true">
          <span>{month}</span>
          <strong>{day}</strong>
        </div>
      </div>

      <div className="ticket__body">
        <p className="ticket__chapter">
          <Icon name="users" size={14} /> <span>{event.organizerChapter}</span>
        </p>
        <h3 className="ticket__title">
          <button className="ticket__title-btn" onClick={() => openEvent(event.id)}>
            {event.title}
          </button>
        </h3>
        <ul className="ticket__meta">
          <li>
            <Icon name="calendar" size={15} />
            <span>
              {ongoing && event.endDate
                ? `Ongoing · ends ${formatDate(event.endDate, { year: false })}`
                : `${formatDate(event.date, { weekday: true, year: false })} · ${formatTime(event.time)}`}
            </span>
          </li>
          {!(event.mode === 'Online' && (!event.venue || event.venue === 'Online') && (!event.city || event.city === 'Online')) && (
            <li>
              <Icon name="pin" size={15} />
              <span className="truncate">
                {event.venue && event.venue !== event.city && event.venue !== 'Online' ? event.venue : event.city || event.venue}
              </span>
            </li>
          )}
          <li>
            <Icon name={event.mode === 'Online' ? 'wifi' : 'building'} size={15} />
            <span>
              {event.mode}
              {event.hybrid ? ' + Online' : ''}
              {event.city && event.mode === 'In-person' && !String(event.venue).includes(event.city) ? ` · ${event.city}` : ''}
            </span>
          </li>
        </ul>
      </div>

      <div className="ticket__perf" aria-hidden="true" />

      <div className="ticket__stub">
        <div className="ticket__seats">
          <span className={cx('seat-label', `seat-label--${seats.tone}`)}>
            {seats.tone === 'live' ? <span className="live-dot" aria-hidden="true" /> : <Icon name="ticket" size={14} />}
            {seats.label}
          </span>
          {seats.pct != null && (
            <span className="meter" aria-hidden="true">
              <span className={cx('meter__fill', `meter__fill--${seats.tone}`)} style={{ width: `${seats.pct}%` }} />
            </span>
          )}
        </div>
        <Button
          size="sm"
          variant={soldOut || cancelled ? 'secondary' : 'primary'}
          onClick={() => openEvent(event.id)}
          iconRight="arrowRight"
          aria-label={`Details and booking for ${event.title}`}
        >
          {event.source === 'codefolio' ? 'Details & Book' : 'Details'}
        </Button>
      </div>
    </article>
  )
}
