import { useMemo, useState } from 'react'
import { ConfirmDialog } from '../../components/Modal'
import Icon from '../../components/Icon'
import { Button, CategoryBadge, EmptyState, Input, Select, StatusBadge, categoryLabel } from '../../components/ui'
import { useData } from '../../context/DataContext'
import { useToast } from '../../context/ToastContext'
import { cx, formatDate } from '../../utils/format'
import { eventStatus } from './adminUtils'

export default function AdminEvents() {
  const { myEvents: events, localStatus, cancelEvent, deleteEvent } = useData()
  const toast = useToast()
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('All')
  const [dialog, setDialog] = useState(null) // { kind: 'cancel' | 'delete', event }
  const [busy, setBusy] = useState(false)

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return events
      .filter((e) => !needle || `${e.title} ${e.city} ${e.organizerChapter}`.toLowerCase().includes(needle))
      .filter((e) => status === 'All' || eventStatus(e) === status)
      .sort((a, b) => b.date.localeCompare(a.date))
  }, [events, q, status])

  async function runDialog() {
    const { kind, event } = dialog
    setBusy(true)
    try {
      if (kind === 'cancel') {
        await cancelEvent(event.id)
        toast({ title: 'Event cancelled', message: `${event.title} is no longer accepting bookings.`, tone: 'info' })
      } else {
        await deleteEvent(event.id)
        toast({ title: 'Event deleted', message: `${event.title} was permanently removed.`, tone: 'info' })
      }
      setDialog(null)
    } catch (e) {
      toast({ title: 'Something went wrong', message: e.message, tone: 'error' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <header className="dash-head">
        <div>
          <p className="eyebrow">Manage</p>
          <h1>Events</h1>
          <p className="muted">
            {events.length} {events.length === 1 ? 'event' : 'events'} you host on Codefolio. Live GDG/Devfolio listings are managed on their own
            platforms.
          </p>
        </div>
        <Button to="/admin/events/new" icon="plus">
          Add Event
        </Button>
      </header>

      <div className="table-tools">
        <Input icon="search" placeholder="Search events, cities, chapters…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search events" />
        <Select
          aria-label="Filter by status"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          options={['All', 'Published', 'Sold Out', 'Completed', 'Cancelled'].map((s) => ({ value: s, label: s === 'All' ? 'All statuses' : s }))}
        />
      </div>

      {localStatus.loading ? (
        <div className="skeleton" style={{ height: 320, borderRadius: 20 }} />
      ) : events.length === 0 ? (
        <EmptyState
          icon="calendar"
          title="No events yet"
          message="Create your first event and it will appear on Codefolio right away."
          action={
            <Button to="/admin/events/new" icon="plus">
              Add Event
            </Button>
          }
        />
      ) : rows.length === 0 ? (
        <EmptyState title="No events match" message="Try a different search or status." />
      ) : (
        <div className="table-card">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Event</th>
                <th scope="col">Type</th>
                <th scope="col">Organizer</th>
                <th scope="col">City</th>
                <th scope="col">Date</th>
                <th scope="col">Mode</th>
                <th scope="col" className="num">Capacity</th>
                <th scope="col" className="num">Seats Left</th>
                <th scope="col">Status</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => {
                const st = eventStatus(e)
                return (
                  <tr key={e.id} className={cx(st === 'Cancelled' && 'is-muted')}>
                    <td data-label="Event" className="cell-title">
                      <img src={e.image} alt="" className="thumb" loading="lazy" />
                      <span>
                        <strong>{e.title}</strong>
                        {e.isSample && <small className="muted">Sample</small>}
                      </span>
                    </td>
                    <td data-label="Type">
                      <CategoryBadge category={e.category} />
                      <span className="sr-only">{categoryLabel(e.category)}</span>
                    </td>
                    <td data-label="Organizer">{e.organizerChapter}</td>
                    <td data-label="City">{e.city}</td>
                    <td data-label="Date" className="nowrap">
                      {formatDate(e.date)}
                    </td>
                    <td data-label="Mode">{e.mode}</td>
                    <td data-label="Capacity" className="num">
                      {e.capacity}
                    </td>
                    <td data-label="Seats Left" className="num">
                      {e.availableSeats}
                    </td>
                    <td data-label="Status">
                      <StatusBadge status={st} />
                    </td>
                    <td className="cell-actions">
                      <div className="row-actions">
                        <Button size="sm" variant="ghost" icon="edit" to={`/admin/events/${e.id}/edit`} aria-label={`Edit ${e.title}`}>
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          icon="ban"
                          disabled={st === 'Cancelled' || st === 'Completed'}
                          onClick={() => setDialog({ kind: 'cancel', event: e })}
                          aria-label={`Cancel ${e.title}`}
                        >
                          Cancel
                        </Button>
                        <Button size="sm" variant="danger-ghost" icon="trash" onClick={() => setDialog({ kind: 'delete', event: e })} aria-label={`Delete ${e.title}`}>
                          Delete
                        </Button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        open={dialog?.kind === 'cancel'}
        onClose={() => setDialog(null)}
        onConfirm={runDialog}
        busy={busy}
        title="Cancel this event?"
        confirmLabel="Cancel Event"
        message={
          dialog && (
            <>
              <p>
                <strong>{dialog.event.title}</strong> will be marked <strong>Cancelled</strong>.
              </p>
              <p className="muted">
                Cancellation prevents new bookings.{' '}
                {dialog.event.capacity - dialog.event.availableSeats > 0
                  ? `Attendees holding the ${dialog.event.capacity - dialog.event.availableSeats} booked seats will see it as cancelled in their dashboard.`
                  : 'Nobody has booked a seat yet.'}
              </p>
            </>
          )
        }
      />
      <ConfirmDialog
        open={dialog?.kind === 'delete'}
        onClose={() => setDialog(null)}
        onConfirm={runDialog}
        busy={busy}
        title="Delete this event permanently?"
        confirmLabel="Delete permanently"
        requireText="DELETE"
        message={
          dialog && (
            <>
              <p>
                This permanently removes <strong>{dialog.event.title}</strong> and can&apos;t be undone.
              </p>
              <p className="muted">Existing bookings will be marked cancelled.</p>
            </>
          )
        }
      />
      <p className="small muted table-foot">
        <Icon name="info" size={14} /> Tip: Cancel keeps the event visible (as cancelled); Delete removes it entirely.
      </p>
    </>
  )
}
