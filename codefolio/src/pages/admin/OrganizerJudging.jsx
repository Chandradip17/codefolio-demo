import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import Icon from '../../components/Icon'
import Modal, { ConfirmDialog } from '../../components/Modal'
import { Badge, Button, EmptyState, ErrorState, Input, Select } from '../../components/ui'
import { useToast } from '../../context/ToastContext'
import * as api from '../../services/api'
import { formatDate, formatDateTime } from '../../utils/format'
import { formatScore } from '../../utils/scoring'

// Picks the hackathon to manage (?h=<id>), defaulting to the most recent one.
export function useHackathonPicker(paramId) {
  const [params, setParams] = useSearchParams()
  const [list, setList] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => {
    api.organizerHackathons().then(setList, (e) => setError(e.message))
  }, [])
  const id = paramId || params.get('h') || list?.[0]?.id || ''
  const choose = (v) => setParams(v ? { h: v } : {}, { replace: true })
  return { list, error, id, choose }
}

function ReviewsModal({ row, criteria, onClose }) {
  return (
    <Modal open onClose={onClose} title={`Reviews · ${row.project.title}`} size="md">
      <div className="answers">
        {row.summary.varianceFlag && (
          <p className="form-error" role="status">
            <Icon name="alert" size={15} /> Score variance detected ({formatScore(row.summary.min)} – {formatScore(row.summary.max)}). Scores are
            unchanged; check the reviews below.
          </p>
        )}
        {!row.reviews.length ? (
          <p className="muted">No reviews yet.</p>
        ) : (
          <div className="table-card">
            <table className="data-table data-table--dense">
              <thead>
                <tr>
                  <th scope="col">Judge</th>
                  {criteria.map((c) => (
                    <th key={c.id} scope="col" className="num" title={c.label}>
                      {c.label.split(' ')[0]}
                    </th>
                  ))}
                  <th scope="col" className="num">
                    Weighted
                  </th>
                </tr>
              </thead>
              <tbody>
                {row.reviews.map((r) => (
                  <tr key={r.id}>
                    <td data-label="Judge">
                      <strong>{r.judgeName}</strong>
                    </td>
                    {criteria.map((c) => (
                      <td key={c.id} data-label={c.label} className="num">
                        {r[c.id]}
                      </td>
                    ))}
                    <td data-label="Weighted" className="num">
                      <strong>{formatScore(r.weighted)}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {row.reviews.some((r) => r.feedback) && (
          <dl className="answers__list">
            {row.reviews
              .filter((r) => r.feedback)
              .map((r) => (
                <div key={r.id}>
                  <dt>
                    {r.judgeName} · {formatDateTime(r.updatedAt)}
                  </dt>
                  <dd className="pre-line">{r.feedback}</dd>
                </div>
              ))}
          </dl>
        )}
      </div>
    </Modal>
  )
}

export default function OrganizerJudging() {
  const toast = useToast()
  const { list, error: listError, id, choose } = useHackathonPicker()
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [q, setQ] = useState('')
  const [found, setFound] = useState([])
  const [searching, setSearching] = useState(false)
  const [busyId, setBusyId] = useState('')
  const [removing, setRemoving] = useState(null)
  const [viewing, setViewing] = useState(null)

  const load = useCallback(async () => {
    if (!id) return
    setError('')
    try {
      setData(await api.hackathonJudging(id))
    } catch (e) {
      setError(e.message)
    }
  }, [id])
  useEffect(() => {
    setData(null)
    load()
  }, [load])

  // Approved judges only (the API never returns pending/rejected applicants).
  useEffect(() => {
    let live = true
    setSearching(true)
    const t = setTimeout(() => {
      api
        .approvedJudges(q)
        .then((j) => live && setFound(j))
        .catch(() => live && setFound([]))
        .finally(() => live && setSearching(false))
    }, 250)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [q])

  const assigned = useMemo(() => new Set((data?.judges || []).map((j) => j.id)), [data])

  async function assign(judge) {
    setBusyId(judge.id)
    try {
      await api.assignJudge(id, judge.id)
      toast({ title: `${judge.name} assigned`, message: 'They can start reviewing from their Judge Dashboard.' })
      load()
    } catch (e) {
      toast({ title: 'Couldn’t assign judge', message: e.message, tone: 'error' })
    } finally {
      setBusyId('')
    }
  }

  async function confirmRemove() {
    setBusyId(removing.id)
    try {
      await api.unassignJudge(id, removing.id)
      toast({ title: `${removing.name} removed`, tone: 'info' })
      setRemoving(null)
      load()
    } catch (e) {
      toast({ title: 'Couldn’t remove judge', message: e.message, tone: 'error' })
      setRemoving(null)
    } finally {
      setBusyId('')
    }
  }

  const totals = useMemo(() => {
    if (!data) return null
    const done = data.projects.reduce((t, r) => t + r.summary.reviews, 0)
    const expected = data.projects.length * data.judges.length
    return { done, expected, flagged: data.projects.filter((r) => r.summary.varianceFlag).length }
  }, [data])

  if (listError) return <ErrorState message={listError} />
  if (list && !list.length) {
    return (
      <>
        <header className="dash-head">
          <div>
            <p className="eyebrow">Judging</p>
            <h1>Judging</h1>
          </div>
        </header>
        <EmptyState
          icon="trophy"
          title="No hackathons yet"
          message="Create a hackathon first. Then assign approved judges to review its projects."
          action={
            <Button to="/admin/events/new" icon="plus">
              Add Event
            </Button>
          }
        />
      </>
    )
  }

  return (
    <>
      <header className="dash-head">
        <div>
          <p className="eyebrow">Judging</p>
          <h1>Judging</h1>
          <p className="muted">Assign approved judges, follow review progress and spot projects whose judges disagree.</p>
        </div>
        {id && (
          <Button variant="secondary" icon="trophy" to={`/organizer/results/${id}`}>
            Results
          </Button>
        )}
      </header>

      <div className="table-tools">
        <Select
          label="Hackathon"
          value={id}
          onChange={(e) => choose(e.target.value)}
          options={(list || []).map((h) => ({ value: h.id, label: `${h.title} · ${formatDate(h.date, { year: false })}` }))}
        />
      </div>

      {error ? (
        <ErrorState message={error} onRetry={load} />
      ) : !data ? (
        <div className="skeleton" style={{ height: 320, borderRadius: 20 }} />
      ) : (
        <>
          <div className="event-summary card">
            <div>
              <strong>{data.event.title}</strong>
              <p className="small muted">
                {formatDate(data.event.date, { weekday: true })} ·{' '}
                {data.event.resultsPublishedAt ? `results published ${formatDateTime(data.event.resultsPublishedAt)}` : 'results not published'}
              </p>
            </div>
            <div className="event-summary__nums">
              <span>
                <strong>{data.projects.length}</strong> projects
              </span>
              <span>
                <strong>{data.judges.length}</strong> judges
              </span>
              <span>
                <strong>
                  {totals.done}/{totals.expected}
                </strong>{' '}
                reviews
              </span>
              <span>
                <strong>{totals.flagged}</strong> flagged
              </span>
            </div>
          </div>

          <div className="chart-grid">
            <section className="card" aria-labelledby="judges-h">
              <div className="card__head">
                <h3 id="judges-h">Assigned judges</h3>
              </div>
              {data.judges.length ? (
                <ul className="mini-list">
                  {data.judges.map((j) => (
                    <li key={j.id}>
                      <div>
                        <strong>{j.name}</strong>
                        <small>
                          {j.organization || (j.username ? `@${j.username}` : 'Judge')} · {j.reviewed}/{data.projects.length} reviewed
                        </small>
                      </div>
                      <span className="mini-list__right">
                        <Button
                          size="sm"
                          variant="danger-ghost"
                          icon="x"
                          onClick={() => setRemoving(j)}
                          disabled={j.reviewed > 0}
                          title={j.reviewed > 0 ? 'Judges who have submitted reviews can’t be removed' : 'Remove judge'}
                          aria-label={`Remove ${j.name}`}
                        />
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted small">No judges yet. Add approved judges from the list on the right.</p>
              )}
            </section>

            <section className="card" aria-labelledby="add-h">
              <div className="card__head">
                <h3 id="add-h">Add a judge</h3>
              </div>
              <Input label="Search approved judges" icon="search" placeholder="Name, @username or organization" value={q} onChange={(e) => setQ(e.target.value)} />
              <ul className="mini-list">
                {found.map((j) => (
                  <li key={j.id}>
                    <div>
                      <strong>{j.name}</strong>
                      <small>{j.organization || (j.username ? `@${j.username}` : 'Approved judge')}</small>
                    </div>
                    <span className="mini-list__right">
                      {assigned.has(j.id) ? (
                        <Badge tone="success" icon="check">
                          Assigned
                        </Badge>
                      ) : (
                        <Button size="sm" variant="secondary" icon="plus" onClick={() => assign(j)} loading={busyId === j.id}>
                          Assign
                        </Button>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
              {!found.length && <p className="muted small">{searching ? 'Searching…' : 'No approved judges match. Judges are approved by a platform admin.'}</p>}
            </section>
          </div>

          <section className="dash-section">
            <div className="section-head section-head--tight">
              <h2>Project review status</h2>
              <Button size="sm" variant="ghost" icon="refresh" onClick={load}>
                Refresh
              </Button>
            </div>
            {!data.projects.length ? (
              <EmptyState icon="layers" title="No projects submitted yet" message="Approved participants submit projects from their dashboard." />
            ) : (
              <div className="table-card">
                <table className="data-table data-table--dense">
                  <thead>
                    <tr>
                      <th scope="col">Project</th>
                      <th scope="col">Team</th>
                      <th scope="col">Reviews</th>
                      <th scope="col" className="num">
                        Average
                      </th>
                      <th scope="col">Range</th>
                      <th scope="col">Status</th>
                      <th scope="col">
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.projects.map((row) => {
                      const s = row.summary
                      return (
                        <tr key={row.project.id}>
                          <td data-label="Project" className="cell-title">
                            <span>
                              <strong>{row.project.title}</strong>
                              <small>
                                <a className="link" href={row.project.githubUrl} target="_blank" rel="noopener noreferrer">
                                  GitHub <Icon name="external" size={11} />
                                </a>
                              </small>
                            </span>
                          </td>
                          <td data-label="Team">{row.project.teamName || row.project.members[0]?.name || '—'}</td>
                          <td data-label="Reviews" className="nowrap">
                            {s.reviews}/{s.judges}
                          </td>
                          <td data-label="Average" className="num">
                            <strong>{formatScore(s.average)}</strong>
                          </td>
                          <td data-label="Range" className="nowrap">
                            {s.reviews > 1 ? `${formatScore(s.min)} – ${formatScore(s.max)}` : '–'}
                            {s.varianceFlag && (
                              <>
                                {' '}
                                <Badge tone="warn" icon="alert">
                                  Variance
                                </Badge>
                              </>
                            )}
                          </td>
                          <td data-label="Status">
                            <Badge tone={s.complete ? 'success' : s.reviews ? 'info' : 'neutral'}>
                              {s.complete ? 'Complete' : s.reviews ? 'In progress' : 'Not started'}
                            </Badge>
                          </td>
                          <td className="cell-actions">
                            <div className="row-actions">
                              <Button size="sm" variant="ghost" icon="eye" onClick={() => setViewing(row)} title="View reviews" aria-label={`View reviews of ${row.project.title}`} />
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <p className="small muted table-foot">
              <Icon name="info" size={14} /> Projects are flagged when judges’ weighted scores are {data.varianceThreshold}+ points apart. Flags are for
              your review only; no score is changed.
            </p>
          </section>
        </>
      )}

      {viewing && <ReviewsModal row={viewing} criteria={data.criteria} onClose={() => setViewing(null)} />}
      <ConfirmDialog
        open={Boolean(removing)}
        onClose={() => setRemoving(null)}
        onConfirm={confirmRemove}
        busy={Boolean(busyId)}
        title="Remove this judge?"
        confirmLabel="Remove"
        cancelLabel="Cancel"
        message={removing && <p>{removing.name} will no longer see this hackathon’s projects.</p>}
      />
    </>
  )
}
