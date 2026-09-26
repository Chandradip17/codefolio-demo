import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import Icon from '../../components/Icon'
import { ConfirmDialog } from '../../components/Modal'
import { Badge, Button, EmptyState, ErrorState } from '../../components/ui'
import { useToast } from '../../context/ToastContext'
import * as api from '../../services/api'
import { formatDate, formatDateTime } from '../../utils/format'
import { formatScore } from '../../utils/scoring'

// Ranking table shared by the organizer view and the public results page.
export function ResultsTable({ rows, criteria, showDetail }) {
  return (
    <div className="table-card">
      <table className="data-table data-table--dense">
        <thead>
          <tr>
            <th scope="col" className="num">
              Rank
            </th>
            <th scope="col">Project</th>
            <th scope="col">Team</th>
            <th scope="col" className="num">
              Score
            </th>
            {criteria.map((c) => (
              <th key={c.id} scope="col" className="num" title={`${c.label} (average)`}>
                {c.label.split(' ')[0]}
              </th>
            ))}
            {showDetail && <th scope="col">Reviews</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.project.id}>
              <td data-label="Rank" className="num">
                <strong>{r.rank ?? '–'}</strong>
              </td>
              <td data-label="Project" className="cell-title">
                <span>
                  <strong>{r.project.title}</strong>
                  <small>
                    <a className="link" href={r.project.githubUrl} target="_blank" rel="noopener noreferrer">
                      GitHub <Icon name="external" size={11} />
                    </a>
                    {r.project.demoUrl && (
                      <>
                        {' · '}
                        <a className="link" href={r.project.demoUrl} target="_blank" rel="noopener noreferrer">
                          Demo <Icon name="external" size={11} />
                        </a>
                      </>
                    )}
                  </small>
                </span>
              </td>
              <td data-label="Team">
                {r.project.teamName || r.project.members[0]?.name || '—'}
                {r.project.teamName && <small className="muted"> · {r.project.members.map((m) => m.name).join(', ')}</small>}
              </td>
              <td data-label="Score" className="num">
                <strong>{formatScore(r.average)}</strong>
              </td>
              {criteria.map((c) => (
                <td key={c.id} data-label={c.label} className="num">
                  {r.perCriterion[c.id] == null ? '–' : r.perCriterion[c.id].toFixed(1)}
                </td>
              ))}
              {showDetail && (
                <td data-label="Reviews" className="nowrap">
                  {r.reviews}/{r.judges}{' '}
                  {r.varianceFlag && (
                    <Badge tone="warn" icon="alert">
                      Variance
                    </Badge>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function OrganizerResults() {
  const { hackathonId } = useParams()
  const toast = useToast()
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [ask, setAsk] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setError(null)
    try {
      setData(await api.hackathonResults(hackathonId))
    } catch (e) {
      setError(e)
    }
  }, [hackathonId])
  useEffect(() => {
    load()
  }, [load])

  const published = Boolean(data?.event.resultsPublishedAt)

  async function confirm() {
    setBusy(true)
    try {
      await api.publishResults(hackathonId, !published)
      toast(
        published
          ? { title: 'Results unpublished', message: 'Members can no longer see them; judges can edit reviews again.', tone: 'info' }
          : { title: 'Results published 🎉', message: 'Members can now see the ranking. Reviews are closed.' },
      )
      setAsk(false)
      load()
    } catch (e) {
      toast({ title: 'Couldn’t update results', message: e.message, tone: 'error' })
      setAsk(false)
    } finally {
      setBusy(false)
    }
  }

  if (error) {
    return error.status === 404 ? (
      <EmptyState icon="trophy" title="Hackathon not found" message="You can only see results for hackathons you organize." />
    ) : (
      <ErrorState message={error.message} onRetry={load} />
    )
  }
  if (!data) return <div className="skeleton" style={{ height: 360, borderRadius: 20 }} />

  const incomplete = data.reviewsDone < data.reviewsExpected
  const rows = data.results.map((r) => ({ ...r, average: r.summary.average, perCriterion: r.summary.perCriterion, reviews: r.summary.reviews, judges: r.summary.judges, varianceFlag: r.summary.varianceFlag }))

  return (
    <>
      <p className="small">
        <Link className="link" to={`/organizer/judging?h=${encodeURIComponent(hackathonId)}`}>
          <Icon name="arrowLeft" size={14} /> Judging
        </Link>
      </p>
      <header className="dash-head">
        <div>
          <p className="eyebrow">Results</p>
          <h1>{data.event.title}</h1>
          <p className="muted">
            {formatDate(data.event.date, { weekday: true })} ·{' '}
            {published ? `published ${formatDateTime(data.event.resultsPublishedAt)}` : 'not published — only you can see this ranking'}
          </p>
        </div>
        <Button variant={published ? 'secondary' : 'primary'} icon={published ? 'eyeOff' : 'trophy'} onClick={() => setAsk(true)} disabled={!data.results.length}>
          {published ? 'Unpublish results' : 'Publish results'}
        </Button>
      </header>

      <div className="event-summary card">
        <div>
          <strong>{published ? <Badge tone="success">Published</Badge> : <Badge tone="warn">Unpublished</Badge>}</strong>
          {published && (
            <p className="small">
              <Link className="link" to={`/results/${hackathonId}`}>
                View the members’ results page <Icon name="arrowRight" size={13} />
              </Link>
            </p>
          )}
        </div>
        <div className="event-summary__nums">
          <span>
            <strong>{data.results.length}</strong> projects
          </span>
          <span>
            <strong>{data.judges}</strong> judges
          </span>
          <span>
            <strong>
              {data.reviewsDone}/{data.reviewsExpected}
            </strong>{' '}
            reviews
          </span>
          <span>
            <strong>{data.reviewsExpected ? Math.round((data.reviewsDone / data.reviewsExpected) * 100) : 0}%</strong> complete
          </span>
        </div>
      </div>

      {!data.results.length ? (
        <EmptyState icon="layers" title="No projects yet" message="Results appear once teams submit projects and judges review them." />
      ) : (
        <>
          <ResultsTable rows={rows} criteria={data.criteria} showDetail />
          <p className="small muted table-foot">
            <Icon name="info" size={14} /> Score = average of the judges’ weighted scores (Innovation 25%, Technical 25%, Impact 20%, UI/UX 15%,
            Presentation 15%). Ties share a rank.
          </p>
        </>
      )}

      <ConfirmDialog
        open={ask}
        onClose={() => setAsk(false)}
        onConfirm={confirm}
        busy={busy}
        tone={published ? 'danger' : 'info'}
        title={published ? 'Unpublish results?' : 'Publish results?'}
        confirmLabel={published ? 'Unpublish' : 'Publish results'}
        cancelLabel="Cancel"
        message={
          published ? (
            <p>Members won’t see the ranking anymore, and judges can edit their reviews again.</p>
          ) : (
            <>
              <p>Signed-in members will see the ranking and average scores (not judge names or feedback). Reviews and submissions close.</p>
              {incomplete && (
                <p className="muted">
                  <strong>Heads up:</strong> only {data.reviewsDone} of {data.reviewsExpected} reviews are in.
                </p>
              )}
            </>
          )
        }
      />
    </>
  )
}
