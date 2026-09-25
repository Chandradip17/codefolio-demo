// Build and download an .ics file for a booking (works with Google Calendar,
// Apple Calendar and Outlook). Event times are stored in IST.

const IST_OFFSET_MIN = 330

export function istToUtc(date, time = '00:00') {
  const [y, m, d] = date.split('-').map(Number)
  const [hh, mm] = time.split(':').map(Number)
  return new Date(Date.UTC(y, m - 1, d, hh, mm) - IST_OFFSET_MIN * 60000)
}

const stamp = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
const esc = (s = '') => String(s).replace(/\\/g, '\\\\').replace(/([,;])/g, '\\$1').replace(/\r?\n/g, '\\n')

// Fold lines longer than 75 octets, as the iCalendar spec requires.
const fold = (line) => line.match(/.{1,60}/gu).join('\r\n ')

export function bookingToIcs(booking, endTime) {
  const e = booking.event
  const start = istToUtc(e.date, e.time)
  let end
  if (endTime) {
    end = istToUtc(e.date, endTime)
    if (end <= start) end = new Date(end.getTime() + 86400000) // overnight hackathons
  } else {
    end = new Date(start.getTime() + 2 * 3600000)
  }
  const where = [e.venue, e.city].filter((x, i, a) => x && !(i === 1 && a[0]?.includes(x))).join(', ')
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Codefolio//Bookings//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${booking.bookingId}@codefolio`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(start)}`,
    `DTEND:${stamp(end)}`,
    `SUMMARY:${esc(e.title)}`,
    `LOCATION:${esc(e.mode === 'Online' ? `Online${e.venue && e.venue !== 'Online' ? ` (${e.venue})` : ''}` : where)}`,
    `DESCRIPTION:${esc(`${e.organizerChapter}\nBooking ID: ${booking.bookingId}\nSeats: ${booking.seats}\nBooked via Codefolio`)}`,
    'STATUS:CONFIRMED',
    'BEGIN:VALARM',
    'TRIGGER:-PT2H',
    'ACTION:DISPLAY',
    `DESCRIPTION:${esc(`${e.title} starts in 2 hours`)}`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ]
  return lines.map(fold).join('\r\n') + '\r\n'
}

export function downloadIcs(booking, endTime) {
  const blob = new Blob([bookingToIcs(booking, endTime)], { type: 'text/calendar;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `${booking.bookingId}.ics`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}
