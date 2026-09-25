import { useMemo, useState } from 'react'
import Icon from '../../components/Icon'
import { Button, EmptyState, Input, Select, StatusBadge } from '../../components/ui'
import { useData } from '../../context/DataContext'
import { addDays, formatDate, formatDateTime } from '../../utils/format'

export default function AdminBookings() {
  const { myEvents: events, bookings, localStatus } = useData()
  const [eventId, setEventId] = useState('All')
  const [status, setStatus] = useState('All')
  const [range, setRange] = useState('All')
  const [q, setQ] = useState('')

  const eventOpts = useMemo(
    () => [
      { value: 'All', label: 'All events' },
      ...[...events].sort((a, b) => a.date.localeCompare(b.date)).map((e) => ({ value: e.id, label: `${e.title} · ${formatDate(e.date, { year: false })}` })),
    ],
    [events],
  )
  const selected = events.find((e) => e.id === eventId)

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const since = range === '7' ? addDays(new Date(), -7) : range === '30' ? addDays(new Date(), -30) : null
    return bookings.filter(
      (b) =>
        (eventId === 'All' || b.eventId === eventId) &&
        (status === 'All' || b.status === status) &&
        (!since || new Date(b.bookedAt) >= since) &&
        (!needle || `${b.attendeeName} ${b.attendeeEmail} ${b.bookingId}`.toLowerCase().includes(needle)),
    )
  }, [bookings, eventId, status, range, q])

  const seats = rows.filter((b) => b.status !== 'Cancelled').reduce((s, b) => s + b.seats, 0)

  function exportCsv() {
    const head = ['Attendee Name', 'Email', 'Event', 'Booking ID', 'Booking Date', 'Seats', 'Status']
    const esc = (v) => `"${String(v).replace(/"/g, '""')}"`
    const body = rows.map((b) => [b.attendeeName, b.attendeeEmail, b.event.title, b.bookingId, b.bookedAt, b.seats, b.status].map(esc).join(','))
    const blob = new Blob([[head.join(','), ...body].join('\n')], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `codefolio-bookings${selected ? `-${selected.id}` : ''}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <>
      <header className="dash-head">
        <div>
          <p className="eyebrow">Attendees</p>
          <h1>Bookings</h1>
          <p className="muted">Select an event to see who&apos;s registered.</p>
        </div>
        <Button variant="secondary" icon="external" onClick={exportCsv} disabled={!rows.length}>
          Export CSV
        </Button>
      </header>

      <div className="table-tools table-tools--4">
        <Select label="Event" value={eventId} onChange={(e) => setEventId(e.target.value)} options={eventOpts} />
        <Select label="Status" value={status} onChange={(e) => setStatus(e.target.value)} options={['All', 'Confirmed', 'Attended', 'Cancelled']} />
        <Select
          label="Booked"
          value={range}
          onChange={(e) => setRange(e.target.value)}
          options={[
            { value: 'All', label: 'Any time' },
            { value: '7', label: 'Last 7 days' },
            { value: '30', label: 'Last 30 days' },
          ]}
        />
        <Input label="Search" icon="search" placeholder="Attendee or booking ID" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {selected && (
        <div className="event-summary card">
          <img src={selected.image} alt="" className="thumb thumb--lg" />
          <div>
            <strong>{selected.title}</strong>
            <p className="small muted">
              {formatDate(selected.date, { weekday: true })} · {selected.venue}, {selected.city}
            </p>
          </div>
          <div className="event-summary__nums">
            <span>
              <strong>{selected.capacity - selected.availableSeats}</strong> booked
            </span>
            <span>
              <strong>{selected.availableSeats}</strong> left
            </span>
            <span>
              <strong>{selected.capacity}</strong> capacity
            </span>
          </div>
        </div>
      )}

      <p className="results-count">
        <strong>{rows.length}</strong> {rows.length === 1 ? 'booking' : 'bookings'} · <strong>{seats}</strong> active {seats === 1 ? 'seat' : 'seats'}
      </p>

      {localStatus.loading ? (
        <div className="skeleton" style={{ height: 300, borderRadius: 20 }} />
      ) : rows.length === 0 ? (
        <EmptyState icon="users" title="No bookings found" message="Try a different event, status or search." />
      ) : (
        <div className="table-card">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Attendee Name</th>
                <th scope="col">Email</th>
                <th scope="col">Event</th>
                <th scope="col">Booking ID</th>
                <th scope="col">Booking Date</th>
                <th scope="col" className="num">
                  Seats
                </th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => (
                <tr key={b.id}>
                  <td data-label="Attendee" className="cell-title">
                    <span className="avatar avatar--sm" aria-hidden="true">
                      {b.attendeeName.slice(0, 1)}
                    </span>
                    <strong>{b.attendeeName}</strong>
                  </td>
                  <td data-label="Email" className="break">
                    {b.attendeeEmail}
                  </td>
                  <td data-label="Event">{b.event.title}</td>
                  <td data-label="Booking ID">
                    <code>{b.bookingId}</code>
                  </td>
                  <td data-label="Booked" className="nowrap">
                    {formatDateTime(b.bookedAt)}
                  </td>
                  <td data-label="Seats" className="num">
                    {b.seats}
                  </td>
                  <td data-label="Status">
                    <StatusBadge status={b.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="small muted table-foot">
        <Icon name="info" size={14} /> Sample attendees are fictional demo data.
      </p>
    </>
  )
}
