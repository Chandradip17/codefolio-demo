import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import Icon from '../../components/Icon'
import { DemoTimer, PresentationBadge, SessionBadge } from '../../components/DemoBits'
import { Button, EmptyState, ErrorState, Textarea } from '../../components/ui'
import { useDemoSession } from '../../hooks/useDemoSession'
import * as api from '../../services/api'
import { formatDateTime } from '../../utils/format'
import { LinkRow, ScoreForm } from './JudgeProject'

// Private notes, autosaved. Visible only to this judge.
function NotesCard({ projectId }) {
  const [notes, setNotes] = useState(null)
  const [saved, setSaved] = useState(null)
  const [status, setStatus] = useState('')
  const timer = useRef(null)

  useEffect(() => {
    let live = true
    setNotes(null)
    api.judgeNotes(projectId).then(
      (r) => live && (setNotes(r.notes), setSaved(r.updatedAt)),
      () => live && setNotes(''),
    )
    return () => {
      live = false
    }
  }, [projectId])

  const persist = useCallback(
    async (text) => {
      setStatus('Saving…')
      try {
        const r = await api.saveJudgeNotes(projectId, text)
        setSaved(r.updatedAt)
        setStatus('')
      } catch (e) {
        setStatus(e.message)
      }
    },
    [projectId],
  )
  useEffect(() => () => clearTimeout(timer.current), [])

  return (
    <section className="card judge-card" aria-labelledby="notes-h">
      <div className="card__head">
        <h3 id="notes-h">
          <Icon name="edit" size={17} /> Private notes
        </h3>
      </div>
      <Textarea
        label="Only you can see these"
        rows={6}
        maxLength={5000}
        value={notes ?? ''}
        disabled={notes === null}
        placeholder="Questions to ask, what stood out, concerns…"
        onChange={(e) => {
          const v = e.target.value
          setNotes(v)
          clearTimeout(timer.current)
          timer.current = setTimeout(() => persist(v), 800)
        }}
        hint={status || (saved ? `Saved ${formatDateTime(saved)}` : 'Saved automatically')}
      />
    </section>
  )
}

function CurrentProject({ projectId }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    setError('')
    try {
      setData(await api.judgeProject(projectId))
    } catch (e) {
      setError(e.message)
    }
  }, [projectId])
  useEffect(() => {
    setData(null)
    load()
  }, [load])

  if (error) return <ErrorState message={error} onRetry={load} />
  if (!data) return <div className="skeleton" style={{ height: 320, borderRadius: 20 }} />
  const p = data.project
  return (
    <div className="dash-grid">
      <div className="dash-main judge-main">
        <section className="card judge-card" aria-labelledby="sub-h">
          <div className="card__head">
            <h3 id="sub-h">Submission</h3>
            <Button size="sm" variant="ghost" to={`/judge/projects/${p.id}`} iconRight="arrowRight">
              Full details
            </Button>
          </div>
          <div className="judge-block">
            <h4>Problem statement</h4>
            <p className="pre-line">{p.problemStatement}</p>
          </div>
          {p.techStack.length > 0 && (
            <div className="judge-block">
              <h4>Tech stack</h4>
              <div className="tag-row">
                {p.techStack.map((t) => (
                  <span key={t} className="tag">
                    {t}
                  </span>
                ))}
              </div>
            </div>
          )}
          <div className="judge-block">
            <h4>Links</h4>
            <ul className="judge-links">
              <LinkRow icon="github" label="GitHub" href={p.githubUrl} />
              <LinkRow icon="globe" label="Live demo" href={p.demoUrl} />
            </ul>
          </div>
        </section>
        <NotesCard projectId={p.id} />
      </div>
      <aside className="dash-aside" aria-label="Scoring">
        <ScoreForm
          key={data.myReview?.updatedAt || p.id}
          projectId={p.id}
          criteria={data.criteria}
          review={data.myReview}
          canReview={data.canReview}
          lockedReason={data.event.resultsPublished ? 'Results are published, so reviews are closed.' : 'You’re a participant in this hackathon, so you can’t judge it.'}
          onSaved={(r) => setData((d) => ({ ...d, myReview: r }))}
        />
      </aside>
    </div>
  )
}

export default function JudgeDemo() {
  const { eventId } = useParams()
  const { state, error, load, timer, current, upNext } = useDemoSession(eventId)
  // Keep scoring the last team after the organizer moves on, until the judge switches.
  const [focus, setFocus] = useState(null)
  useEffect(() => {
    if (current) setFocus(current.project.id)
  }, [current])

  if (error) {
    return (
      <div className="container page-pad">
        {error.status === 404 ? (
          <EmptyState icon="lock" title="Demo Day not available" message="You aren’t assigned to judge this hackathon." action={<Button to="/judge/dashboard" icon="arrowLeft" variant="secondary">Judge Dashboard</Button>} />
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
  const focused = state.presentations.find((p) => p.project.id === focus)

  return (
    <div className="container page-pad">
      <p className="small">
        <Link className="link" to="/judge/dashboard">
          <Icon name="arrowLeft" size={14} /> Judge Dashboard
        </Link>
      </p>
      <header className="dash-head">
        <div>
          <p className="eyebrow">Demo Day · {state.event.title}</p>
          <h1>{current ? current.project.title : 'Demo Day'}</h1>
          <p className="muted">{current ? current.project.teamName : s ? <SessionBadge status={s.status} /> : 'The organizer hasn’t set up Demo Day yet.'}</p>
        </div>
        <div className="dash-head__actions">
          <Button to={`/demo/${encodeURIComponent(eventId)}`} variant="secondary" icon="external">
            Presentation screen
          </Button>
        </div>
      </header>

      {s && (
        <div className="card demo-now demo-now--bar">
          <div className="demo-now__who">
            <p className="eyebrow">{current ? `Presenting · #${current.order}` : upNext ? 'Up next' : 'No team presenting'}</p>
            <strong>{current ? current.project.title : upNext?.project.title || '—'}</strong>
          </div>
          <DemoTimer timer={timer} />
        </div>
      )}

      {s && state.presentations.length > 0 && (
        <div className="chip-row demo-picker" role="group" aria-label="Finalists">
          {state.presentations.map((p) => (
            <button key={p.id} type="button" className="chip" aria-pressed={p.project.id === focus} onClick={() => setFocus(p.project.id)}>
              {p.order}. {p.project.title}
              {p.status !== 'waiting' && <PresentationBadge status={p.status} />}
            </button>
          ))}
        </div>
      )}

      {!s ? (
        <EmptyState icon="clock" title="Not set up yet" message="When the organizer sets up Demo Day, the running order and timer appear here." />
      ) : focused ? (
        <CurrentProject key={focused.project.id} projectId={focused.project.id} />
      ) : (
        <EmptyState icon="users" title="Pick a team" message="The team on stage opens automatically. You can also pick any finalist above to take notes or score." />
      )}
    </div>
  )
}
