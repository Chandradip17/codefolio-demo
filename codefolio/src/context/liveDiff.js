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
    const note = b.reviewNote ? ` · “${b.reviewNote}”` : ''
    switch (b.status) {
      case 'Pending':
        return prev ? [] : [{ key: `bk:${b.id}:p`, tone: 'info', icon: 'ticket', title: `You applied to ${title}`, text: `${b.bookingId} · from another device`, eventId: b.eventId }]
      case 'Confirmed':
        return [{ key: `bk:${b.id}:c`, tone: 'success', icon: 'checkCircle', title: `You’re in! ${title}`, text: `${b.bookingId} · your check-in QR is ready`, eventId: b.eventId, toast: true }]
      case 'Rejected':
        return [{ key: `bk:${b.id}:r`, tone: 'danger', icon: 'ban', title: `Not approved: ${title}`, text: `${b.bookingId}${note}`, eventId: b.eventId, toast: true }]
      case 'Removed':
        return [{ key: `bk:${b.id}:rm`, tone: 'danger', icon: 'ban', title: `Removed from ${title}`, text: `${b.bookingId}${note}`, eventId: b.eventId, toast: true }]
      case 'Attended':
        return [{ key: `bk:${b.id}:a`, tone: 'success', icon: 'check', title: `Checked in at ${title}`, text: 'Enjoy the event!', eventId: b.eventId, toast: true }]
      case 'Cancelled':
        return [{ key: `bk:${b.id}:x`, tone: 'danger', icon: 'ban', title: `Booking ${b.bookingId} cancelled`, text: title, eventId: b.eventId }]
      default:
        return []
    }
  }
  // Host view: applications to one of their events.
  if (!prev && b.status === 'Pending') {
    return [{ key: `bk:${b.id}:p`, tone: 'info', icon: 'users', title: `${b.attendeeName} applied for ${b.seats} ${b.seats === 1 ? 'seat' : 'seats'}`, text: `${title} · awaiting your review`, eventId: b.eventId, toast: true }]
  }
  if (b.status === 'Cancelled') {
    return [{ key: `bk:${b.id}:x`, tone: 'warn', icon: 'ban', title: `${b.attendeeName} ${prev?.status === 'Pending' ? 'withdrew their request' : 'cancelled'}`, text: title, eventId: b.eventId }]
  }
  return []
}

const SEED_VERB = { Pending: 'applied to', Confirmed: 'booked', Attended: 'attended', Rejected: 'applied to', Removed: 'booked', Cancelled: 'booked' }

// Starting feed so the panel isn't empty before anything happens live.
export function seedActivity(bookings, me) {
  return [...bookings]
    .sort((a, b) => b.bookedAt.localeCompare(a.bookedAt))
    .slice(0, 6)
    .map((b) => {
      const mine = b.userId === me.id
      const closed = ['Cancelled', 'Rejected', 'Removed'].includes(b.status)
      const state = b.status === 'Confirmed' ? '' : ` · ${b.status === 'Pending' ? 'pending review' : b.status === 'Rejected' ? 'not approved' : b.status.toLowerCase()}`
      return {
        key: `seed:${b.id}`,
        at: new Date(b.bookedAt).getTime(),
        tone: closed ? 'muted' : b.status === 'Pending' ? 'info' : 'success',
        icon: mine ? 'ticket' : 'users',
        title: mine
          ? `You ${SEED_VERB[b.status] || 'booked'} ${b.event?.title}`
          : `${b.attendeeName} ${b.status === 'Pending' || b.status === 'Rejected' ? 'applied for' : 'booked'} ${b.seats} ${b.seats === 1 ? 'seat' : 'seats'}`,
        text: mine ? `${b.bookingId}${state}` : `${b.event?.title}${state}`,
        eventId: b.eventId,
        seeded: true,
      }
    })
}
