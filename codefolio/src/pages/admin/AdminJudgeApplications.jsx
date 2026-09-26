import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import Icon from '../../components/Icon'
import Modal, { ConfirmDialog } from '../../components/Modal'
import { Button, EmptyState, ErrorState, Segmented, StatusBadge, Textarea } from '../../components/ui'
import { useToast } from '../../context/ToastContext'
import * as api from '../../services/api'
import { formatDateTime } from '../../utils/format'

const years = (n) => `${n} ${n === 1 ? 'year' : 'years'}`

function LinkOut({ href, label }) {
  if (!href) return <span className="muted">—</span>
  return (
    <a className="link break" href={href} target="_blank" rel="noopener noreferrer">
      {label || href.replace(/^https?:\/\/(www\.)?/, '')} <Icon name="external" size={12} />
    </a>
  )
}

// Full application: what the applicant wrote + their profile.
function ApplicationDetails({ app, onClose, onAction }) {
  const a = app.applicant || {}
  return (
    <Modal
      open
      onClose={onClose}
      title="Judge Application"
      size="md"
      footer={
        app.status === 'pending' ? (
          <>
            <Button variant="danger-ghost" icon="x" onClick={() => onAction(app, 'reject')}>
              Reject Application
            </Button>
            <Button icon="check" onClick={() => onAction(app, 'approve')}>
              Approve Judge
            </Button>
          </>
        ) : (
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        )
      }
    >
      <div className="answers">
        <div className="answers__who">
          <span className="avatar" aria-hidden="true">
            {a.avatarUrl ? <img src={a.avatarUrl} alt="" /> : (a.name || '?').slice(0, 1)}
          </span>
          <div>
            <strong>{a.name}</strong>
            <p className="small muted break">
              {a.email}
              {a.username && (
                <>
                  {' · '}
                  <Link className="link" to={`/profile/${a.username}`} target="_blank">
                    @{a.username}
                  </Link>
                </>
              )}
            </p>
          </div>
          <StatusBadge status={app.status} />
        </div>
        <p className="small muted">Applied {formatDateTime(app.createdAt)}</p>
        <dl className="answers__list">
          <div>
            <dt>Current role</dt>
            <dd>{app.jobTitle}</dd>
          </div>
          <div>
            <dt>Organization</dt>
            <dd>{app.organization}</dd>
          </div>
          <div>
            <dt>Experience</dt>
            <dd>{years(app.experienceYears)}</dd>
          </div>
          <div>
            <dt>Skills</dt>
            <dd>{a.skills?.length ? a.skills.join(', ') : <span className="muted">—</span>}</dd>
          </div>
          <div>
            <dt>Areas of expertise</dt>
            <dd>{app.expertise.length ? app.expertise.join(', ') : <span className="muted">—</span>}</dd>
          </div>
          <div>
            <dt>Hackathon judging experience</dt>
            <dd className="pre-line">{app.judgingExperience || <span className="muted">None given</span>}</dd>
          </div>
          <div>
            <dt>LinkedIn</dt>
            <dd>
              <LinkOut href={a.linkedinUrl} />
            </dd>
          </div>
          <div>
            <dt>GitHub</dt>
            <dd>
              <LinkOut href={a.githubUrl} />
            </dd>
          </div>
          <div>
            <dt>Portfolio</dt>
            <dd>
              <LinkOut href={a.portfolioUrl} />
            </dd>
          </div>
          {a.bio && (
            <div>
              <dt>Bio</dt>
              <dd className="pre-line">{a.bio}</dd>
            </div>
          )}
          <div>
            <dt>Why do you want to become a judge?</dt>
            <dd className="pre-line">{app.reason}</dd>
          </div>
          {app.status !== 'pending' && (
            <div>
              <dt>Decision</dt>
              <dd>
                {app.status === 'approved' ? 'Approved' : 'Rejected'} {app.reviewedAt ? `· ${formatDateTime(app.reviewedAt)}` : ''}
                {app.note ? ` · “${app.note}”` : ''}
              </dd>
            </div>
          )}
        </dl>
      </div>
    </Modal>
  )
}

export default function AdminJudgeApplications() {
  const toast = useToast()
  const [tab, setTab] = useState('pending')
  const [data, setData] = useState({ applications: [], counts: { pending: 0, approved: 0, rejected: 0 } })
  const [status, setStatus] = useState({ loading: true, error: null })
  const [viewing, setViewing] = useState(null)
  const [review, setReview] = useState(null) // { app, action }
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setStatus((s) => ({ ...s, loading: true, error: null }))
    try {
      setData(await api.judgeApplications(tab))
      setStatus({ loading: false, error: null })
    } catch (e) {
      setStatus({ loading: false, error: e.message })
    }
  }, [tab])

  useEffect(() => {
    load()
  }, [load])

  const ask = (app, action) => {
    setNote('')
    setViewing(null)
    setReview({ app, action })
  }

  async function confirm() {
    const { app, action } = review
    setBusy(true)
    try {
      await api.reviewJudgeApplication(app.id, action, note.trim())
      toast({
        title: action === 'approve' ? `${app.applicant?.name} is now a judge` : 'Application rejected',
        message: action === 'approve' ? 'They can open the Judge Dashboard right away.' : `${app.applicant?.name} will see that it wasn’t approved.`,
        tone: action === 'approve' ? 'success' : 'info',
      })
      setReview(null)
      load()
    } catch (e) {
      toast({ title: `Couldn't ${action}`, message: e.message, tone: 'error' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <header className="dash-head">
        <div>
          <p className="eyebrow">Platform admin</p>
          <h1>Judge Applications</h1>
          <p className="muted">Members who applied to judge hackathons. Approving one gives them the Judge Dashboard; nothing changes until you do.</p>
        </div>
        <Button variant="secondary" icon="refresh" onClick={load} loading={status.loading}>
          Refresh
        </Button>
      </header>

      <div className="table-tools table-tools--tabs">
        <Segmented
          label="Application status"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'pending', label: 'Pending', count: data.counts.pending },
            { value: 'approved', label: 'Approved', count: data.counts.approved },
            { value: 'rejected', label: 'Rejected', count: data.counts.rejected },
          ]}
        />
      </div>

      {status.error ? (
        <ErrorState message={status.error} onRetry={load} />
      ) : status.loading && !data.applications.length ? (
        <div className="skeleton" style={{ height: 260, borderRadius: 20 }} />
      ) : !data.applications.length ? (
        <EmptyState icon="shield" title={`No ${tab} applications`} message={tab === 'pending' ? 'You’re all caught up.' : 'Nothing here yet.'} />
      ) : (
        <div className="table-card">
          <table className="data-table data-table--dense">
            <thead>
              <tr>
                <th scope="col">Applicant</th>
                <th scope="col">Organization</th>
                <th scope="col">Experience</th>
                <th scope="col">Skills</th>
                <th scope="col">Applied</th>
                <th scope="col">Status</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.applications.map((app) => (
                <tr key={app.id}>
                  <td data-label="Applicant" className="cell-title">
                    <span className="avatar avatar--sm" aria-hidden="true">
                      {app.applicant?.avatarUrl ? <img src={app.applicant.avatarUrl} alt="" /> : (app.applicant?.name || '?').slice(0, 1)}
                    </span>
                    <span>
                      <strong>{app.applicant?.name || 'Deleted user'}</strong>
                      <small className="muted break">{app.applicant?.email}</small>
                    </span>
                  </td>
                  <td data-label="Organization">
                    {app.organization}
                    <small className="muted"> · {app.jobTitle}</small>
                  </td>
                  <td data-label="Experience" className="nowrap">
                    {app.experienceYears} yrs
                  </td>
                  <td data-label="Skills">
                    <small>{(app.applicant?.skills || []).slice(0, 4).join(', ') || '—'}</small>
                  </td>
                  <td data-label="Applied" className="nowrap">
                    {new Date(app.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                  </td>
                  <td data-label="Status">
                    <StatusBadge status={app.status} />
                  </td>
                  <td className="cell-actions">
                    <div className="row-actions">
                      <Button size="sm" variant="ghost" icon="eye" onClick={() => setViewing(app)} title="View application" aria-label={`View ${app.applicant?.name}'s application`} />
                      {app.status === 'pending' && (
                        <>
                          <Button size="sm" variant="ghost" icon="check" onClick={() => ask(app, 'approve')} title="Approve Judge" aria-label={`Approve ${app.applicant?.name}`} />
                          <Button size="sm" variant="danger-ghost" icon="x" onClick={() => ask(app, 'reject')} title="Reject Application" aria-label={`Reject ${app.applicant?.name}`} />
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="small muted table-foot">
        <Icon name="lock" size={14} /> Only platform admins see this page. Judge access can only be granted here.
      </p>

      {viewing && <ApplicationDetails app={viewing} onClose={() => setViewing(null)} onAction={ask} />}

      <ConfirmDialog
        open={Boolean(review)}
        onClose={() => setReview(null)}
        onConfirm={confirm}
        busy={busy}
        tone={review?.action === 'approve' ? 'info' : 'danger'}
        title={review?.action === 'approve' ? 'Approve this judge?' : 'Reject this application?'}
        confirmLabel={review?.action === 'approve' ? 'Approve Judge' : 'Reject Application'}
        cancelLabel="Cancel"
        message={
          review && (
            <>
              <p>
                <strong>{review.app.applicant?.name}</strong> · {review.app.jobTitle}, {review.app.organization}
              </p>
              <p className="muted">
                {review.action === 'approve'
                  ? 'They’ll get the Judge Dashboard and can be assigned to hackathons. Their participant account stays as it is.'
                  : 'Their account stays a normal member account. They can apply again later.'}
              </p>
              {review.action === 'reject' && (
                <Textarea
                  label="Reason for rejection (optional)"
                  hint="The applicant will see this."
                  rows={3}
                  maxLength={500}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="e.g. Please provide more information about your technical experience and previous judging experience."
                />
              )}
            </>
          )
        }
      />
    </>
  )
}
