import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { BarList, ColumnChart } from '../../components/Charts'
import Icon from '../../components/Icon'
import { Button, EmptyState, ErrorState, Select } from '../../components/ui'
import * as api from '../../services/api'
import { formatDate, formatIST, formatTime } from '../../utils/format'
import { useHackathonPicker } from './OrganizerJudging'

const pctText = (v) => (v == null ? '–' : `${v}%`)
const shortDate = (iso) => new Date(`${iso}T00:00:00+05:30`).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short' })

// Registrations per day (≤ 21 days) or per week, with empty days filled in. All dates are IST.
function trend(daily) {
  if (!daily.length) return []
  const byDay = new Map(daily.map((d) => [d.date, d.count]))
  const start = Date.parse(`${daily[0].date}T00:00:00Z`)
  const end = Date.parse(`${daily[daily.length - 1].date}T00:00:00Z`)
  const days = Math.round((end - start) / 86400000) + 1
  const iso = (t) => new Date(t).toISOString().slice(0, 10)
  if (days <= 21) {
    return Array.from({ length: days }, (_, i) => {
      const d = iso(start + i * 86400000)
      return { label: shortDate(d), full: formatDate(d), value: byDay.get(d) || 0 }
    })
  }
  const weeks = Math.ceil(days / 7)
  return Array.from({ length: weeks }, (_, w) => {
    let v = 0
    for (let i = 0; i < 7; i++) v += byDay.get(iso(start + (w * 7 + i) * 86400000)) || 0
    const d = iso(start + w * 7 * 86400000)
    return { label: shortDate(d), full: `Week of ${formatDate(d)}`, value: v }
  }).slice(-12)
}

function Timeline({ t }) {
  const at = (date, time) => (date ? `${formatDate(date, { weekday: true })}${time ? ` · ${formatTime(time.slice(0, 5))} IST` : ''}` : null)
  const steps = [
    { label: 'Registration opens', value: t.applicationsOpenAt && formatIST(t.applicationsOpenAt) },
    { label: 'Registration closes', value: t.applicationsCloseAt && formatIST(t.applicationsCloseAt) },
    { label: 'Hackathon starts', value: at(t.startDate, t.startTime) },
    { label: 'Hackathon ends', value: at(t.endDate, t.endTime) },
    { label: 'Submissions', value: t.firstSubmissionAt ? `${formatIST(t.firstSubmissionAt)} → ${formatIST(t.lastSubmissionAt)}` : null, pending: 'No submissions yet' },
    { label: 'Judging', value: t.firstReviewAt ? `${formatIST(t.firstReviewAt)} → ${formatIST(t.lastReviewAt)}` : null, pending: 'No reviews yet' },
    { label: 'Demo Day', value: t.demoDayStartedAt ? `${formatIST(t.demoDayStartedAt)}${t.demoDayEndedAt ? ' · ended' : ' · live'}` : null, pending: 'Not started' },
    { label: 'Results', value: t.resultsPublishedAt && `Published ${formatIST(t.resultsPublishedAt)}`, pending: 'Not published' },
  ]
  return (
    <ol className="timeline-list">
      {steps.map((s) => (
        <li key={s.label} className={s.value ? 'is-done' : ''}>
          <strong>{s.label}</strong>
          <small className="muted">{s.value || s.pending || 'Not set'}</small>
        </li>
      ))}
    </ol>
  )
}

function Board({ eventId }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    setError('')
    try {
      setData(await api.hackathonAnalytics(eventId))
    } catch (e) {
      setError(e.message)
    }
  }, [eventId])
  useEffect(() => {
    setData(null)
    load()
  }, [load])

  const charts = useMemo(() => {
    if (!data) return null
    const s = data.submissions
    return {
      trend: trend(data.registrations.daily),
      tech: data.tech.top.map((t) => ({ label: t.label, value: t.count, full: `${t.count} of ${data.tech.projectsWithTech} projects` })),
      status: [
        { label: 'Not started', value: s.notStarted },
        { label: 'Awaiting review', value: s.awaitingReview },
        { label: 'Partly reviewed', value: s.partiallyReviewed },
        { label: 'Fully reviewed', value: s.fullyReviewed },
      ],
      sizes: Object.entries(data.teams.sizes)
        .sort((a, b) => Number(a[0]) - Number(b[0]))
        .map(([size, n]) => ({ label: `${size} member${size === '1' ? '' : 's'}`, value: n })),
      regStatus: ['Pending', 'Confirmed', 'Attended', 'Rejected', 'Cancelled', 'Removed']
        .filter((k) => data.registrations.byStatus[k])
        .map((k) => ({ label: k, value: data.registrations.byStatus[k] })),
    }
  }, [data])

  if (error) return <ErrorState message={error} onRetry={load} />
  if (!data) return <div className="skeleton" style={{ height: 420, borderRadius: 20 }} />

  const r = data.registrations
  const j = data.judging
  const done = Math.min(j.reviews, j.expectedReviews)
  const kpis = [
    { label: 'Registrations', value: r.active, icon: 'ticket', tone: 'indigo', sub: `${r.approved} approved` },
    { label: 'Teams', value: data.teams.count, icon: 'users', tone: 'saffron', sub: `team formation ${pctText(data.rates.teamFormationRate)}` },
    { label: 'Submissions', value: data.submissions.submitted, icon: 'layers', tone: 'coral', sub: `submission rate ${pctText(data.rates.submissionRate)}` },
    { label: 'Completed Reviews', value: done, icon: 'checkCircle', tone: 'green', sub: j.expectedReviews ? `of ${j.expectedReviews} · ${pctText(data.rates.reviewCompletion)}` : 'no reviews expected yet' },
  ]

  return (
    <>
      <div className="kpis">
        {kpis.map((k) => (
          <div key={k.label} className={`kpi kpi--${k.tone}`}>
            <span className="kpi__icon" aria-hidden="true">
              <Icon name={k.icon} size={20} />
            </span>
            <strong className="kpi__value">{k.value}</strong>
            <span className="kpi__label">{k.label}</span>
            <small className="muted kpi__sub">{k.sub}</small>
          </div>
        ))}
      </div>

      <section className="card analytics-insights" aria-labelledby="ins-h">
        <div className="card__head">
          <h3 id="ins-h">
            <Icon name="info" size={17} /> Action insights
          </h3>
          <span className="small muted">Updated {formatIST(data.generatedAt)}</span>
        </div>
        {data.insights.length ? (
          <ul className="insight-list">
            {data.insights.map((i) => (
              <li key={i.text} className={`insight insight--${i.tone}`}>
                <Icon name={i.tone === 'warn' ? 'alert' : 'info'} size={15} /> {i.text}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted small">Nothing needs your attention right now.</p>
        )}
      </section>

      <div className="chart-grid">
        {charts.trend.length ? (
          <ColumnChart title="Registrations over time" subtitle={`Applications per ${charts.trend[0].full.startsWith('Week') ? 'week' : 'day'} · IST`} data={charts.trend} valueLabel="Registrations" />
        ) : (
          <section className="card">
            <div className="card__head">
              <h3>Registrations over time</h3>
            </div>
            <p className="muted small">No registrations yet.</p>
          </section>
        )}
        {charts.regStatus.length ? (
          <BarList title="Registrations by status" subtitle={`${r.total} applications in total · approval rate ${pctText(data.rates.approvalRate)}`} data={charts.regStatus} valueLabel="Applications" />
        ) : (
          <section className="card">
            <div className="card__head">
              <h3>Registrations by status</h3>
            </div>
            <p className="muted small">No applications yet.</p>
          </section>
        )}
      </div>

      <div className="chart-grid">
        <BarList
          title="Submission status"
          subtitle={`${data.submissions.expected} teams / solo participants expected to submit · ${data.submissions.submitted} project${data.submissions.submitted === 1 ? '' : 's'}`}
          data={charts.status}
          valueLabel="Teams / projects"
        />
        {charts.tech.length ? (
          <BarList title="Technology usage" subtitle={`Projects listing each technology · ${data.tech.projectsWithTech} of ${data.tech.projects} projects list a tech stack`} data={charts.tech} valueLabel="Projects" />
        ) : (
          <section className="card">
            <div className="card__head">
              <h3>Technology usage</h3>
            </div>
            <p className="muted small">{data.tech.projects ? 'Submitted projects haven’t listed a tech stack.' : 'No projects submitted yet.'}</p>
          </section>
        )}
      </div>

      <div className="chart-grid">
        <section className="card" aria-labelledby="judg-h">
          <div className="card__head">
            <h3 id="judg-h">Judging progress</h3>
            <Button size="sm" variant="ghost" to={`/organizer/judging?h=${encodeURIComponent(eventId)}`} iconRight="arrowRight">
              Judging
            </Button>
          </div>
          {!j.judges ? (
            <p className="muted small">No judges assigned yet.</p>
          ) : (
            <>
              <div className="event-summary__nums">
                <span>
                  <strong>{j.judges}</strong> judges
                </span>
                <span>
                  <strong>{j.expectedReviews}</strong> reviews expected
                </span>
                <span>
                  <strong>{done}</strong> done
                </span>
                <span>
                  <strong>{Math.max(0, j.expectedReviews - done)}</strong> pending
                </span>
              </div>
              <div className="judge-progress analytics-meter">
                <span className="meter" aria-hidden="true">
                  <span className="meter__fill meter__fill--ok" style={{ width: `${data.rates.reviewCompletion || 0}%` }} />
                </span>
                <strong>{pctText(data.rates.reviewCompletion)}</strong>
              </div>
            </>
          )}
        </section>
        <section className="card" aria-labelledby="team-h">
          <div className="card__head">
            <h3 id="team-h">Teams</h3>
          </div>
          <div className="event-summary__nums">
            <span>
              <strong>{data.teams.count}</strong> teams
            </span>
            <span>
              <strong>{data.teams.averageSize ?? '–'}</strong> average size
            </span>
            <span>
              <strong>{data.teams.inTeams}</strong> in teams
            </span>
            <span>
              <strong>{data.teams.notInTeam}</strong> not in a team
            </span>
          </div>
          <p className="small muted">
            Team size rule: {data.teams.min}–{data.teams.max} members. Counts use approved participants.
          </p>
          {charts.sizes.length > 0 && (
            <ul className="barlist barlist--static">
              {charts.sizes.map((s) => (
                <li key={s.label}>
                  <span className="barlist__label">{s.label}</span>
                  <span className="barlist__track">
                    <span className="barlist__bar" style={{ width: `${(s.value / Math.max(...charts.sizes.map((x) => x.value))) * 100}%` }} />
                  </span>
                  <span className="barlist__value">{s.value}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="card" aria-labelledby="tl-h">
        <div className="card__head">
          <h3 id="tl-h">Timeline</h3>
        </div>
        <Timeline t={data.timeline} />
      </section>
    </>
  )
}

export default function OrganizerAnalytics() {
  const { hackathonId } = useParams()
  const navigate = useNavigate()
  const { list, error, id } = useHackathonPicker(hackathonId)
  if (error) return <ErrorState message={error} />
  return (
    <>
      <header className="dash-head">
        <div>
          <p className="eyebrow">Analytics</p>
          <h1>Hackathon analytics</h1>
          <p className="muted">Participation, teams, submissions, technologies and judging, computed from your hackathon’s live data.</p>
        </div>
      </header>
      {list && !list.length ? (
        <EmptyState icon="bar" title="No hackathons yet" message="Create a hackathon to see its analytics here." action={<Button to="/admin/events/new" icon="plus">Add Event</Button>} />
      ) : (
        <>
          <div className="table-tools">
            <Select
              label="Hackathon"
              value={id}
              onChange={(e) => navigate(`/organizer/analytics/${encodeURIComponent(e.target.value)}`, { replace: true })}
              options={(list || []).map((h) => ({ value: h.id, label: `${h.title} · ${formatDate(h.date, { year: false })}` }))}
            />
          </div>
          {id ? <Board key={id} eventId={id} /> : <div className="skeleton" style={{ height: 420, borderRadius: 20 }} />}
        </>
      )}
    </>
  )
}
