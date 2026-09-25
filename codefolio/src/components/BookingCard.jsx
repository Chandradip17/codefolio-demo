import Icon from './Icon'
import { Button, CategoryBadge, StatusBadge } from './ui'
import { useOpenEvent } from '../hooks/useOpenEvent'
import { cx, dateParts, formatDate, formatTime, isPast } from '../utils/format'

export default function BookingCard({ booking, eventExists, eventCancelled, onCancel }) {
  const openEvent = useOpenEvent()
  const e = booking.event
  const { day, month } = dateParts(e.date)
  const past = isPast(e.date)
  const status = eventCancelled && booking.status === 'Confirmed' ? 'Event cancelled' : booking.status
  const canCancel = booking.status === 'Confirmed' && !past && !eventCancelled

  return (
    <article className={cx('booking', booking.status !== 'Confirmed' && 'booking--muted')}>
      <div className="booking__date" aria-hidden="true">
        <span>{month}</span>
        <strong>{day}</strong>
      </div>
      <div className="booking__main">
        <div className="badge-row">
          <CategoryBadge category={e.category} />
          <StatusBadge status={status === 'Event cancelled' ? 'Cancelled' : status} />
          {status === 'Event cancelled' && <span className="small muted">Event cancelled by organizer</span>}
        </div>
        <h3 className="booking__title">{e.title}</h3>
        <p className="booking__org">{e.organizerChapter}</p>
        <ul className="booking__meta">
          <li>
            <Icon name="calendar" size={15} /> {formatDate(e.date, { weekday: true })} · {formatTime(e.time)}
          </li>
          <li>
            <Icon name="pin" size={15} /> <span className="truncate">{e.venue}</span>
          </li>
          <li>
            <Icon name="globe" size={15} /> {e.city} · {e.mode}
          </li>
        </ul>
      </div>
      <div className="booking__perf" aria-hidden="true" />
      <div className="booking__stub">
        <dl>
          <div>
            <dt>Booking ID</dt>
            <dd>
              <code>{booking.bookingId}</code>
            </dd>
          </div>
          <div>
            <dt>Seats</dt>
            <dd>{booking.seats}</dd>
          </div>
        </dl>
        <div className="booking__actions">
          <Button size="sm" variant="secondary" onClick={() => openEvent(booking.eventId)} disabled={!eventExists} title={eventExists ? undefined : 'This event was removed'}>
            View Details
          </Button>
          {canCancel && (
            <Button size="sm" variant="danger-ghost" onClick={() => onCancel(booking)}>
              Cancel Booking
            </Button>
          )}
        </div>
      </div>
    </article>
  )
}
