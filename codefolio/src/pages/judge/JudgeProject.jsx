import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import Icon from '../../components/Icon'
import { Badge, Button, EmptyState, ErrorState, Input, Textarea } from '../../components/ui'
import { useToast } from '../../context/ToastContext'
import RepoPanel from '../../components/RepoPanel'
import * as api from '../../services/api'
import { formatDate, formatDateTime } from '../../utils/format'
import { formatScore, percent, weightedScore } from '../../utils/scoring'

export function LinkRow({ icon, label, href }) {
  return (
    <li>
      <Icon name={icon} size={16} />
      <span className="judge-links__label">{label}</span>
      {href ? (
        <a className="link break" href={href} target="_blank" rel="noopener noreferrer">
          {href.replace(/^https?:\/\/(www\.)?/, '')} <Icon name="external" size={12} />
        </a>
      ) : (
        <span className="muted">Not provided</span>
      )}
    </li>
  )
}

const DOC_TONE = { good: 'success', fair: 'info', poor: 'warn', missing: 'danger' }

// Repository facts + optional Gemini summary. Supporting information only.
function AnalysisPanel({ projectId, analysis, onChange }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const repo = analysis?.repo
  const ai = analysis?.ai

  async function run() {
    setBusy(true)
    setError('')
    try {
      onChange(await api.analyzeProject(projectId))
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const signal = (on, label) => (
    <li className={on ? 'is-on' : ''}>
      <Icon name={on ? 'checkCircle' : 'x'} size={15} /> {label}
    </li>
  )

  return (
    <section className="card judge-card" aria-labelledby="ai-h">
      <div className="card__head">
        <h3 id="ai-h">
          <Icon name="sparkles" size={17} /> AI project analysis
        </h3>
        <Button size="sm" variant="secondary" icon="refresh" onClick={run} loading={busy}>
          {analysis ? 'Refresh' : 'Analyze repository'}
        </Button>
      </div>
      <p className="small muted judge-ai__note">
        <Icon name="info" size={14} /> Supporting information only. It can be wrong, and it never scores, ranks or decides — you do.
      </p>
      {error && (
        <p className="form-error" role="alert">
          <Icon name="alert" size={15} /> {error}
        </p>
      )}

      {!analysis ? (
        <p className="muted small">Run the analysis to see facts from the GitHub repository and an AI summary of the project.</p>
      ) : (
        <>
          {repo?.found ? (
            <div className="judge-ai__block">
              <h4>Repository</h4>
              <p className="small muted">
                <a className="link" href={`https://github.com/${repo.fullName}`} target="_blank" rel="noopener noreferrer">
                  {repo.fullName} <Icon name="external" size={12} />
                </a>{' '}
                · {repo.fileCount} files · last push {formatDate(repo.pushedAt.slice(0, 10), { year: false })} · ★ {repo.stars}
                {repo.license ? ` · ${repo.license}` : ''}
                {repo.commitsSampled != null ? ` · ${repo.commitsSampled}${repo.commitsSampled === 100 ? '+' : ''} commits, ${repo.contributorsSampled} contributor(s)` : ''}
              </p>
              {repo.languages.length > 0 && (
                <ul className="judge-langs">
                  {repo.languages.map((l) => (
                    <li key={l.name}>
                      <span>{l.name}</span>
                      <span className="meter" aria-hidden="true">
                        <span className="meter__fill" style={{ width: `${l.percent}%` }} />
                      </span>
                      <small className="muted">{l.percent}%</small>
                    </li>
                  ))}
                </ul>
              )}
              <ul className="judge-signals">
                {signal(repo.readme.present, 'README')}
                {signal(repo.signals.tests, 'Tests')}
                {signal(repo.signals.ci, 'CI workflow')}
                {signal(repo.signals.docker, 'Docker')}
                {signal(repo.signals.license, 'License')}
                {signal(repo.signals.envExample, 'Env example')}
              </ul>
            </div>
          ) : (
            analysis.error && (
              <p className="form-error" role="status">
                <Icon name="alert" size={15} /> {analysis.error}
              </p>
            )
          )}

          {analysis.aiStatus === 'ready' && ai ? (
            <div className="judge-ai__block">
              <h4>AI summary</h4>
              <p>{ai.summary}</p>
              <dl className="answers__list">
                {ai.techStack.length > 0 && (
                  <div>
                    <dt>Technology stack</dt>
                    <dd>{ai.techStack.join(', ')}</dd>
                  </div>
                )}
                <div>
                  <dt>Project structure</dt>
                  <dd>{ai.structure}</dd>
                </div>
                <div>
                  <dt>Documentation</dt>
                  <dd>
                    <Badge tone={DOC_TONE[ai.documentation.quality]}>{ai.documentation.quality}</Badge> {ai.documentation.notes}
                  </dd>
                </div>
                <div>
                  <dt>Testing</dt>
                  <dd>
                    <Badge tone={ai.testing.present ? 'success' : 'neutral'}>{ai.testing.present ? 'tests found' : 'no tests seen'}</Badge> {ai.testing.notes}
                  </dd>
                </div>
                {[
                  ['Potential technical issues', ai.potentialIssues],
                  ['Missing information', ai.missingInformation],
                  ['Questions to ask the team', ai.questionsForTeam],
                ].map(
                  ([label, items]) =>
                    items.length > 0 && (
                      <div key={label}>
                        <dt>{label}</dt>
                        <dd>
                          <ul className="dot-list">
                            {items.map((x) => (
                              <li key={x}>{x}</li>
                            ))}
                          </ul>
                        </dd>
                      </div>
                    ),
                )}
              </dl>
            </div>
          ) : analysis.aiStatus === 'not_configured' ? (
            <p className="small muted">
              <Icon name="info" size={14} /> The AI summary isn’t switched on for this Codefolio server yet (it needs a Gemini API key). Repository facts
              above are still accurate.
            </p>
          ) : analysis.aiStatus === 'error' && repo?.found ? (
            <p className="small muted">
              <Icon name="alert" size={14} /> The AI summary couldn’t be generated: {analysis.error}
            </p>
          ) : null}
          <p className="small muted">
            Analyzed {formatDateTime(analysis.analyzedAt)}
            {analysis.model ? ` · ${analysis.model}` : ''}
          </p>
        </>
      )}
    </section>
  )
}

// Scores 0–10 (one decimal) per criterion; weighted total previewed live.
export function ScoreForm({ projectId, criteria, review, canReview, lockedReason, onSaved }) {
  const toast = useToast()
  const blank = Object.fromEntries(criteria.map((c) => [c.id, '']))
  const [scores, setScores] = useState(() => (review ? Object.fromEntries(criteria.map((c) => [c.id, String(review[c.id])])) : blank))
  const [feedback, setFeedback] = useState(review?.feedback || '')
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState('')
  const [busy, setBusy] = useState(false)

  const complete = criteria.every((c) => scores[c.id] !== '')
  const preview = complete ? weightedScore(scores, criteria) : null

  function validate() {
    const e = {}
    for (const c of criteria) {
      const v = scores[c.id]
      const n = Number(v)
      if (v === '' || !Number.isFinite(n)) e[c.id] = 'Enter a score from 0 to 10.'
      else if (n < 0 || n > 10) e[c.id] = 'Scores go from 0 to 10.'
      else if (Math.round(n * 10) !== n * 10) e[c.id] = 'Use at most one decimal place.'
    }
    setErrors(e)
    return !Object.keys(e).length
  }

  async function submit(ev) {
    ev.preventDefault()
    setFormError('')
    if (!validate()) return
    setBusy(true)
    try {
      const saved = await api.submitReview(projectId, { ...Object.fromEntries(criteria.map((c) => [c.id, Number(scores[c.id])])), feedback: feedback.trim() })
      toast({ title: review ? 'Review updated' : 'Review submitted', message: `Weighted score ${formatScore(saved.weighted)}` })
      onSaved(saved)
    } catch (x) {
      if (x.fields) setErrors(x.fields)
      setFormError(x.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="card judge-card form-stack judge-score" onSubmit={submit} noValidate>
      <div className="card__head">
        <h3>
          <Icon name="bar" size={17} /> Your scores
        </h3>
        {review && <Badge tone="success">Submitted</Badge>}
      </div>
      {!canReview && (
        <p className="form-error" role="status">
          <Icon name="lock" size={15} /> {lockedReason}
        </p>
      )}
      {formError && (
        <p className="form-error" role="alert">
          <Icon name="alert" size={15} /> {formError}
        </p>
      )}
      {criteria.map((c) => (
        <Input
          key={c.id}
          label={`${c.label} · ${percent(c.weight)}`}
          type="number"
          min="0"
          max="10"
          step="0.5"
          inputMode="decimal"
          value={scores[c.id]}
          onChange={(e) => {
            setScores((s) => ({ ...s, [c.id]: e.target.value }))
            setErrors((x) => ({ ...x, [c.id]: undefined }))
          }}
          error={errors[c.id]}
          disabled={!canReview}
          placeholder="0–10"
          required
        />
      ))}
      <div className="judge-score__total" aria-live="polite">
        <span className="muted small">
          Weighted score <span className="judge-score__calc">· calculated automatically</span>
        </span>
        <strong>{preview == null ? '–' : formatScore(preview)}</strong>
        <span className="muted small">/ 10</span>
      </div>
      <Textarea
        label="Feedback for the organizers"
        rows={4}
        maxLength={4000}
        value={feedback}
        onChange={(e) => setFeedback(e.target.value)}
        disabled={!canReview}
        hint="Optional. Strengths, concerns, anything that explains your scores."
      />
      <Button type="submit" icon="check" loading={busy} disabled={!canReview} className="btn--block">
        {review ? 'Update review' : 'Submit review'}
      </Button>
      {review && <p className="small muted">Last saved {formatDateTime(review.updatedAt)}</p>}
    </form>
  )
}

export default function JudgeProject() {
  const { projectId } = useParams()
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      setData(await api.judgeProject(projectId))
    } catch (e) {
      setError(e)
    }
  }, [projectId])
  useEffect(() => {
    load()
  }, [load])

  const lockedReason = useMemo(() => {
    if (!data) return ''
    if (data.event.resultsPublished) return 'Results are published, so reviews are closed.'
    return 'You’re a participant in this hackathon, so you can’t judge it.'
  }, [data])

  if (error) {
    return (
      <div className="container page-pad">
        {error.status === 404 ? (
          <EmptyState
            icon="lock"
            title="Project not available"
            message="It doesn’t exist, or you aren’t assigned to judge its hackathon."
            action={
              <Button to="/judge/dashboard" icon="arrowLeft" variant="secondary">
                Back to Judge Dashboard
              </Button>
            }
          />
        ) : (
          <ErrorState message={error.message} onRetry={load} />
        )}
      </div>
    )
  }
  if (!data) {
    return (
      <div className="container page-pad">
        <div className="skeleton" style={{ height: 420, borderRadius: 20 }} />
      </div>
    )
  }

  const { project: p, event, criteria } = data
  return (
    <div className="container page-pad">
      <p className="small">
        <Link className="link" to="/judge/dashboard">
          <Icon name="arrowLeft" size={14} /> Judge Dashboard
        </Link>
      </p>
      <header className="dash-head">
        <div>
          <p className="eyebrow">{event.title}</p>
          <h1>{p.title}</h1>
          <p className="muted">
            {p.teamName ? `Team ${p.teamName}` : 'Solo project'} · submitted {formatDateTime(p.submittedAt)}
            {p.updatedAt !== p.submittedAt ? ` · updated ${formatDateTime(p.updatedAt)}` : ''}
          </p>
        </div>
      </header>

      <div className="dash-grid">
        <div className="dash-main judge-main">
          <section className="card judge-card" aria-labelledby="proj-h">
            <div className="card__head">
              <h3 id="proj-h">Submission</h3>
            </div>
            <div className="judge-block">
              <h4>Problem statement</h4>
              <p className="pre-line">{p.problemStatement}</p>
            </div>
            <div className="judge-block">
              <h4>Project description</h4>
              <p className="pre-line">{p.description}</p>
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
                <LinkRow icon="youtube" label="Demo video" href={p.videoUrl} />
              </ul>
            </div>
            <div className="judge-block">
              <h4>{p.teamName ? 'Team members' : 'Participant'}</h4>
              <ul className="mini-list">
                {p.members.map((m) => (
                  <li key={m.username || m.name}>
                    <div>
                      <strong>{m.name}</strong>
                      {m.username && <small>@{m.username}</small>}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </section>

          <AnalysisPanel projectId={p.id} analysis={data.analysis} onChange={(analysis) => setData((d) => ({ ...d, analysis }))} />
          <RepoPanel projectId={p.id} />
        </div>

        <aside className="dash-aside" aria-label="Scoring">
          <ScoreForm
            key={data.myReview?.updatedAt || 'new'}
            projectId={p.id}
            criteria={criteria}
            review={data.myReview}
            canReview={data.canReview}
            lockedReason={lockedReason}
            onSaved={(r) => setData((d) => ({ ...d, myReview: r }))}
          />
        </aside>
      </div>
    </div>
  )
}
