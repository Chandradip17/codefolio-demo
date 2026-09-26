import { useEffect, useMemo, useState } from 'react'
import Icon from '../../components/Icon'
import { ConfirmDialog } from '../../components/Modal'
import { DemoTimer, PresentationBadge, SessionBadge } from '../../components/DemoBits'
import { Button, EmptyState, ErrorState, Input, Select } from '../../components/ui'
import { useToast } from '../../context/ToastContext'
import { useDemoSession } from '../../hooks/useDemoSession'
import * as api from '../../services/api'
import { formatDate, formatDateTime } from '../../utils/format'
import { formatScore } from '../../utils/scoring'
import { useHackathonPicker } from './OrganizerJudging'

const minutes = (sec) => String(Math.round((sec / 60) * 10) / 10)

function DemoDayBoard({ eventId }) {
  const toast = useToast()
  const { state, error, load, accept, timer, current, upNext } = useDemoSession(eventId)
  const [form, setForm] = useState(null)
  const [order, setOrder] = useState([])
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)
  const [acting, setActing] = useState('')
  const [confirmEnd, setConfirmEnd] = useState(false)

  // Seed the setup form once per load of a hackathon (live pushes don't overwrite edits).
  const sessionId = state?.session?.id || 'none'
  useEffect(() => {
    if (!state) return
    setForm({ presentation: minutes(state.session?.presentationSeconds ?? 300), qa: minutes(state.session?.qaSeconds ?? 120) })
    setOrder(state.presentations.filter((p) => p.status === 'waiting').map((p) => p.project.id))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId, sessionId, Boolean(state)])

  const s = state?.session
  const history = useMemo(() => (state?.presentations || []).filter((p) => p.status !== 'waiting'), [state])
  const ran = useMemo(() => new Set(history.map((p) => p.project.id)), [history])
  const byId = useMemo(() => new Map((state?.candidates || []).map((c) => [c.id, c])), [state])
  const pool = useMemo(
    () => [...(state?.candidates || [])].filter((c) => !ran.has(c.id) && !order.includes(c.id)).sort((a, b) => (b.average ?? -1) - (a.average ?? -1)),
    [state, ran, order],
  )
  const savedOrder = (state?.presentations || []).filter((p) => p.status === 'waiting').map((p) => p.project.id)
  // Teams that have started, been skipped or completed leave the editable draft.
  const ranKey = [...ran].sort().join(',')
  useEffect(() => {
    setOrder((o) => o.filter((id) => !ran.has(id)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ranKey])
  const dirty =
    form && (!s || JSON.stringify(order) !== JSON.stringify(savedOrder) || minutes(s.presentationSeconds) !== form.presentation || minutes(s.qaSeconds) !== form.qa)

  const move = (i, d) =>
    setOrder((o) => {
      const n = [...o]
      ;[n[i], n[i + d]] = [n[i + d], n[i]]
      return n
    })

  async function save() {
    const e = {}
    const p = Number(form.presentation)
    const q = Number(form.qa)
    if (!Number.isFinite(p) || p < 1 || p > 60) e.presentation = 'Between 1 and 60 minutes.'
    if (!Number.isFinite(q) || q < 0 || q > 30) e.qa = 'Between 0 and 30 minutes.'
    setErrors(e)
    if (Object.keys(e).length) return
    setSaving(true)
    try {
      accept(await api.saveDemoSession(eventId, { presentationSeconds: Math.round(p * 60), qaSeconds: Math.round(q * 60), projectIds: order }))
      toast({ title: 'Demo Day saved', message: `${order.length + history.length} finalist${order.length + history.length === 1 ? '' : 's'} in the running order.` })
    } catch (x) {
      toast({ title: 'Couldn’t save', message: x.message, tone: 'error' })
    } finally {
      setSaving(false)
    }
  }

  async function act(action, presentationId) {
    setActing(action)
    try {
      accept(await api.demoControl(eventId, action, presentationId))
    } catch (x) {
      toast({ title: 'Couldn’t update Demo Day', message: x.message, tone: 'error' })
      load()
    } finally {
      setActing('')
      setConfirmEnd(false)
    }
  }

  if (error) return <ErrorState message={error.message} onRetry={load} />
  if (!state || !form) return <div className="skeleton" style={{ height: 320, borderRadius: 20 }} />

  const live = s?.status === 'live'
  const ended = s?.status === 'ended'
  const waitingCount = state.presentations.filter((p) => p.status === 'waiting').length
  const done = state.presentations.filter((p) => ['completed', 'skipped'].includes(p.status)).length

  return (
    <>
      <div className="event-summary card">
        <div>
          <strong>{state.event.title}</strong>
          <p className="small muted">
            {formatDate(state.event.date, { weekday: true })} · {s ? <SessionBadge status={s.status} /> : 'not set up yet'}
            {s?.startedAt ? ` · started ${formatDateTime(s.startedAt)}` : ''}
          </p>
        </div>
        <div className="event-summary__nums">
          <span>
            <strong>{state.presentations.length}</strong> finalists
          </span>
          <span>
            <strong>{done}</strong> done
          </span>
          <span>
            <strong>{waitingCount}</strong> waiting
          </span>
          {s && (
            <span>
              <strong>
                {minutes(s.presentationSeconds)} + {minutes(s.qaSeconds)}
              </strong>{' '}
              min
            </span>
          )}
        </div>
      </div>

      {s && (
        <section className="card judge-card demo-control" aria-labelledby="live-h">
          <div className="card__head">
            <h3 id="live-h">
              <Icon name="radio" size={17} /> Live control
            </h3>
            <Button size="sm" variant="ghost" icon="external" href={`/demo/${encodeURIComponent(eventId)}`} target="_blank" rel="noopener noreferrer">
              Presentation screen
            </Button>
          </div>
          <div className="demo-now">
            <div className="demo-now__who">
              <p className="eyebrow">{current ? `Now · #${current.order}` : ended ? 'Demo Day ended' : live ? 'Between teams' : 'Not started'}</p>
              <h2>{current ? current.project.title : upNext ? `Up next: ${upNext.project.title}` : ended ? 'Thanks, everyone!' : 'No team waiting'}</h2>
              <p className="muted">{current ? current.project.teamName : upNext ? upNext.project.teamName : ''}</p>
            </div>
            <DemoTimer timer={timer} />
          </div>
          <div className="row-actions demo-actions">
            {!live && !ended && (
              <Button icon="radio" onClick={() => act('start_session')} loading={acting === 'start_session'} disabled={!state.presentations.length || dirty}>
                Start Demo Day
              </Button>
            )}
            {live && !current && (
              <Button icon="arrowRight" onClick={() => act('start')} loading={acting === 'start'} disabled={!upNext}>
                Start next team
              </Button>
            )}
            {live && current?.status === 'presenting' && s.qaSeconds > 0 && (
              <Button icon="users" onClick={() => act('qa')} loading={acting === 'qa'}>
                Start Q&amp;A
              </Button>
            )}
            {live && current && (
              <Button variant="secondary" icon={s.pausedAt ? 'arrowRight' : 'clock'} onClick={() => act(s.pausedAt ? 'resume' : 'pause')} loading={acting === 'pause' || acting === 'resume'}>
                {s.pausedAt ? 'Resume timer' : 'Pause timer'}
              </Button>
            )}
            {live && current && (
              <Button variant="secondary" icon="check" onClick={() => act('end')} loading={acting === 'end'}>
                End presentation
              </Button>
            )}
            {live && current && upNext && (
              <Button variant="secondary" icon="arrowRight" onClick={() => act('next')} loading={acting === 'next'}>
                Next team
              </Button>
            )}
            {live && current && (
              <Button variant="danger-ghost" icon="x" onClick={() => act('skip')} loading={acting === 'skip'}>
                Skip team
              </Button>
            )}
            {live && (
              <Button variant="danger-ghost" icon="ban" onClick={() => setConfirmEnd(true)}>
                End Demo Day
              </Button>
            )}
          </div>
          {!live && !ended && dirty && <p className="small muted">Save your changes before starting.</p>}
          <p className="small muted">
            <Icon name="info" size={14} /> The timer runs on the server, so judges, teams and the presentation screen all see the same time.
          </p>
        </section>
      )}

      <div className="chart-grid">
        <section className="card" aria-labelledby="order-h">
          <div className="card__head">
            <h3 id="order-h">Running order</h3>
          </div>
          {!state.presentations.length && !order.length ? (
            <p className="muted small">No finalists yet. Add projects from the list on the right.</p>
          ) : (
            <ol className="mini-list demo-order">
              {history.map((p) => (
                <li key={p.id}>
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
              {order.map((id, i) => {
                const c = byId.get(id)
                return (
                  <li key={id}>
                    <div>
                      <strong>
                        {history.length + i + 1}. {c?.title || 'Project'}
                      </strong>
                      <small>
                        {c?.teamName} · avg {formatScore(c?.average)}
                      </small>
                    </div>
                    {!ended && (
                      <span className="mini-list__right">
                        <Button size="sm" variant="ghost" icon="arrowUp" aria-label={`Move ${c?.title} up`} disabled={i === 0} onClick={() => move(i, -1)} />
                        <Button size="sm" variant="ghost" icon="arrowDown" aria-label={`Move ${c?.title} down`} disabled={i === order.length - 1} onClick={() => move(i, 1)} />
                        <Button size="sm" variant="danger-ghost" icon="x" aria-label={`Remove ${c?.title}`} onClick={() => setOrder((o) => o.filter((x) => x !== id))} />
                        {live && !current && (
                          <Button size="sm" variant="secondary" onClick={() => act('start', state.presentations.find((p) => p.project.id === id)?.id)} disabled={dirty || !savedOrder.includes(id)}>
                            Start
                          </Button>
                        )}
                      </span>
                    )}
                  </li>
                )
              })}
            </ol>
          )}
        </section>

        <section className="card" aria-labelledby="setup-h">
          <div className="card__head">
            <h3 id="setup-h">{s ? 'Setup' : 'Set up Demo Day'}</h3>
          </div>
          {ended ? (
            <p className="muted small">This Demo Day has ended. Scores and results stay in Judging.</p>
          ) : (
            <div className="form-stack">
              <div className="grid-2">
                <Input label="Presentation (minutes)" type="number" min="1" max="60" step="0.5" value={form.presentation} error={errors.presentation} onChange={(e) => setForm((f) => ({ ...f, presentation: e.target.value }))} />
                <Input label="Q&A (minutes)" type="number" min="0" max="30" step="0.5" value={form.qa} error={errors.qa} onChange={(e) => setForm((f) => ({ ...f, qa: e.target.value }))} />
              </div>
              <div className="field">
                <span className="field__label">Add finalists</span>
                {pool.length ? (
                  <ul className="mini-list">
                    {pool.map((c) => (
                      <li key={c.id}>
                        <div>
                          <strong>{c.title}</strong>
                          <small>
                            {c.teamName} · avg {formatScore(c.average)} · {c.reviews} review{c.reviews === 1 ? '' : 's'}
                          </small>
                        </div>
                        <span className="mini-list__right">
                          <Button size="sm" variant="secondary" icon="plus" onClick={() => setOrder((o) => [...o, c.id])}>
                            Add
                          </Button>
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted small">{state.candidates?.length ? 'Every submitted project is in the running order.' : 'No projects submitted yet.'}</p>
                )}
                <p className="field__hint">Sorted by current judging average. Averages are shown for reference only — you choose the finalists.</p>
              </div>
              <Button icon="check" onClick={save} loading={saving} disabled={!dirty}>
                {s ? 'Save changes' : 'Create Demo Day'}
              </Button>
            </div>
          )}
        </section>
      </div>

      <ConfirmDialog
        open={confirmEnd}
        onClose={() => setConfirmEnd(false)}
        onConfirm={() => act('end_session')}
        busy={acting === 'end_session'}
        title="End Demo Day?"
        confirmLabel="End Demo Day"
        message={<p>Teams that haven’t presented stay in the list as not presented. This can’t be undone.</p>}
      />
    </>
  )
}

export default function OrganizerDemoDay() {
  const { list, error, id, choose } = useHackathonPicker()
  if (error) return <ErrorState message={error} />
  return (
    <>
      <header className="dash-head">
        <div>
          <p className="eyebrow">Demo Day</p>
          <h1>Demo Day</h1>
          <p className="muted">Pick finalists, set the running order and run the live presentations with a shared timer.</p>
        </div>
      </header>
      {list && !list.length ? (
        <EmptyState
          icon="trophy"
          title="No hackathons yet"
          message="Create a hackathon first. Demo Day runs on its submitted projects."
          action={
            <Button to="/admin/events/new" icon="plus">
              Add Event
            </Button>
          }
        />
      ) : (
        <>
          <div className="table-tools">
            <Select
              label="Hackathon"
              value={id}
              onChange={(e) => choose(e.target.value)}
              options={(list || []).map((h) => ({ value: h.id, label: `${h.title} · ${formatDate(h.date, { year: false })}` }))}
            />
          </div>
          {id ? <DemoDayBoard key={id} eventId={id} /> : <div className="skeleton" style={{ height: 320, borderRadius: 20 }} />}
        </>
      )}
    </>
  )
}
