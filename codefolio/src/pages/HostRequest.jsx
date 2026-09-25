import { useEffect, useState } from 'react'
import Icon from '../components/Icon'
import { Button, EmptyState, ErrorState, Input, Select, StatusBadge, Textarea } from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { CITIES } from '../data/chapters'
import * as api from '../services/api'
import { formatDateTime } from '../utils/format'

const TYPES = [
  { value: 'event', label: 'Events & workshops' },
  { value: 'hackathon', label: 'Hackathons' },
  { value: 'both', label: 'Both' },
]

// Members ask to host here; a platform admin approves or rejects the request.
export default function HostRequest() {
  const { user, refreshUser } = useAuth()
  const toast = useToast()
  const [state, setState] = useState({ loading: true, error: null, requests: [] })
  const [form, setForm] = useState({ type: 'event', organization: user.chapter || '', city: user.city || '', reason: '' })
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = async () => {
    setState((s) => ({ ...s, loading: true, error: null }))
    try {
      const { requests, isHost } = await api.myHostRequests()
      setState({ loading: false, error: null, requests })
      if (isHost && user.role !== 'organizer') refreshUser()
    } catch (e) {
      setState({ loading: false, error: e.message, requests: [] })
    }
  }
  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.role])

  const set = (k) => (e) => {
    setForm({ ...form, [k]: e.target.value })
    setErrors((x) => ({ ...x, [k]: undefined }))
  }

  async function submit(e) {
    e.preventDefault()
    setFormError('')
    const errs = {}
    if (form.organization.trim().length < 2) errs.organization = 'Enter your community or organization name.'
    if (form.reason.trim().length < 20) errs.reason = 'Tell us a little more (at least 20 characters).'
    setErrors(errs)
    if (Object.keys(errs).length) return
    setBusy(true)
    try {
      const r = await api.requestHostAccess({ ...form, organization: form.organization.trim(), reason: form.reason.trim() })
      setState((s) => ({ ...s, requests: [r, ...s.requests] }))
      toast({ title: 'Host request sent', message: 'A Codefolio admin will review it. You’ll see the decision here.' })
    } catch (x) {
      setFormError(x.message)
    } finally {
      setBusy(false)
    }
  }

  const latest = state.requests[0]
  const pending = latest?.status === 'pending'

  let body
  if (user.role === 'organizer') {
    body = (
      <EmptyState
        icon="checkCircle"
        title="You’re an approved host"
        message="Create events, review applications and check people in from your Admin Panel."
        action={
          <Button to="/admin" iconRight="arrowRight">
            Open Admin Panel
          </Button>
        }
      />
    )
  } else if (state.error) {
    body = <ErrorState message={state.error} onRetry={load} />
  } else if (state.loading) {
    body = <div className="skeleton" style={{ height: 280, borderRadius: 20 }} />
  } else if (pending) {
    body = (
      <div className="card host-status">
        <div className="host-status__head">
          <span className="confirm__icon confirm__icon--info" aria-hidden="true">
            <Icon name="clock" size={22} />
          </span>
          <div>
            <strong>Your request is being reviewed</strong>
            <p className="small muted">Sent {formatDateTime(latest.createdAt)}</p>
          </div>
          <StatusBadge status="Pending" />
        </div>
        <dl className="pass__grid host-status__grid">
          <div>
            <dt>Community</dt>
            <dd>{latest.organization}</dd>
          </div>
          <div>
            <dt>Wants to host</dt>
            <dd>{TYPES.find((t) => t.value === latest.type)?.label}</dd>
          </div>
          <div className="pass__wide">
            <dt>Why</dt>
            <dd className="pre-line">{latest.reason}</dd>
          </div>
        </dl>
        <p className="small muted">
          <Icon name="info" size={14} /> You&apos;ll get a live notification when an admin decides. Meanwhile you can keep booking events as a member.
        </p>
      </div>
    )
  } else {
    body = (
      <form className="card form-stack host-form" onSubmit={submit} noValidate>
        {latest?.status === 'rejected' && (
          <p className="form-error" role="status">
            <Icon name="info" size={15} /> Your last request ({formatDateTime(latest.createdAt).split(',')[0]}) wasn&apos;t approved
            {latest.reviewNote ? `: “${latest.reviewNote}”` : '.'} You can update your details and apply again.
          </p>
        )}
        {formError && (
          <p className="form-error" role="alert">
            <Icon name="alert" size={15} /> {formError}
          </p>
        )}
        <Select label="What do you want to host?" value={form.type} onChange={set('type')} options={TYPES} required />
        <div className="form-row-split">
          <Input label="Community / organization" placeholder="e.g. GDG on Campus XYZ" maxLength={120} value={form.organization} onChange={set('organization')} error={errors.organization} required />
          <Select label="City" value={form.city} onChange={set('city')} options={[{ value: '', label: 'Select a city' }, ...CITIES, 'Other']} />
        </div>
        <Textarea
          label="Tell us about your events"
          rows={4}
          maxLength={1000}
          placeholder="What do you run, for whom, and how often? Links to past events help."
          value={form.reason}
          onChange={set('reason')}
          error={errors.reason}
          hint={`${form.reason.trim().length}/1000 · at least 20 characters`}
          required
        />
        <div className="form-actions">
          <Button type="submit" icon="shield" loading={busy}>
            Send host request
          </Button>
        </div>
      </form>
    )
  }

  return (
    <div className="container page-pad host-page">
      <header className="dash-head">
        <div>
          <p className="eyebrow">Host on Codefolio</p>
          <h1>Become an organizer</h1>
          <p className="muted">
            Anyone can ask to host. A Codefolio admin checks each request before hosting tools are switched on, so attendees know every event is
            run by a real community.
          </p>
        </div>
      </header>
      {body}
    </div>
  )
}
