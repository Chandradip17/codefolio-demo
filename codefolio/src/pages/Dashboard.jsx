import { useMemo, useState } from 'react'
import BookingCard from '../components/BookingCard'
import { ConfirmDialog } from '../components/Modal'
import Icon from '../components/Icon'
import { Button, EmptyState, ErrorState, Segmented } from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { useData } from '../context/DataContext'
import { useToast } from '../context/ToastContext'
import { formatDate, isPast } from '../utils/format'

export default function Dashboard() {
  const { user } = useAuth()
  const { bookings, events, localStatus, loadLocal, cancelBooking } = useData()
  const toast = useToast()
  const [tab, setTab] = useState('upcoming')
  const [target, setTarget] = useState(null)
  const [busy, setBusy] = useState(false)

  const mine = useMemo(() => bookings.filter((b) => b.userId === user.id), [bookings, user.id])
  const eventById = useMemo(() => Object.fromEntries(events.map((e) => [e.id, e])), [events])

  const groups = useMemo(() => {
    const upcoming = []
    const past = []
    const cancelled = []
    for (const b of mine) {
      if (b.status === 'Cancelled') cancelled.push(b)
      else if (isPast(b.event.date) || b.status === 'Attended') past.push(b)
      else upcoming.push(b)
    }
    upcoming.sort((a, b) => a.event.date.localeCompare(b.event.date))
    return { upcoming, past, cancelled }
  }, [mine])

  const stats = useMemo(() => {
    const active = mine.filter((b) => b.status !== 'Cancelled')
    return [
      { label: 'Upcoming', value: groups.upcoming.length, icon: 'calendar', tone: 'indigo' },
      { label: 'Total Booked', value: active.length, icon: 'ticket', tone: 'saffron' },
      { label: 'Cities', value: new Set(active.map((b) => b.event.city)).size, icon: 'pin', tone: 'coral' },
      { label: 'Hackathons Attended', value: groups.past.filter((b) => b.event.category === 'hackathon').length, icon: 'trophy', tone: 'green' },
    ]
  }, [mine, groups])

  async function confirmCancel() {
    setBusy(true)
    try {
      const b = await cancelBooking(target.id)
      toast({ title: 'Booking cancelled', message: `${b.bookingId}: your ${b.seats > 1 ? 'seats have' : 'seat has'} been released.`, tone: 'info' })
      setTarget(null)
    } catch (e) {
      toast({ title: "Couldn't cancel", message: e.message, tone: 'error' })
    } finally {
      setBusy(false)
    }
  }

  const list = groups[tab]
  const next = groups.upcoming[0]

  return (
    <div className="container page-pad">
      <header className="dash-head">
        <div>
          <p className="eyebrow">Attendee dashboard</p>
          <h1>Welcome back, {user.name.split(' ')[0]}!</h1>
          <p className="muted">Here are your upcoming developer events.</p>
        </div>
        <Button to="/events" icon="search">
          Find events
        </Button>
      </header>

      <div className="kpis">
        {stats.map((s) => (
          <div key={s.label} className={`kpi kpi--${s.tone}`}>
            <span className="kpi__icon" aria-hidden="true">
              <Icon name={s.icon} size={20} />
            </span>
            <strong className="kpi__value">{localStatus.loading ? '–' : s.value}</strong>
            <span className="kpi__label">{s.label}</span>
          </div>
        ))}
      </div>

      {next && (
        <div className="next-up">
          <Icon name="zap" size={18} />
          <span>
            Next up: <strong>{next.event.title}</strong> on {formatDate(next.event.date, { weekday: true })}
          </span>
        </div>
      )}

      <section aria-labelledby="bookings-h" className="dash-section">
        <div className="section-head section-head--tight">
          <h2 id="bookings-h">My Bookings</h2>
          <Segmented
            label="Booking filter"
            value={tab}
            onChange={setTab}
            options={[
              { value: 'upcoming', label: 'Upcoming', count: groups.upcoming.length },
              { value: 'past', label: 'Past', count: groups.past.length },
              { value: 'cancelled', label: 'Cancelled', count: groups.cancelled.length },
            ]}
          />
        </div>

        {localStatus.error ? (
          <ErrorState message={localStatus.error} onRetry={loadLocal} />
        ) : localStatus.loading ? (
          <div className="booking-list">
            {[0, 1].map((i) => (
              <div key={i} className="skeleton" style={{ height: 150, borderRadius: 20 }} />
            ))}
          </div>
        ) : list.length ? (
          <div className="booking-list">
            {list.map((b) => (
              <BookingCard
                key={b.id}
                booking={b}
                eventExists={Boolean(eventById[b.eventId])}
                eventCancelled={eventById[b.eventId]?.status === 'Cancelled'}
                onCancel={setTarget}
              />
            ))}
          </div>
        ) : tab === 'upcoming' ? (
          <EmptyState
            icon="ticket"
            title="No bookings yet"
            message="Your next developer event is waiting for you."
            action={
              <Button to="/events" iconRight="arrowRight">
                Explore Events
              </Button>
            }
          />
        ) : (
          <EmptyState icon="calendar" title={`No ${tab} bookings`} message="Nothing to show here yet." />
        )}
      </section>

      <ConfirmDialog
        open={Boolean(target)}
        onClose={() => setTarget(null)}
        onConfirm={confirmCancel}
        busy={busy}
        title="Cancel this booking?"
        confirmLabel="Cancel Booking"
        message={
          target && (
            <>
              <p>
                You&apos;re about to cancel <strong>{target.event.title}</strong> ({target.bookingId}).
              </p>
              <p className="muted">
                Your {target.seats > 1 ? `${target.seats} seats` : 'seat'} will be released to other attendees. You can book again later if seats
                are still available.
              </p>
            </>
          )
        }
      />
    </div>
  )
}
