import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import Icon from '../../components/Icon'
import Modal, { ConfirmDialog } from '../../components/Modal'
import { Button, EmptyState, Input, Select, StatusBadge, Textarea } from '../../components/ui'
import { useData } from '../../context/DataContext'
import { useToast } from '../../context/ToastContext'
import * as api from '../../services/api'
import { addDays, formatDate, formatDateTime } from '../../utils/format'

const shortWhen = (iso) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })

const STATUSES = ['All', 'Pending', 'Confirmed', 'Attended', 'Rejected', 'Removed', 'Cancelled']

const ACTIONS = {
  approve: { title: 'Approve this application?', label: 'Approve', tone: 'info', done: 'Approved' },
  reject: { title: 'Reject this application?', label: 'Reject', tone: 'danger', done: 'Rejected' },
  remove: { title: 'Remove this attendee?', label: 'Remove', tone: 'danger', done: 'Removed' },
}

function AnswerValue({ q, value }) {
  if (value == null || value === '' || (Array.isArray(value) && !value.length)) return <span className="muted">No answer</span>
  if (Array.isArray(value)) return value.join(', ')
  if (typeof value === 'object' && value.path) {
    return value.url ? (
      <a className="link" href={value.url} target="_blank" rel="noopener noreferrer">
        <Icon name="fileText" size={14} /> {value.name} <Icon name="external" size={12} />
      </a>
    ) : (
      value.name
    )
  }
  if (q?.type === 'url' || /^https?:\/\//.test(String(value))) {
    return (
      <a className="link break" href={value} target="_blank" rel="noopener noreferrer">
        {String(value).replace(/^https?:\/\//, '')} <Icon name="external" size={12} />
      </a>
    )
  }
  return <span className="pre-line">{String(value)}</span>
}

function AnswersModal({ booking, onClose, onAction }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!booking) return
    let live = true
    setData(null)
    setError('')
    api
      .bookingAnswers(booking.id)
      .then((d) => live && setData(d))
      .catch((e) => live && setError(e.message))
    return () => {
      live = false
    }
  }, [booking])

  if (!booking) return null
  const p = data?.profile
  const extra = data ? Object.keys(data.answers).filter((id) => !data.questions.some((q) => q.id === id)) : []
  return (
    <Modal
      open
      onClose={onClose}
      title={`${booking.attendeeName}'s application`}
      size="md"
      footer={
        booking.status === 'Pending' ? (
          <>
            <Button variant="danger-ghost" icon="x" onClick={() => onAction(booking, 'reject')}>
              Reject
            </Button>
            <Button icon="check" onClick={() => onAction(booking, 'approve')}>
              Approve
            </Button>
          </>
        ) : (
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        )
      }
    >
      <div className="answers">
        <div className="answers__who">
          <span className="avatar" aria-hidden="true">
            {p?.avatar_url ? <img src={p.avatar_url} alt="" /> : booking.attendeeName.slice(0, 1)}
          </span>
          <div>
            <strong>{booking.attendeeName}</strong>
            <p className="small muted break">
              {booking.attendeeEmail}
              {p?.username && (
                <>
                  {' · '}
                  <Link className="link" to={`/profile/${p.username}`} target="_blank">
                    @{p.username}
                  </Link>
                </>
              )}
            </p>
          </div>
          <StatusBadge status={booking.status} />
        </div>
        <p className="small muted">
          <code>{booking.bookingId}</code> · {booking.seats} {booking.seats === 1 ? 'seat' : 'seats'} · applied {formatDateTime(booking.bookedAt)}
        </p>
        {booking.reviewNote && (
          <p className="small">
            <strong>Your note:</strong> {booking.reviewNote}
          </p>
        )}
        {data?.team && (
          <div className="answers__team">
            <p className="small">
              <Icon name="users" size={14} /> Team <strong>{data.team.name}</strong> · <code className="team-code">{data.team.code}</code> ·{' '}
              {data.team.size}
              {data.teamLimits ? ` of ${data.teamLimits.max}` : ''} members
              {data.teamLimits && data.team.size < data.teamLimits.min && (
                <span className="answers__warn"> · below the minimum of {data.teamLimits.min}</span>
              )}
            </p>
            <p className="small muted">
              {data.team.members.map((m) => `${m.name}${m.leader ? ' (leader)' : ''}`).join(', ')}
            </p>
          </div>
        )}
        {data?.payment && (
          <div className="answers__team">
            <p className="small">
              <Icon name="ticket" size={14} /> Application fee <strong>₹{data.payment.amount.toLocaleString('en-IN')}</strong> · UPI transaction ID{' '}
              <code>{data.payment.ref}</code>
            </p>
            <p className="small muted">
              {data.payment.proof?.url ? (
                <a className="link" href={data.payment.proof.url} target="_blank" rel="noopener noreferrer">
                  <Icon name="fileText" size={13} /> Payment screenshot <Icon name="external" size={12} />
                </a>
              ) : (
                'No screenshot attached.'
              )}{' '}
              Match the UTR in your UPI app before approving.
            </p>
          </div>
        )}
        {data?.participation === 'solo' && (
          <p className="small">
            <Icon name="user" size={14} /> Participating solo
          </p>
        )}

        {error ? (
          <p className="form-error" role="alert">
            <Icon name="alert" size={15} /> {error}
          </p>
        ) : !data ? (
          <div className="modal-loading">
            <span className="spinner spinner--lg" aria-hidden="true" /> Loading answers…
          </div>
        ) : (
          <dl className="answers__list">
            {data.questions.map((q) => (
              <div key={q.id}>
                <dt>{q.label}</dt>
                <dd>
                  <AnswerValue q={q} value={data.answers[q.id]} />
                </dd>
              </div>
            ))}
            {extra.map((id) => (
              <div key={id}>
                <dt>
                  {id} <small className="muted">(removed question)</small>
                </dt>
                <dd>
                  <AnswerValue value={data.answers[id]} />
                </dd>
              </div>
            ))}
            {!data.questions.length && !extra.length && <p className="muted">This application has no answers.</p>}
          </dl>
        )}
      </div>
    </Modal>
  )
}

export default function AdminBookings() {
  const { myEvents: events, hostBookings: bookings, localStatus, reviewBooking } = useData()
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const [eventId, setEventIdRaw] = useState(params.get('for') || 'All')
  const [status, setStatus] = useState(params.get('status') || 'All')
  const [range, setRange] = useState('All')
  const [q, setQ] = useState('')
  const [viewing, setViewing] = useState(null)
  const [review, setReview] = useState(null) // { booking, action }
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const setEventId = (v) => {
    setEventIdRaw(v)
    setParams(v === 'All' ? {} : { for: v }, { replace: true })
  }

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

  // Per-event (or all-events) numbers for the summary strip.
  const stats = useMemo(() => {
    const scope = bookings.filter((b) => eventId === 'All' || b.eventId === eventId)
    const n = (s) => scope.filter((b) => b.status === s).length
    return {
      applications: scope.length,
      pending: n('Pending'),
      approved: n('Confirmed') + n('Attended'),
      rejected: n('Rejected'),
      attended: n('Attended'),
    }
  }, [bookings, eventId])

  const seats = rows.filter((b) => b.status === 'Confirmed' || b.status === 'Attended').reduce((s, b) => s + b.seats, 0)

  function exportCsv() {
    const head = ['Attendee Name', 'Email', 'Event', 'Booking ID', 'Applied', 'Seats', 'Status', 'Participation', 'Team', 'Team code', 'Fee (₹)', 'UPI UTR', 'Reviewed', 'Note']
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const body = rows.map((b) =>
      [b.attendeeName, b.attendeeEmail, b.event.title, b.bookingId, b.bookedAt, b.seats, b.status, b.participation || '', b.team?.name || '', b.team?.code || '', b.feeAmount ?? '', b.paymentRef || '', b.reviewedAt || '', b.reviewNote || ''].map(esc).join(','),
    )
    const blob = new Blob([[head.join(','), ...body].join('\n')], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `codefolio-bookings${selected ? `-${selected.id}` : ''}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const ask = (booking, action) => {
    setNote('')
    setViewing(null)
    setReview({ booking, action })
  }

  async function confirmReview() {
    const { booking, action } = review
    setBusy(true)
    try {
      const b = await reviewBooking(booking.id, action, note.trim())
      toast({
        title: `${ACTIONS[action].done}: ${b.attendeeName}`,
        message: action === 'approve' ? `${b.bookingId} · seats held and check-in QR issued.` : `${b.bookingId} · ${b.event.title}`,
        tone: action === 'approve' ? 'success' : 'info',
      })
      setReview(null)
    } catch (e) {
      toast({ title: `Couldn't ${action}`, message: e.message, tone: 'error' })
    } finally {
      setBusy(false)
    }
  }

  const seatsLeft = (b) => events.find((e) => e.id === b.eventId)?.availableSeats

  return (
    <>
      <header className="dash-head">
        <div>
          <p className="eyebrow">Attendees</p>
          <h1>Bookings</h1>
          <p className="muted">
            {stats.pending
              ? `${stats.pending} ${stats.pending === 1 ? 'application is' : 'applications are'} waiting for your review.`
              : 'Every seat request comes here first. Approve it to hold the seats and issue a check-in QR.'}
          </p>
        </div>
        <Button variant="secondary" icon="external" onClick={exportCsv} disabled={!rows.length}>
          Export CSV
        </Button>
      </header>

      <div className="table-tools table-tools--4">
        <Select label="Event" value={eventId} onChange={(e) => setEventId(e.target.value)} options={eventOpts} />
        <Select label="Status" value={status} onChange={(e) => setStatus(e.target.value)} options={STATUSES} />
        <Select
          label="Applied"
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

      <div className="event-summary card">
        {selected ? (
          <>
            <img src={selected.image} alt="" className="thumb thumb--lg" />
            <div>
              <strong>{selected.title}</strong>
              <p className="small muted">
                {formatDate(selected.date, { weekday: true })} · {selected.venue}, {selected.city}
              </p>
              <p className="small">
                <Link className="link" to={`/admin/events/${selected.id}/application`}>
                  <Icon name="fileText" size={14} /> Edit application form
                </Link>
              </p>
            </div>
          </>
        ) : (
          <div>
            <strong>All your events</strong>
            <p className="small muted">Pick an event to see its capacity and remaining seats.</p>
          </div>
        )}
        <div className="event-summary__nums">
          <span>
            <strong>{stats.applications}</strong> applications
          </span>
          <span>
            <strong>{stats.pending}</strong> pending
          </span>
          <span>
            <strong>{stats.approved}</strong> approved
          </span>
          <span>
            <strong>{stats.rejected}</strong> rejected
          </span>
          <span>
            <strong>{stats.attended}</strong> attended
          </span>
          {selected && (
            <>
              <span>
                <strong>{selected.capacity}</strong> capacity
              </span>
              <span>
                <strong>{selected.availableSeats}</strong> left
              </span>
            </>
          )}
        </div>
      </div>

      <p className="results-count">
        <strong>{rows.length}</strong> {rows.length === 1 ? 'booking' : 'bookings'} · <strong>{seats}</strong> approved {seats === 1 ? 'seat' : 'seats'}
      </p>

      {localStatus.loading ? (
        <div className="skeleton" style={{ height: 300, borderRadius: 20 }} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon="users"
          title="No bookings found"
          message={bookings.length ? 'Try a different event, status or search.' : 'Applications to your events will appear here as people apply.'}
        />
      ) : (
        <div className="table-card">
          <table className="data-table data-table--dense">
            <thead>
              <tr>
                <th scope="col">Attendee Name</th>
                <th scope="col">Email</th>
                {!selected && <th scope="col">Event</th>}
                <th scope="col">Booking ID</th>
                <th scope="col">Applied</th>
                <th scope="col" className="num">
                  Seats
                </th>
                <th scope="col">Status</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => (
                <tr key={b.id}>
                  <td data-label="Attendee" className="cell-title">
                    <span className="avatar avatar--sm" aria-hidden="true">
                      {b.attendeeName.slice(0, 1)}
                    </span>
                    <span>
                      <strong>{b.attendeeName}</strong>
                      {b.team ? (
                        <small className="muted">
                          Team {b.team.name} · {b.team.size}
                        </small>
                      ) : (
                        b.participation === 'solo' && <small className="muted">Solo</small>
                      )}
                      {b.feeAmount ? (
                        <small className="muted">
                          ₹{b.feeAmount.toLocaleString('en-IN')} · UTR {b.paymentRef}
                        </small>
                      ) : null}
                    </span>
                  </td>
                  <td data-label="Email" className="break">
                    {b.attendeeEmail}
                  </td>
                  {!selected && <td data-label="Event">{b.event.title}</td>}
                  <td data-label="Booking ID" className="nowrap">
                    <code>{b.bookingId}</code>
                  </td>
                  <td data-label="Applied" className="nowrap" title={formatDateTime(b.bookedAt)}>
                    {shortWhen(b.bookedAt)}
                  </td>
                  <td data-label="Seats" className="num">
                    {b.seats}
                  </td>
                  <td data-label="Status">
                    <StatusBadge status={b.status} />
                  </td>
                  <td className="cell-actions">
                    <div className="row-actions">
                      <Button size="sm" variant="ghost" icon="eye" onClick={() => setViewing(b)} title="View application" aria-label={`View ${b.attendeeName}'s application`} />
                      {b.status === 'Pending' && b.eventId && (
                        <>
                          <Button size="sm" variant="ghost" icon="check" onClick={() => ask(b, 'approve')} title="Approve" aria-label={`Approve ${b.attendeeName}`} />
                          <Button size="sm" variant="danger-ghost" icon="x" onClick={() => ask(b, 'reject')} title="Reject" aria-label={`Reject ${b.attendeeName}`} />
                        </>
                      )}
                      {b.status === 'Confirmed' && b.eventId && (
                        <Button size="sm" variant="danger-ghost" icon="ban" onClick={() => ask(b, 'remove')} title="Remove" aria-label={`Remove ${b.attendeeName}`} />
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {events.some((e) => e.isSample) && (
        <p className="small muted table-foot">
          <Icon name="info" size={14} /> Sample attendees are fictional demo data.
        </p>
      )}

      <AnswersModal booking={viewing} onClose={() => setViewing(null)} onAction={ask} />

      <ConfirmDialog
        open={Boolean(review)}
        onClose={() => setReview(null)}
        onConfirm={confirmReview}
        busy={busy}
        tone={review ? ACTIONS[review.action].tone : 'info'}
        title={review ? ACTIONS[review.action].title : ''}
        confirmLabel={review ? ACTIONS[review.action].label : ''}
        cancelLabel="Not now"
        message={
          review && (
            <>
              <p>
                <strong>{review.booking.attendeeName}</strong> · {review.booking.seats} {review.booking.seats === 1 ? 'seat' : 'seats'} for{' '}
                <strong>{review.booking.event.title}</strong> ({review.booking.bookingId}).
              </p>
              <p className="muted">
                {review.action === 'approve'
                  ? `This holds their ${review.booking.seats === 1 ? 'seat' : 'seats'} and issues a check-in QR${
                      seatsLeft(review.booking) != null ? ` (${seatsLeft(review.booking)} seats left now)` : ''
                    }.`
                  : review.action === 'reject'
                    ? 'They will see that their request was not approved. No seats are affected.'
                    : 'Their seats are released and their QR stops working.'}
              </p>
              {review.action !== 'approve' && (
                <Textarea
                  label="Note to the applicant (optional)"
                  rows={2}
                  maxLength={500}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder={review.action === 'reject' ? 'e.g. The event is full for your college this time.' : 'e.g. Duplicate registration.'}
                />
              )}
            </>
          )
        }
      />
    </>
  )
}
