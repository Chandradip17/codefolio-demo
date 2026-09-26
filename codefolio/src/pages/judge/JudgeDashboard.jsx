import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import Icon from '../../components/Icon'
import { Button, EmptyState, ErrorState, Input, Segmented, Select, StatusBadge } from '../../components/ui'
import { useAuth } from '../../context/AuthContext'
import * as api from '../../services/api'
import { formatDate } from '../../utils/format'
import { formatScore } from '../../utils/scoring'

export default function JudgeDashboard() {
  const { user } = useAuth()
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [q, setQ] = useState('')
  const [tab, setTab] = useState('all')
  const [hackathon, setHackathon] = useState('All')

  const load = useCallback(async () => {
    setError('')
    try {
      setData(await api.judgeOverview())
    } catch (e) {
      setError(e.message)
    }
  }, [])
  useEffect(() => {
    load()
  }, [load])

  const projects = data?.projects || []
  const stats = useMemo(() => {
    const reviewed = projects.filter((p) => p.myReview).length
    return { total: projects.length, reviewed, pending: projects.length - reviewed }
  }, [projects])

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return projects.filter(
      (p) =>
        (hackathon === 'All' || p.eventId === hackathon) &&
        (tab === 'all' || (tab === 'reviewed' ? p.myReview : !p.myReview)) &&
        (!needle || `${p.title} ${p.teamName || ''} ${p.techStack.join(' ')} ${p.members.map((m) => m.name).join(' ')}`.toLowerCase().includes(needle)),
    )
  }, [projects, q, tab, hackathon])

  const progress = stats.total ? Math.round((stats.reviewed / stats.total) * 100) : 0

  return (
    <div className="container page-pad">
      <header className="dash-head">
        <div>
          <p className="eyebrow">Judge dashboard</p>
          <h1>Welcome, {user.name.split(' ')[0]}!</h1>
          <p className="muted">Projects from the hackathons you’re judging. Your scores stay private to you and the organizer.</p>
        </div>
        <div className="dash-head__actions">
          {(data?.hackathons || [])
            .filter((h) => h.demoDay === 'live')
            .map((h) => (
              <Button key={h.id} icon="radio" to={`/judge/demo/${encodeURIComponent(h.id)}`}>
                Demo Day live{data.hackathons.length > 1 ? ` · ${h.title}` : ''}
              </Button>
            ))}
          <Button variant="secondary" icon="radio" to="/hackathons/communication">
            Updates
          </Button>
          <Button variant="secondary" icon="refresh" onClick={load}>
            Refresh
          </Button>
        </div>
      </header>

      <div className="kpis">
        {[
          { label: 'Assigned Projects', value: stats.total, icon: 'layers', tone: 'indigo' },
          { label: 'Reviewed', value: stats.reviewed, icon: 'checkCircle', tone: 'green' },
          { label: 'Pending Reviews', value: stats.pending, icon: 'clock', tone: 'saffron' },
          { label: 'Hackathons', value: data?.hackathons.length ?? 0, icon: 'trophy', tone: 'coral' },
        ].map((k) => (
          <div key={k.label} className={`kpi kpi--${k.tone}`}>
            <span className="kpi__icon" aria-hidden="true">
              <Icon name={k.icon} size={20} />
            </span>
            <strong className="kpi__value">{data ? k.value : '–'}</strong>
            <span className="kpi__label">{k.label}</span>
          </div>
        ))}
      </div>

      {data && stats.total > 0 && (
        <div className="card judge-progress">
          <div>
            <strong>Review progress</strong>
            <span className="muted small">
              {stats.reviewed} of {stats.total} projects reviewed
            </span>
          </div>
          <span className="meter" aria-hidden="true">
            <span className="meter__fill meter__fill--ok" style={{ width: `${progress}%` }} />
          </span>
          <strong>{progress}%</strong>
        </div>
      )}

      <section className="dash-section">
        <div className="section-head section-head--tight">
          <h2>Assigned Projects</h2>
          <Segmented
            label="Review status"
            value={tab}
            onChange={setTab}
            options={[
              { value: 'all', label: 'All', count: stats.total },
              { value: 'pending', label: 'Pending', count: stats.pending },
              { value: 'reviewed', label: 'Reviewed', count: stats.reviewed },
            ]}
          />
        </div>

        <div className="table-tools">
          <Input label="Search projects" icon="search" placeholder="Project, team, member or tech" value={q} onChange={(e) => setQ(e.target.value)} />
          <Select
            label="Hackathon"
            value={hackathon}
            onChange={(e) => setHackathon(e.target.value)}
            options={[{ value: 'All', label: 'All hackathons' }, ...(data?.hackathons || []).map((h) => ({ value: h.id, label: h.title }))]}
          />
        </div>

        {error ? (
          <ErrorState message={error} onRetry={load} />
        ) : !data ? (
          <div className="skeleton" style={{ height: 260, borderRadius: 20 }} />
        ) : !data.hackathons.length ? (
          <EmptyState icon="trophy" title="No hackathons assigned yet" message="When an organizer assigns you to a hackathon, its projects appear here." />
        ) : !rows.length ? (
          <EmptyState icon="search" title="No projects found" message={projects.length ? 'Try a different search or filter.' : 'Teams haven’t submitted projects yet.'} />
        ) : (
          <div className="table-card">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Project</th>
                  <th scope="col">Team</th>
                  <th scope="col">Hackathon</th>
                  <th scope="col">Submitted</th>
                  <th scope="col">Status</th>
                  <th scope="col" className="num">
                    Your score
                  </th>
                  <th scope="col">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id}>
                    <td data-label="Project" className="cell-title">
                      <span>
                        <Link className="link" to={`/judge/projects/${p.id}`}>
                          <strong>{p.title}</strong>
                        </Link>
                        <small className="muted">{p.techStack.slice(0, 4).join(' · ') || '—'}</small>
                      </span>
                    </td>
                    <td data-label="Team">{p.teamName || p.members[0]?.name || '—'}</td>
                    <td data-label="Hackathon">{p.eventTitle}</td>
                    <td data-label="Submitted" className="nowrap">
                      {formatDate(p.submittedAt.slice(0, 10), { year: false })}
                    </td>
                    <td data-label="Status">
                      <StatusBadge status={p.myReview ? 'Reviewed' : 'Pending'} />
                    </td>
                    <td data-label="Your score" className="num">
                      {p.myReview ? <strong>{formatScore(p.myReview.weighted)}</strong> : '–'}
                    </td>
                    <td className="cell-actions">
                      <div className="row-actions">
                        <Button size="sm" variant={p.myReview ? 'ghost' : 'secondary'} to={`/judge/projects/${p.id}`} iconRight="arrowRight">
                          {p.resultsPublished ? 'View' : p.myReview ? 'Edit review' : 'Review'}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
