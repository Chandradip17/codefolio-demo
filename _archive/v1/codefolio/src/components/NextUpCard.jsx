import { useState } from 'react'
import Icon from './Icon'
import { Button, CategoryBadge } from './ui'
import { LiveNumber } from './LiveBits'
import { useNow } from '../hooks/useNow'
import { useOpenEvent } from '../hooks/useOpenEvent'
import { fallbackImage } from '../data/images'
import { downloadIcs, istToUtc } from '../utils/calendar'
import { formatDate, formatTime } from '../utils/format'

const DAY = 86400000

function window_(ev, liveEvent) {
  const start = istToUtc(ev.date, ev.time).getTime()
  let end = liveEvent?.endTime ? istToUtc(ev.date, liveEvent.endTime).getTime() : start + 3 * 3600000
  if (end <= start) end += DAY // overnight
  return { start, end }
}

function parts(ms) {
  const s = Math.max(0, Math.floor(ms / 1000))
  return { d: Math.floor(s / 86400), h: Math.floor((s % 86400) / 3600), m: Math.floor((s % 3600) / 60), s: s % 60 }
}
const pad = (n) => String(n).padStart(2, '0')

export default function NextUpCard({ booking, liveEvent }) {
  const openEvent = useOpenEvent()
  const [imgFailed, setImgFailed] = useState(false)
  const e = booking.event
  const { start, end } = window_(e, liveEvent)
  // Tick every second in the last two days; every 30s before that.
  const now = useNow(start - Date.now() < 2 * DAY ? 1000 : 30000)
  const happening = now >= start && now < end
  const t = parts(start - now)
  const cap = liveEvent?.capacity
  const left = liveEvent?.availableSeats
  const pct = cap ? Math.round(((cap - left) / cap) * 100) : null
  const image = imgFailed || !e.image ? fallbackImage(e.category, booking.eventId || booking.id) : e.image

  return (
    <section className="nextup" aria-labelledby="nextup-title">
      <div className="nextup__media" aria-hidden="true">
        <img src={image} alt="" onError={() => setImgFailed(true)} />
      </div>
      <div className="nextup__body">
        <div className="nextup__top">
          <p className="eyebrow eyebrow--light">{happening ? 'Happening now' : 'Next up'}</p>
          <CategoryBadge category={e.category} />
        </div>
        <h2 id="nextup-title" className="nextup__title">
          {e.title}
        </h2>
        <p className="nextup__meta">
          <span>
            <Icon name="calendar" size={15} /> {formatDate(e.date, { weekday: true })} · {formatTime(e.time)}
          </span>
          <span>
            <Icon name={e.mode === 'Online' ? 'wifi' : 'pin'} size={15} /> {e.mode === 'Online' ? 'Online' : `${e.venue}${e.city && !e.venue.includes(e.city) ? `, ${e.city}` : ''}`}
          </span>
        </p>

        {happening ? (
          <div className="nextup__now" role="status">
            <span className="live-ind__dot" aria-hidden="true" /> It&apos;s on! Show your booking ID <code>{booking.bookingId}</code> at the door.
          </div>
        ) : (
          <div className="countdown" role="timer" aria-label={`Starts in ${t.d} days ${t.h} hours ${t.m} minutes`}>
            {[
              ['days', t.d],
              ['hrs', t.h],
              ['min', t.m],
              ['sec', t.s],
            ].map(([label, v]) => (
              <div key={label} className="countdown__cell" aria-hidden="true">
                <strong>{label === 'days' ? v : pad(v)}</strong>
                <span>{label}</span>
              </div>
            ))}
          </div>
        )}

        {pct != null && (
          <div className="nextup__seats">
            <div className="nextup__seats-row">
              <span>
                <LiveNumber value={left} /> of {cap} seats left
              </span>
              <span className="nextup__live">
                <span className="live-ind__dot" aria-hidden="true" /> live
              </span>
            </div>
            <span className="meter meter--dark" aria-hidden="true">
              <span className="meter__fill meter__fill--ok" style={{ width: `${pct}%` }} />
            </span>
          </div>
        )}

        <div className="nextup__actions">
          <Button size="sm" variant="saffron" onClick={() => openEvent(booking.eventId)} disabled={!liveEvent}>
            View details
          </Button>
          <Button size="sm" variant="outline-light" icon="calendarPlus" onClick={() => downloadIcs(booking, liveEvent?.endTime)}>
            Add to calendar
          </Button>
          <span className="nextup__id">
            {booking.seats} {booking.seats === 1 ? 'seat' : 'seats'} · <code>{booking.bookingId}</code>
          </span>
        </div>
      </div>
    </section>
  )
}
