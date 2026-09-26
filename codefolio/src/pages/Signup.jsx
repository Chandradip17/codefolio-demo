import { useState } from 'react'
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import AuthShell from '../components/AuthShell'
import Icon from '../components/Icon'
import { Button, Input, Segmented, Select, Textarea } from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { CITIES } from '../data/chapters'
import { rememberNext } from '../services/supabase'
import JudgeFields, { emptyJudge, judgeFieldErrors, toJudgePayload, validateJudge } from '../components/JudgeFields'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default function Signup() {
  const { signup, user } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const location = useLocation()
  const [params] = useSearchParams()
  const [role, setRole] = useState(params.get('role') === 'organizer' ? 'organizer' : 'attendee')
  const [form, setForm] = useState({ name: '', email: '', password: '', confirm: '', chapter: '', city: '', bio: '' })
  // "Apply to become a Judge": an application for an admin to review, not the role itself.
  const [applyJudge, setApplyJudge] = useState(params.get('judge') === '1')
  const [judge, setJudge] = useState(emptyJudge())
  const [judgeErrors, setJudgeErrors] = useState({})
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState('')
  const [busy, setBusy] = useState(false)

  // Signed-in members who click "Become an Organizer" go to the host request page.
  if (user && !busy && params.get('role') === 'organizer' && user.role !== 'organizer') return <Navigate to="/host" replace />
  if (user && !busy && params.get('judge') === '1') return <Navigate to="/judge/apply" replace />
  if (user && !busy) return <Navigate to={!user.onboarded ? '/onboarding' : user.role === 'organizer' ? '/admin' : '/dashboard'} replace />

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })

  const validate = () => {
    const e = {}
    if (form.name.trim().length < 2) e.name = 'Enter your full name.'
    if (!EMAIL_RE.test(form.email)) e.email = 'Enter a valid email address.'
    if (form.password.length < 8) e.password = 'Use at least 8 characters.'
    if (form.confirm !== form.password) e.confirm = "Passwords don't match."
    if (role === 'organizer') {
      if (form.chapter.trim().length < 2) e.chapter = 'Enter your organization or chapter name.'
      if (!form.city) e.city = 'Choose a city.'
      if (form.bio.trim().length < 20) e.bio = 'Tell attendees a little more (at least 20 characters).'
    }
    setErrors(e)
    const je = applyJudge ? validateJudge(judge) : {}
    setJudgeErrors(je)
    return !Object.keys(e).length && !Object.keys(je).length
  }

  async function submit(ev) {
    ev.preventDefault()
    setFormError('')
    if (!validate()) {
      document.querySelector('[aria-invalid="true"]')?.focus()
      return
    }
    setBusy(true)
    try {
      const u = await signup({ ...form, role, ...(applyJudge ? { judge: toJudgePayload(judge) } : {}) })
      toast({
        title: 'Welcome to Codefolio! 🎉',
        message:
          role === 'organizer'
            ? 'Your host request was sent. An admin will review it soon.'
            : applyJudge
              ? 'Your judge application was sent. An admin will review it soon.'
              : 'Your next event is waiting.',
      })
      rememberNext(location.state?.from || (role === 'organizer' ? '/host' : applyJudge ? '/judge/apply' : '/events'))
      navigate(u.onboarded ? location.state?.from || '/events' : '/onboarding', { replace: true })
    } catch (e) {
      if (e.fields) {
        setErrors((x) => ({ ...x, ...e.fields }))
        setJudgeErrors((x) => ({ ...x, ...judgeFieldErrors(e.fields) }))
      }
      setFormError(e.message)
      setBusy(false)
    }
  }

  return (
    <AuthShell>
      <h1>Join Codefolio</h1>
      <p className="muted">Create your account in under a minute.</p>

      <Segmented
        label="Account type"
        size="block"
        value={role}
        onChange={setRole}
        options={[
          { value: 'attendee', label: 'Attendee', icon: 'ticket' },
          { value: 'organizer', label: 'Organizer', icon: 'grid' },
        ]}
      />
      <p className="small muted role-hint">
        {role === 'attendee' ? 'Book seats, track your events and get confirmations.' : 'Host events, manage capacity and see your attendee lists.'}
      </p>
      <label className="check-row judge-opt">
        <input type="checkbox" checked={applyJudge} onChange={(e) => setApplyJudge(e.target.checked)} />
        <span>Apply to become a Judge</span>
      </label>
      {applyJudge && (
        <p className="small muted role-hint">
          This sends a judge application. Your account works normally while an admin reviews it; judging opens once you’re approved.
        </p>
      )}

      <form onSubmit={submit} noValidate className="form-stack">
        {formError && (
          <p className="form-error" role="alert">
            <Icon name="alert" size={16} /> {formError}
          </p>
        )}
        <Input label="Full Name" autoComplete="name" value={form.name} onChange={set('name')} error={errors.name} required />
        <Input label="Email" type="email" autoComplete="email" value={form.email} onChange={set('email')} error={errors.email} required />
        <div className="grid-2">
          <Input label="Password" type="password" autoComplete="new-password" value={form.password} onChange={set('password')} error={errors.password} hint="At least 8 characters" required />
          <Input label="Confirm Password" type="password" autoComplete="new-password" value={form.confirm} onChange={set('confirm')} error={errors.confirm} required />
        </div>

        {role === 'organizer' && (
          <div className="organizer-fields">
            <Input label="Organization/Chapter Name" placeholder="e.g. GDG Bengaluru" value={form.chapter} onChange={set('chapter')} error={errors.chapter} required />
            <Select
              label="City"
              value={form.city}
              onChange={set('city')}
              error={errors.city}
              options={[{ value: '', label: 'Select a city' }, ...CITIES, 'Other']}
              required
            />
            <Textarea
              label="Organizer description"
              rows={3}
              placeholder="What kind of events does your community run?"
              value={form.bio}
              onChange={set('bio')}
              error={errors.bio}
              required
            />
          </div>
        )}

        {applyJudge && (
          <div className="organizer-fields">
            <JudgeFields value={judge} onChange={setJudge} errors={judgeErrors} />
          </div>
        )}

        <Button type="submit" size="lg" className="btn--block" loading={busy}>
          Create Account
        </Button>
      </form>
      <p className="auth-switch">
        Already have an account? <Link to="/login">Login</Link>
      </p>
    </AuthShell>
  )
}
