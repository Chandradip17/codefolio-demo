import { useEffect, useState } from 'react'
import { Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import Modal from './Modal'
import Icon from './Icon'
import ApplicationForm, { teamLimits } from './ApplicationForm'
import { seatInfo } from './EventCard'
import { Badge, Button, CategoryBadge, EmptyState, SourceBadge, StatusBadge } from './ui'
import { useAuth } from '../context/AuthContext'
import { useData } from '../context/DataContext'
import { useToast } from '../context/ToastContext'
import { useCloseEvent } from '../hooks/useOpenEvent'
import { rememberNext } from '../services/supabase'
import { compactNumber, cx, formatDate, formatDateTime, formatTime } from '../utils/format'
import { fallbackImage } from '../data/images'
import { CopyCode } from './BookingCard'

// Mounted once in the layout; opens whenever `?event=<id>` is in the URL.
export function EventModalHost() {
  const [params] = useSearchParams()
  const id = params.get('event')
  const close = useCloseEvent()
  const { getEvent, localStatus, gdgStatus, dfStatus } = useData()
  const event = id ? getEvent(id) : null
  const stillLoading = localStatus.loading || gdgStatus.loading || dfStatus.loading
  const [confirmed, setConfirmed] = useState(null)
  const { user, ready } = useAuth()
  const location = useLocation()

  useEffect(() => setConfirmed(null), [id])

  if (!id) return null
  // A shared ?event= link opened while logged out: sign in first, then return here.
  if (ready && !user) {
    const here = location.pathname + location.search
    rememberNext(here)
    return <Navigate to="/login" replace state={{ from: here }} />
  }
  if (!event) {
    return (
      <Modal open onClose={close} title="Event" size="sm">
        {stillLoading ? (
          <div className="modal-loading">
            <span className="spinner spinner--lg" aria-hidden="true" /> Loading event…
          </div>
        ) : (
          <EmptyState icon="calendar" title="Event not found" message="It may have been removed or the link is out of date." />
        )}
      </Modal>
    )
  }
  return (
    <Modal open onClose={close} title={confirmed ? 'Request submitted' : event.title} size="lg" hideTitle className="event-modal">
      {confirmed ? <BookingConfirmation booking={confirmed} onClose={close} /> : <EventDetails event={event} onBooked={setConfirmed} />}
    </Modal>
  )
}

function Row({ icon, label, children }) {
  return (
    <div className="detail-row">
      <span className="detail-row__icon" aria-hidden="true">
        <Icon name={icon} size={17} />
      </span>
      <div>
        <dt>{label}</dt>
        <dd>{children}</dd>
      </div>
    </div>
  )
}

function EventDetails({ event, onBooked }) {
  const { user } = useAuth()
  const { myActiveBooking, myLastBooking, ensureDetail } = useData()
  const toast = useToast()
  const navigate = useNavigate()
  const location = useLocation()
  // Everyone applies individually: one application = one seat.
  const seats = 1
  const [step, setStep] = useState('details')
  const [imgFailed, setImgFailed] = useState(false)

  useEffect(() => {
    ensureDetail(event)
  }, [event, ensureDetail])

  const isLocal = event.source === 'codefolio'
  const seatsInfo = seatInfo(event)
  const soldOut = isLocal && event.availableSeats <= 0
  // Application window set by the host (null = always open until the event).
  const now = Date.now()
  const notOpenYet = isLocal && event.applicationsOpenAt && now < new Date(event.applicationsOpenAt).getTime()
  const appsClosed = isLocal && event.applicationsCloseAt && now > new Date(event.applicationsCloseAt).getTime()
  const cancelled = event.status === 'Cancelled'
  const existing = isLocal && myActiveBooking(event.id)
  const last = isLocal && !existing && myLastBooking(event.id)

  if (step === 'apply') {
    return (
      <ApplicationForm
        event={event}
        seats={seats}
        onBack={() => setStep('details')}
        onSubmitted={(booking) => {
          toast({ title: 'Request submitted', message: `${booking.bookingId} · the organizer will review it soon.` })
          onBooked(booking)
        }}
      />
    )
  }

  const loginToBook = () => navigate('/login', { state: { from: `${location.pathname}${location.search}` } })

  let cta
  if (!isLocal) {
    cta = (
      <>
        <Button href={event.externalUrl} size="lg" iconRight="external" className="btn--block">
          {event.source === 'gdg' ? 'Register on GDG Community' : 'Apply on Devfolio'}
        </Button>
        <p className="cta-note">
          <Icon name="info" size={14} /> Live listing from {event.source === 'gdg' ? 'gdg.community.dev' : 'devfolio.co'}. Registration
          happens on their site.
        </p>
      </>
    )
  } else if (cancelled) {
    cta = (
      <Button size="lg" variant="secondary" disabled className="btn--block" icon="ban">
        Event cancelled
      </Button>
    )
  } else if (!user) {
    cta = (
      <Button size="lg" className="btn--block" icon="lock" onClick={loginToBook}>
        Login to Book
      </Button>
    )
  } else if (event.createdBy === user.id) {
    cta = (
      <>
        <Button size="lg" variant="secondary" className="btn--block" icon="edit" to={`/admin/events/${event.id}/edit`}>
          Manage this event
        </Button>
        <Button size="lg" variant="ghost" className="btn--block" icon="users" to={`/admin/bookings?for=${encodeURIComponent(event.id)}`}>
          Review applications
        </Button>
        <p className="cta-note">
          <Icon name="info" size={14} /> This is your event, so you can't apply to it.
        </p>
      </>
    )
  } else if (existing) {
    const pending = existing.status === 'Pending'
    cta = (
      <>
        <div className={cx('booked-pill', pending && 'booked-pill--pending')}>
          <Icon name={pending ? 'clock' : 'checkCircle'} size={18} />
          {pending ? 'Request pending review' : existing.status === 'Attended' ? 'You attended' : "You're approved"} · <code>{existing.bookingId}</code>
        </div>
        {pending && (
          <p className="cta-note">
            <Icon name="info" size={14} /> The organizer will approve or decline your request. Your QR appears once you&apos;re approved.
          </p>
        )}
        <Button size="lg" variant="secondary" className="btn--block" to="/dashboard">
          View My Bookings
        </Button>
      </>
    )
  } else if (notOpenYet) {
    cta = (
      <>
        <Button size="lg" variant="secondary" disabled className="btn--block" icon="clock">
          Applications open soon
        </Button>
        <p className="cta-note">
          <Icon name="info" size={14} /> Applications open on {formatDateTime(event.applicationsOpenAt)} IST.
        </p>
      </>
    )
  } else if (appsClosed) {
    cta = (
      <Button size="lg" variant="secondary" disabled className="btn--block" icon="lock">
        Applications closed
      </Button>
    )
  } else if (soldOut) {
    cta = (
      <Button size="lg" variant="secondary" disabled className="btn--block">
        Sold Out
      </Button>
    )
  } else {
    cta = (
      <>
        <Button size="lg" className="btn--block" icon="ticket" onClick={() => setStep('apply')}>
          {last?.status === 'Rejected' || last?.status === 'Removed' ? 'Apply again' : 'Book My Seat'}
        </Button>
        <p className="cta-note">
          <Icon name="info" size={14} />
          {last?.status === 'Rejected'
            ? ` Your last request (${last.bookingId}) wasn't approved${last.reviewNote ? `: “${last.reviewNote}”` : '.'}`
            : last?.status === 'Removed'
              ? ` You were removed from this event earlier (${last.bookingId}).`
              : event.category === 'hackathon'
                ? ` Apply solo or as a team (${teamLimits(event).min === teamLimits(event).max ? teamLimits(event).min : `${teamLimits(event).min}–${teamLimits(event).max}`} members): create a team to get a code, or join one with a code.`
                : ' A short application goes to the organizer; your seat is confirmed once they approve it.'}
        </p>
      </>
    )
  }

  const learn = event.learn?.length ? event.learn : null
  const reqs = event.requirements?.length ? event.requirements : null

  return (
    <div className="event-detail">
      <div className="event-detail__hero">
        <img src={imgFailed ? fallbackImage(event.category, event.id) : event.image} alt="" onError={() => setImgFailed(true)} />
        <div className="event-detail__hero-overlay">
          <div className="badge-row">
            <CategoryBadge category={event.category} />
            <SourceBadge event={event} />
            {cancelled && <StatusBadge status="Cancelled" />}
            {event.status === 'Draft' && <StatusBadge status="Draft" />}
          </div>
          <p className="event-detail__title" aria-hidden="true">
            {event.title}
          </p>
          <p className="event-detail__org">
            by <strong>{event.organizerChapter}</strong>
          </p>
        </div>
      </div>

      <div className="event-detail__grid">
        <div className="event-detail__main">
          {event.tagline && <p className="lead">{event.tagline}</p>}
          <section>
            <h3>About this {event.type === 'Hackathon' ? 'hackathon' : 'event'}</h3>
            {event.description ? (
              <div className="prose">
                {event.description
                  .split(/\n{2,}/)
                  .slice(0, 8)
                  .map((para, i) => (
                    <p key={i}>{para.length > 900 ? `${para.slice(0, 900)}…` : para}</p>
                  ))}
              </div>
            ) : event.source === 'gdg' && !event.enriched ? (
              <div className="prose">
                <div className="skeleton skeleton--line" />
                <div className="skeleton skeleton--line" style={{ width: '85%' }} />
                <div className="skeleton skeleton--line" style={{ width: '60%' }} />
              </div>
            ) : (
              <p className="muted">The organizers haven't added a description yet.</p>
            )}
            {event.isSample && (
              <p className="sample-note">
                <Icon name="info" size={14} /> Sample event for demo purposes. Not a verified real-world event.
              </p>
            )}
          </section>

          {learn && (
            <section>
              <h3>What you'll learn</h3>
              <ul className="check-list">
                {learn.map((l) => (
                  <li key={l}>
                    <Icon name="check" size={16} /> {l}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {reqs && (
            <section>
              <h3>Requirements</h3>
              <ul className="dot-list">
                {reqs.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </section>
          )}
          {event.prizes?.length > 0 && (
            <section>
              <h3>Prizes</h3>
              <ul className="check-list">
                {event.prizes.map((p) => (
                  <li key={p}>
                    <Icon name="trophy" size={16} /> {p}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {event.tags?.length > 0 && (
            <div className="tag-row">
              {event.tags.slice(0, 8).map((t) => (
                <span key={t} className="tag">
                  #{t}
                </span>
              ))}
            </div>
          )}

          <section className="organizer-box">
            <div className="avatar avatar--lg" aria-hidden="true">
              {event.logo ? <img src={event.logo} alt="" /> : event.organizerChapter.replace(/^GDG( on Campus| Cloud)?\s*/i, '').slice(0, 1)}
            </div>
            <div>
              <p className="eyebrow">Organized by</p>
              <p className="organizer-box__name">{event.organizerChapter}</p>
              {event.organizer?.email && <p className="muted small">{event.organizer.email}</p>}
              {event.chapterUrl && (
                <a className="link" href={event.chapterUrl} target="_blank" rel="noopener noreferrer">
                  Chapter page <Icon name="external" size={13} />
                </a>
              )}
              {event.site && (
                <a className="link" href={event.site} target="_blank" rel="noopener noreferrer">
                  Official website <Icon name="external" size={13} />
                </a>
              )}
            </div>
          </section>
        </div>

        <aside className="event-detail__side" aria-label="Event summary and booking">
          <div className="side-ticket">
            <dl className="detail-list">
              <Row icon="calendar" label="Date">
                {formatDate(event.date, { weekday: true })}
                {event.endDate && event.endDate !== event.date && ` → ${formatDate(event.endDate, { year: false })}`}
              </Row>
              <Row icon="clock" label="Time">
                {formatTime(event.time)}
                {event.endTime && ` – ${formatTime(event.endTime)}`} IST
              </Row>
              <Row icon="pin" label="Venue">
                {event.venue || 'TBA'}
              </Row>
              <Row icon="globe" label="City">
                {event.city || '—'}
              </Row>
              <Row icon={event.hybrid ? 'globe' : event.mode === 'Online' ? 'wifi' : 'building'} label="Mode">
                {event.hybrid ? 'Hybrid (in-person + online)' : event.mode}
              </Row>
              {event.capacity != null && (
                <Row icon="users" label="Capacity">
                  {event.capacity} seats
                </Row>
              )}
              {event.teamSize && (
                <Row icon="users" label="Team size">
                  {event.teamSize} members
                </Row>
              )}
              {isLocal && (
                <Row icon="ticket" label="Application fee">
                  {event.applicationFee > 0 ? `₹${event.applicationFee.toLocaleString('en-IN')} (UPI)` : 'Free'}
                </Row>
              )}
              {event.theme && (
                <Row icon="sparkles" label="Theme / track">
                  {event.theme}
                </Row>
              )}
              {event.applicationsOpenAt && (
                <Row icon="calendar" label="Applications open">
                  {formatDateTime(event.applicationsOpenAt)} IST
                </Row>
              )}
              {event.applicationsCloseAt ? (
                <Row icon="alert" label="Application deadline">
                  {formatDateTime(event.applicationsCloseAt)} IST
                </Row>
              ) : event.registrationDeadline && (
                <Row icon="alert" label="Registration closes">
                  {formatDate(event.registrationDeadline)}
                </Row>
              )}
            </dl>
            <div className="ticket__perf ticket__perf--side" aria-hidden="true" />
            <div className="side-ticket__seats">
              <span className={cx('seat-label', `seat-label--${seatsInfo.tone}`)}>
                {seatsInfo.tone === 'live' ? <span className="live-dot" aria-hidden="true" /> : <Icon name="ticket" size={14} />}
                {isLocal && !cancelled ? (soldOut ? 'Sold Out' : `${event.availableSeats} seats remaining`) : seatsInfo.label}
              </span>
              {seatsInfo.pct != null && (
                <span className="meter" aria-hidden="true">
                  <span className={cx('meter__fill', `meter__fill--${seatsInfo.tone}`)} style={{ width: `${seatsInfo.pct}%` }} />
                </span>
              )}
              {event.source === 'devfolio' && event.registered > 0 && (
                <p className="muted small">{compactNumber(event.registered)} builders have registered so far</p>
              )}
            </div>
            <div className="side-ticket__cta">{cta}</div>
          </div>
        </aside>
      </div>
    </div>
  )
}

function BookingConfirmation({ booking, onClose }) {
  const navigate = useNavigate()
  const e = booking.event
  return (
    <div className="confirmation">
      <div className="confirmation__check" aria-hidden="true">
        <Icon name="check" size={34} strokeWidth={3} />
      </div>
      <h2 className="confirmation__title">Request submitted</h2>
      <p className="muted">
        The organizer will review your application. You&apos;ll see the decision live in your dashboard, and your check-in QR appears there once
        you&apos;re approved.
      </p>

      <div className="pass">
        <div className="pass__top">
          <div>
            <p className="eyebrow">Booking ID</p>
            <p className="pass__id">{booking.bookingId}</p>
          </div>
          <Badge tone="warn" icon="clock">
            Pending review
          </Badge>
        </div>
        <div className="ticket__perf" aria-hidden="true" />
        <dl className="pass__grid">
          <div className="pass__wide">
            <dt>Event</dt>
            <dd>{e.title}</dd>
          </div>
          <div>
            <dt>Date</dt>
            <dd>{formatDate(e.date, { weekday: true })}</dd>
          </div>
          <div>
            <dt>Time</dt>
            <dd>{formatTime(e.time)}</dd>
          </div>
          <div className="pass__wide">
            <dt>Venue</dt>
            <dd>
              {e.venue}
              {e.city && !e.venue.includes(e.city) ? `, ${e.city}` : ''}
            </dd>
          </div>
          {booking.feeAmount ? (
            <div className="pass__wide">
              <dt>Application fee</dt>
              <dd>
                ₹{booking.feeAmount.toLocaleString('en-IN')} · UTR <code>{booking.paymentRef}</code> · the organizer verifies it before approving
              </dd>
            </div>
          ) : null}
          {booking.team ? (
            <div>
              <dt>Team</dt>
              <dd>{booking.team.name}</dd>
            </div>
          ) : booking.participation === 'solo' ? (
            <div>
              <dt>Participation</dt>
              <dd>Solo</dd>
            </div>
          ) : (
            <div>
              <dt>Seats requested</dt>
              <dd>{booking.seats}</dd>
            </div>
          )}
          <div>
            <dt>Attendee</dt>
            <dd>{booking.attendeeName}</dd>
          </div>
        </dl>
        {booking.team && (
          <div className="pass__team">
            <p className="eyebrow">Team code · share it with your teammates</p>
            <CopyCode value={booking.team.code} label="team code" />
            <p className="small muted">
              {booking.team.size} {booking.team.size === 1 ? 'member' : 'members'} so far. Teammates choose “Join team” and enter this code when they apply.
            </p>
          </div>
        )}
        <div className="pass__barcode" aria-hidden="true">
          {booking.bookingId.split('').map((c, i) => (
            <span key={i} style={{ '--w': (c.charCodeAt(0) % 3) + 1 }} />
          ))}
        </div>
      </div>

      <div className="confirmation__actions">
        <Button to="/dashboard" icon="ticket" data-autofocus>
          View My Bookings
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            onClose()
            navigate('/events')
          }}
        >
          Back to Events
        </Button>
      </div>
    </div>
  )
}
