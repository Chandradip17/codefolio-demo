// Pure helpers that turn realtime updates into activity-feed items.
// Each item: { key, tone, icon, title, text?, eventId?, toast? }.
// `key` deduplicates the same news arriving twice (e.g. from two sources).
import { formatDate, formatTime, todayISO } from '../utils/format'

const lowThreshold = (ev) => Math.max(5, Math.round(ev.capacity * 0.1))
const whenLabel = (ev) => `${formatDate(ev.date, { weekday: true, year: false })} · ${formatTime(ev.time)}`

export function diffEvent(prev, ev, { me, myEventIds, myCity }) {
  const out = []
  // Organizers see their own edits in their own UI; don't narrate them back.
  if (me && ev.createdBy === me.id) return out
  const booked = myEventIds.has(ev.id)

  if (!prev) {
    if (ev.status === 'Published' && ev.date >= todayISO()) {
      out.push({
        key: `new:${ev.id}`,
        tone: 'info',
        icon: 'sparkles',
        title: `New event: ${ev.title}`,
        text: `${ev.city} · ${whenLabel(ev)}`,
        eventId: ev.id,
        toast: Boolean(myCity && ev.city === myCity),
      })
    }
    return out
  }

  if (booked) {
    if (prev.status !== 'Cancelled' && ev.status === 'Cancelled') {
      out.push({ key: `cancel:${ev.id}`, tone: 'danger', icon: 'ban', title: `${ev.title} was cancelled`, text: 'The organizer cancelled this event.', eventId: ev.id, toast: true })
    }
    if (prev.date !== ev.date || prev.time !== ev.time) {
      out.push({ key: `move:${ev.id}:${ev.date}${ev.time}`, tone: 'info', icon: 'calendar', title: `${ev.title} was rescheduled`, text: `Now ${whenLabel(ev)}`, eventId: ev.id, toast: true })
    }
    if (prev.venue !== ev.venue) {
      out.push({ key: `venue:${ev.id}:${ev.venue}`, tone: 'info', icon: 'pin', title: `Venue updated for ${ev.title}`, text: ev.venue, eventId: ev.id, toast: true })
    }
  }

  if (ev.status !== 'Cancelled' && ev.availableSeats < prev.availableSeats) {
    if (ev.availableSeats === 0) {
      out.push({ key: `soldout:${ev.id}`, tone: 'warn', icon: 'ticket', title: `${ev.title} just sold out`, eventId: ev.id })
    } else if (prev.availableSeats > lowThreshold(ev) && ev.availableSeats <= lowThreshold(ev)) {
      out.push({ key: `low:${ev.id}`, tone: 'warn', icon: 'zap', title: `Filling fast: ${ev.title}`, text: `Only ${ev.availableSeats} seats left`, eventId: ev.id })
    }
  }
  return out
}

export function diffBooking(prev, b, { me }) {
  if (!me || (prev && prev.status === b.status)) return []
  const title = b.event?.title || 'an event'
  if (b.userId === me.id) {
    // This tab's own actions update state before the echo arrives, so a diff here
    // means the change came from another device (or from the organizer).
    if (!prev && b.status === 'Confirmed') {
      return [{ key: `bk:${b.id}:c`, tone: 'success', icon: 'ticket', title: `You booked ${title}`, text: `${b.bookingId} · booked on another device`, eventId: b.eventId, toast: true }]
    }
    if (b.status === 'Cancelled') {
      return [{ key: `bk:${b.id}:x`, tone: 'danger', icon: 'ban', title: `Booking ${b.bookingId} cancelled`, text: title, eventId: b.eventId }]
    }
    return []
  }
  // Organizer view: someone booked or cancelled one of their events.
  if (!prev && b.status === 'Confirmed') {
    return [{ key: `bk:${b.id}:c`, tone: 'success', icon: 'users', title: `${b.attendeeName} booked ${b.seats} ${b.seats === 1 ? 'seat' : 'seats'}`, text: title, eventId: b.eventId, toast: true }]
  }
  if (b.status === 'Cancelled') {
    return [{ key: `bk:${b.id}:x`, tone: 'warn', icon: 'ban', title: `${b.attendeeName} cancelled`, text: title, eventId: b.eventId }]
  }
  return []
}

// Starting feed so the panel isn't empty before anything happens live.
export function seedActivity(bookings, me) {
  return [...bookings]
    .sort((a, b) => b.bookedAt.localeCompare(a.bookedAt))
    .slice(0, 6)
    .map((b) => {
      const mine = b.userId === me.id
      const cancelled = b.status === 'Cancelled'
      return {
        key: `seed:${b.id}`,
        at: new Date(b.bookedAt).getTime(),
        tone: cancelled ? 'muted' : 'success',
        icon: mine ? 'ticket' : 'users',
        title: mine ? `You booked ${b.event?.title}` : `${b.attendeeName} booked ${b.seats} ${b.seats === 1 ? 'seat' : 'seats'}`,
        text: mine ? `${b.bookingId}${cancelled ? ' · cancelled' : ''}` : b.event?.title,
        eventId: b.eventId,
        seeded: true,
      }
    })
}
