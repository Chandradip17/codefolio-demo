import { Link, useParams } from 'react-router-dom'
import Icon from '../components/Icon'
import { DemoTimer, PresentationBadge, SessionBadge } from '../components/DemoBits'
import { Button, EmptyState, ErrorState } from '../components/ui'
import { useDemoSession } from '../hooks/useDemoSession'

// Presentation screen: current team + shared timer + running order. Open to the
// organizer, assigned judges and approved participants of the hackathon.
export default function DemoPresentation() {
  const { eventId } = useParams()
  const { state, error, load, timer, current, upNext } = useDemoSession(eventId)

  if (error) {
    return (
      <div className="container page-pad">
        {error.status === 404 ? (
          <EmptyState icon="lock" title="Demo Day not available" message="It doesn’t exist, or you aren’t part of this hackathon." action={<Button to="/dashboard" icon="arrowLeft" variant="secondary">Back to dashboard</Button>} />
        ) : (
          <ErrorState message={error.message} onRetry={load} />
        )}
      </div>
    )
  }
  if (!state) {
    return (
      <div className="container page-pad">
        <div className="skeleton" style={{ height: 420, borderRadius: 20 }} />
      </div>
    )
  }
  const s = state.session
  const role = state.role || {}

  return (
    <div className="container page-pad">
      <header className="dash-head">
        <div>
          <p className="eyebrow">Demo Day · {state.event.title}</p>
          <h1>{current ? current.project.title : s?.status === 'ended' ? 'Demo Day has ended' : 'Demo Day'}</h1>
          <p className="muted">
            {current ? [current.project.teamName, ...(current.project.members || []).filter((m) => m !== current.project.teamName)].join(' · ') : s ? <SessionBadge status={s.status} /> : 'The organizer hasn’t set up Demo Day yet.'}
          </p>
        </div>
        <div className="dash-head__actions">
          {role.judge && (
            <Button to={`/judge/demo/${encodeURIComponent(eventId)}`} variant="secondary" icon="bar">
              Judge view
            </Button>
          )}
          {role.manager && (
            <Button to={`/organizer/demo-day?h=${encodeURIComponent(eventId)}`} variant="secondary" icon="radio">
              Control panel
            </Button>
          )}
        </div>
      </header>

      {!s ? (
        <EmptyState icon="clock" title="Not set up yet" message="Finalists and the running order appear here when the organizer sets up Demo Day." />
      ) : (
        <div className="dash-grid">
          <div className="dash-main">
            <section className="card demo-stage" aria-live="polite">
              <p className="eyebrow">{current ? `Team ${current.order} of ${state.presentations.length}` : upNext ? 'Up next' : ''}</p>
              <h2>{current ? current.project.title : upNext ? upNext.project.title : s.status === 'ended' ? 'Thanks for presenting!' : 'All teams have presented'}</h2>
              <p className="muted">{(current || upNext)?.project.teamName}</p>
              <DemoTimer timer={timer} large />
              {current?.project.demoUrl && (
                <p className="small">
                  <a className="link" href={current.project.demoUrl} target="_blank" rel="noopener noreferrer">
                    Live demo <Icon name="external" size={12} />
                  </a>
                </p>
              )}
            </section>
          </div>
          <aside className="dash-aside" aria-label="Running order">
            <section className="card">
              <div className="card__head">
                <h3>Running order</h3>
              </div>
              <ol className="mini-list demo-order">
                {state.presentations.map((p) => (
                  <li key={p.id} className={p.id === current?.id ? 'is-current' : ''}>
                    <div>
                      <strong>
                        {p.order}. {p.project.title}
                      </strong>
                      <small>{p.project.teamName}</small>
                    </div>
                    <span className="mini-list__right">
                      <PresentationBadge status={p.status} />
                    </span>
                  </li>
                ))}
              </ol>
            </section>
            <p className="small muted">
              <Link className="link" to="/dashboard">
                <Icon name="arrowLeft" size={14} /> Dashboard
              </Link>
            </p>
          </aside>
        </div>
      )}
    </div>
  )
}
