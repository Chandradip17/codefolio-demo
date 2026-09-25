import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import Icon from '../../components/Icon'
import { ConfirmDialog } from '../../components/Modal'
import { Button, EmptyState, ErrorState, Segmented, StatusBadge, Textarea } from '../../components/ui'
import { useToast } from '../../context/ToastContext'
import * as api from '../../services/api'
import { formatDateTime } from '../../utils/format'

const TYPE_LABEL = { event: 'Events & workshops', hackathon: 'Hackathons', both: 'Events & hackathons' }

export default function AdminHostRequests() {
  const toast = useToast()
  const [tab, setTab] = useState('pending')
  const [data, setData] = useState({ requests: [], counts: { pending: 0, approved: 0, rejected: 0 } })
  const [status, setStatus] = useState({ loading: true, error: null })
  const [review, setReview] = useState(null) // { request, action }
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(null)

  const load = useCallback(async () => {
    setStatus((s) => ({ ...s, loading: true, error: null }))
    try {
      setData(await api.hostRequests(tab))
      setStatus({ loading: false, error: null })
    } catch (e) {
      setStatus({ loading: false, error: e.message })
    }
  }, [tab])

  useEffect(() => {
    load()
  }, [load])

  async function confirm() {
    const { request, action } = review
    setBusy(true)
    try {
      await api.reviewHostRequest(request.id, action, note.trim())
      toast({
        title: action === 'approve' ? `${request.applicant.name} is now a host` : 'Request rejected',
        message: action === 'approve' ? 'They can create events right away.' : `${request.applicant.name} will see your decision.`,
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
          <h1>Host requests</h1>
          <p className="muted">Members who want to host events on Codefolio. Approving one lets them create events and review applications.</p>
        </div>
        <Button variant="secondary" icon="refresh" onClick={load} loading={status.loading}>
          Refresh
        </Button>
      </header>

      <div className="table-tools table-tools--tabs">
        <Segmented
          label="Request status"
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
      ) : status.loading && !data.requests.length ? (
        <div className="skeleton" style={{ height: 260, borderRadius: 20 }} />
      ) : !data.requests.length ? (
        <EmptyState icon="shield" title={`No ${tab} requests`} message={tab === 'pending' ? 'You’re all caught up.' : 'Nothing here yet.'} />
      ) : (
        <div className="table-card">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Applicant</th>
                <th scope="col">Email</th>
                <th scope="col">Wants to host</th>
                <th scope="col">Community</th>
                <th scope="col">Requested</th>
                <th scope="col">Status</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.requests.map((r) => (
                <tr key={r.id}>
                  <td data-label="Applicant" className="cell-title">
                    <span className="avatar avatar--sm" aria-hidden="true">
                      {r.applicant?.avatarUrl ? <img src={r.applicant.avatarUrl} alt="" /> : (r.applicant?.name || '?').slice(0, 1)}
                    </span>
                    <span>
                      <strong>{r.applicant?.name || 'Deleted user'}</strong>
                      {r.applicant?.username && (
                        <small>
                          <Link className="link" to={`/profile/${r.applicant.username}`}>
                            @{r.applicant.username}
                          </Link>
                        </small>
                      )}
                    </span>
                  </td>
                  <td data-label="Email" className="break">
                    {r.applicant?.email}
                  </td>
                  <td data-label="Type">{TYPE_LABEL[r.type] || r.type}</td>
                  <td data-label="Community">
                    <strong>{r.organization}</strong>
                    {r.city && <small className="muted"> · {r.city}</small>}
                    <button type="button" className="link small host-req__why" onClick={() => setOpen(open === r.id ? null : r.id)} aria-expanded={open === r.id}>
                      {open === r.id ? 'Hide reason' : 'Read reason'}
                    </button>
                    {open === r.id && <p className="small pre-line host-req__reason">{r.reason}</p>}
                    {r.reviewNote && <p className="small muted">Note: {r.reviewNote}</p>}
                  </td>
                  <td data-label="Requested" className="nowrap">
                    {formatDateTime(r.createdAt)}
                  </td>
                  <td data-label="Status">
                    <StatusBadge status={r.status} />
                  </td>
                  <td className="cell-actions">
                    {r.status === 'pending' ? (
                      <div className="row-actions">
                        <Button size="sm" variant="secondary" icon="check" onClick={() => (setNote(''), setReview({ request: r, action: 'approve' }))}>
                          Approve
                        </Button>
                        <Button size="sm" variant="danger-ghost" icon="x" onClick={() => (setNote(''), setReview({ request: r, action: 'reject' }))}>
                          Reject
                        </Button>
                      </div>
                    ) : (
                      <small className="muted nowrap">{r.reviewedAt ? formatDateTime(r.reviewedAt) : ''}</small>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="small muted table-foot">
        <Icon name="lock" size={14} /> Only platform admins see this page. Hosting rights can only be granted here.
      </p>

      <ConfirmDialog
        open={Boolean(review)}
        onClose={() => setReview(null)}
        onConfirm={confirm}
        busy={busy}
        tone={review?.action === 'approve' ? 'info' : 'danger'}
        title={review?.action === 'approve' ? 'Approve this host?' : 'Reject this request?'}
        confirmLabel={review?.action === 'approve' ? 'Approve host' : 'Reject'}
        cancelLabel="Not now"
        message={
          review && (
            <>
              <p>
                <strong>{review.request.applicant?.name}</strong> ({review.request.organization}) wants to host{' '}
                {(TYPE_LABEL[review.request.type] || '').toLowerCase()}.
              </p>
              <p className="muted">
                {review.action === 'approve'
                  ? 'They get the Admin Panel: creating events, reviewing applications and checking people in.'
                  : 'They keep their member account and can apply again later.'}
              </p>
              <Textarea label="Note to the applicant (optional)" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
            </>
          )
        }
      />
    </>
  )
}
