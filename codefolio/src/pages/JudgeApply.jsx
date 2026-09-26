import { useEffect, useState } from 'react'
import Icon from '../components/Icon'
import JudgeFields, { emptyJudge, judgeFieldErrors, toJudgePayload, validateJudge } from '../components/JudgeFields'
import { Button, ErrorState, StatusBadge } from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import * as api from '../services/api'
import { formatDateTime } from '../utils/format'

// Members apply to judge here (and see their status); an admin approves or rejects.
export default function JudgeApply() {
  const { user, refreshUser } = useAuth()
  const toast = useToast()
  const [state, setState] = useState({ loading: true, error: null, applications: [] })
  const [form, setForm] = useState(() => emptyJudge(user))
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState('')
  const [busy, setBusy] = useState(false)
  const [reapply, setReapply] = useState(false)

  const load = async () => {
    setState((s) => ({ ...s, loading: true, error: null }))
    try {
      const { applications, isJudge } = await api.myJudgeApplications()
      setState({ loading: false, error: null, applications })
      if (isJudge && !user.isJudge) refreshUser()
    } catch (e) {
      setState({ loading: false, error: e.message, applications: [] })
    }
  }
  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.isJudge])

  async function submit(e) {
    e.preventDefault()
    setFormError('')
    const errs = validateJudge(form)
    setErrors(errs)
    if (Object.keys(errs).length) return
    setBusy(true)
    try {
      const a = await api.applyAsJudge(toJudgePayload(form))
      setState((s) => ({ ...s, applications: [a, ...s.applications] }))
      setReapply(false)
      refreshUser() // skills / links were saved to the profile
      toast({ title: 'Judge application sent', message: 'An administrator will review your details.' })
    } catch (x) {
      if (x.fields) setErrors(judgeFieldErrors(x.fields))
      setFormError(x.message)
    } finally {
      setBusy(false)
    }
  }

  const latest = state.applications[0]

  let body
  if (user.isJudge) {
    body = (
      <div className="card host-status">
        <div className="host-status__head">
          <span className="confirm__icon confirm__icon--info" aria-hidden="true">
            <Icon name="checkCircle" size={22} />
          </span>
          <div>
            <strong>Status: Approved ✓</strong>
            <p className="small muted">You are now an approved Codefolio Judge.</p>
          </div>
          <StatusBadge status="approved" />
        </div>
        <div className="form-actions">
          <Button to="/judge/dashboard" iconRight="arrowRight">
            Go to Judge Dashboard
          </Button>
        </div>
      </div>
    )
  } else if (state.error) {
    body = <ErrorState message={state.error} onRetry={load} />
  } else if (state.loading) {
    body = <div className="skeleton" style={{ height: 280, borderRadius: 20 }} />
  } else if (latest?.status === 'pending') {
    body = (
      <div className="card host-status">
        <div className="host-status__head">
          <span className="confirm__icon confirm__icon--info" aria-hidden="true">
            <Icon name="clock" size={22} />
          </span>
          <div>
            <strong>Status: Pending Review</strong>
            <p className="small muted">
              Your application has been submitted ({formatDateTime(latest.createdAt)}). An administrator will review your details.
            </p>
          </div>
          <StatusBadge status="Pending" />
        </div>
        <dl className="pass__grid host-status__grid">
          <div>
            <dt>Current role</dt>
            <dd>{latest.jobTitle}</dd>
          </div>
          <div>
            <dt>Organization</dt>
            <dd>{latest.organization}</dd>
          </div>
          <div>
            <dt>Experience</dt>
            <dd>
              {latest.experienceYears} {latest.experienceYears === 1 ? 'year' : 'years'}
            </dd>
          </div>
          <div>
            <dt>Expertise</dt>
            <dd>{latest.expertise.join(', ') || '—'}</dd>
          </div>
          <div className="pass__wide">
            <dt>Why you want to judge</dt>
            <dd className="pre-line">{latest.reason}</dd>
          </div>
        </dl>
        <p className="small muted">
          <Icon name="info" size={14} /> You can keep using Codefolio normally. You’ll get a live notification when an admin decides.
        </p>
      </div>
    )
  } else if (latest?.status === 'rejected' && !reapply) {
    body = (
      <div className="card host-status">
        <div className="host-status__head">
          <span className="confirm__icon confirm__icon--danger" aria-hidden="true">
            <Icon name="alert" size={22} />
          </span>
          <div>
            <strong>Status: Not Approved</strong>
            <p className="small muted">Your judge application was not approved.</p>
          </div>
          <StatusBadge status="rejected" />
        </div>
        {latest.note && (
          <p className="small">
            <strong>Reason:</strong> {latest.note}
          </p>
        )}
        <div className="form-actions">
          <Button variant="secondary" icon="refresh" onClick={() => setReapply(true)}>
            Update details and apply again
          </Button>
        </div>
      </div>
    )
  } else {
    body = (
      <form className="card form-stack host-form" onSubmit={submit} noValidate>
        {formError && (
          <p className="form-error" role="alert">
            <Icon name="alert" size={15} /> {formError}
          </p>
        )}
        <JudgeFields value={form} onChange={setForm} errors={errors} />
        <div className="form-actions">
          {reapply && (
            <Button type="button" variant="ghost" onClick={() => setReapply(false)}>
              Cancel
            </Button>
          )}
          <Button type="submit" icon="shield" loading={busy}>
            Submit judge application
          </Button>
        </div>
      </form>
    )
  }

  return (
    <div className="container page-pad host-page">
      <header className="dash-head">
        <div>
          <p className="eyebrow">Judge on Codefolio</p>
          <h1>Judge Application</h1>
          <p className="muted">
            Judges review hackathon projects and give teams feedback. An administrator checks every application before judging access is switched
            on.
          </p>
        </div>
      </header>
      {body}
    </div>
  )
}
