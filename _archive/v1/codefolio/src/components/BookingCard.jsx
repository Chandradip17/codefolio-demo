import { useEffect, useId, useState } from 'react'
import Icon from './Icon'
import { Badge, Button, CategoryBadge } from './ui'
import { LiveNumber } from './LiveBits'
import { useOpenEvent } from '../hooks/useOpenEvent'
import { fallbackImage } from '../data/images'
import { downloadIcs } from '../utils/calendar'
import { cx, dateParts, formatDate, formatTime, parseDate, todayISO } from '../utils/format'

// "Today", "Tomorrow", "In 5 days", "In 3 weeks"; null once it's in the past.
function countdown(iso) {
  const days = Math.round((parseDate(iso) - parseDate(todayISO())) / 86400000)
  if (days < 0) return null
  if (days === 0) return { label: 'Today', tone: 'hot' }
  if (days === 1) return { label: 'Tomorrow', tone: 'hot' }
  if (days < 14) return { label: `In ${days} days`, tone: days <= 3 ? 'hot' : 'soon' }
  return { label: `In ${Math.round(days / 7)} weeks`, tone: 'later' }
}

// Deterministic barcode bars from the booking ID (decorative).
function Barcode({ value }) {
  const bars = []
  for (const ch of value.replace(/[^A-Z0-9]/g, '')) {
    const c = ch.charCodeAt(0)
    bars.push((c % 3) + 1, ((c >> 2) % 2) + 1)
  }
  return (
    <span className="bcard__barcode" aria-hidden="true">
      {bars.map((w, i) => (
        <i key={i} style={{ '--w': w }} />
      ))}
    </span>
  )
}

function CopyId({ id }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 1600)
    return () => clearTimeout(t)
  }, [copied])
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(id)
      setCopied(true)
      return
    } catch {
      /* Clipboard API unavailable (non-secure origin, no permission): fall back below */
    }
    const ta = document.createElement('textarea')
    ta.value = id
    ta.setAttribute('readonly', '')
    ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none'
    document.body.appendChild(ta)
    ta.select()
    try {
      if (document.execCommand('copy')) setCopied(true)
    } finally {
      ta.remove()
    }
  }
  return (
    <button type="button" className={cx('bcard__copy', copied && 'is-copied')} onClick={copy} aria-label={copied ? 'Booking ID copied' : `Copy booking ID ${id}`}>
      <code>{id}</code>
      <Icon name={copied ? 'check' : 'copy'} size={14} />
      <span className="sr-only" aria-live="polite">
        {copied ? 'Copied' : ''}
      </span>
    </button>
  )
}

export default function BookingCard({ booking, liveEvent, onCancel }) {
  const openEvent = useOpenEvent()
  const titleId = useId()
  const [imgFailed, setImgFailed] = useState(false)

  const e = booking.event
  const { day, month, weekday } = dateParts(e.date)
  const past = e.date < todayISO()
  const eventCancelled = liveEvent?.status === 'Cancelled'
  const removed = !liveEvent
  const active = booking.status === 'Confirmed' && !eventCancelled
  const canCancel = active && !past
  const when = active ? countdown(e.date) : null

  // One visible state per ticket: stamp for finished/void tickets, badge otherwise.
  const stamp =
    booking.status === 'Cancelled'
      ? 'Cancelled'
      : eventCancelled
        ? 'Event cancelled'
        : booking.status === 'Attended'
          ? 'Attended'
          : past
            ? 'Past event'
            : null
  const image = imgFailed || !e.image ? fallbackImage(e.category, booking.eventId || booking.id) : e.image
  const where = e.mode === 'Online' ? (e.venue && e.venue !== 'Online' ? e.venue : 'Online') : e.venue

  return (
    <article className={cx('bcard', stamp && 'is-void', stamp === 'Attended' && 'is-attended')} aria-labelledby={titleId}>
      <div className="bcard__visual">
        <img src={image} alt="" loading="lazy" onError={() => setImgFailed(true)} />
        <div className="bcard__date" aria-hidden="true">
          <span>{month}</span>
          <strong>{day}</strong>
          <small>{weekday}</small>
        </div>
        {when && <span className={cx('bcard__when', `bcard__when--${when.tone}`)}>{when.label}</span>}
      </div>

      <div className="bcard__main">
        <div className="bcard__chips">
          <CategoryBadge category={e.category} />
          <Badge tone="neutral" icon={e.mode === 'Online' ? 'wifi' : 'building'} className="badge--outline">
            {e.mode}
          </Badge>
          {!stamp && (
            <Badge tone="success" icon="checkCircle" className="bcard__status">
              Confirmed
            </Badge>
          )}
        </div>
        <h3 className="bcard__title" id={titleId}>
          {e.title}
        </h3>
        <p className="bcard__org">
          <Icon name="users" size={14} /> {e.organizerChapter}
        </p>
        <dl className="bcard__facts">
          <div>
            <dt>
              <Icon name="calendar" size={15} />
              <span className="sr-only">Date and time</span>
            </dt>
            <dd>
              {formatDate(e.date, { weekday: true })} · {formatTime(e.time)}
              {liveEvent?.endTime && ` – ${formatTime(liveEvent.endTime)}`}
            </dd>
          </div>
          <div>
            <dt>
              <Icon name={e.mode === 'Online' ? 'wifi' : 'pin'} size={15} />
              <span className="sr-only">Venue</span>
            </dt>
            <dd className="truncate" title={where}>
              {where}
              {e.mode !== 'Online' && e.city && !where?.includes(e.city) ? `, ${e.city}` : ''}
            </dd>
          </div>
          {canCancel && liveEvent?.capacity > 0 && (
            <div>
              <dt>
                <Icon name="users" size={15} />
                <span className="sr-only">Seats</span>
              </dt>
              <dd className="bcard__live">
                <LiveNumber value={liveEvent.availableSeats} /> of {liveEvent.capacity} seats left
                <span className="bcard__live-tag">
                  <span className="live-ind__dot" aria-hidden="true" /> live
                </span>
              </dd>
            </div>
          )}
        </dl>
        {stamp && (
          <span className={cx('bcard__stamp', `bcard__stamp--${stamp === 'Attended' ? 'ok' : 'void'}`)} aria-hidden="true">
            {stamp}
          </span>
        )}
        {stamp && <p className="sr-only">Status: {stamp}</p>}
        {eventCancelled && booking.status === 'Confirmed' && (
          <p className="bcard__note">
            <Icon name="info" size={14} /> The organizer cancelled this event. No action is needed on your side.
          </p>
        )}
        <div className="bcard__actions">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => openEvent(booking.eventId)}
            disabled={removed}
            title={removed ? 'This event was removed by the organizer' : undefined}
          >
            View Details
          </Button>
          {canCancel && (
            <Button size="sm" variant="ghost" icon="calendarPlus" onClick={() => downloadIcs(booking, liveEvent?.endTime)} aria-label={`Add ${e.title} to calendar`}>
              Add to calendar
            </Button>
          )}
          {canCancel && (
            <Button size="sm" variant="danger-ghost" onClick={() => onCancel(booking)}>
              Cancel booking
            </Button>
          )}
        </div>
      </div>

      <div className="bcard__perf" aria-hidden="true" />

      <div className="bcard__stub">
        <div className="bcard__stub-row">
          <div>
            <p className="bcard__label">Admit</p>
            <p className="bcard__admit">
              <span className="bcard__seats" aria-hidden="true">
                {Array.from({ length: Math.min(booking.seats, 4) }, (_, i) => (
                  <Icon key={i} name="ticket" size={16} />
                ))}
              </span>
              {booking.seats} {booking.seats === 1 ? 'seat' : 'seats'}
            </p>
          </div>
          <div className="bcard__id">
            <p className="bcard__label">Booking ID</p>
            <CopyId id={booking.bookingId} />
          </div>
        </div>
        <Barcode value={booking.bookingId} />
      </div>
    </article>
  )
}
