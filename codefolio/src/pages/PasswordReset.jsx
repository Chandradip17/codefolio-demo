import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import AuthShell from '../components/AuthShell'
import Icon from '../components/Icon'
import { Button, EmptyState, Input } from '../components/ui'
import { useToast } from '../context/ToastContext'
import { forgotPassword, resetPassword } from '../services/api'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// /forgot-password: asks the API to send a Supabase recovery email.
export function ForgotPassword() {
  const location = useLocation()
  const [email, setEmail] = useState(location.state?.email || '')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)

  async function submit(e) {
    e.preventDefault()
    if (!EMAIL_RE.test(email)) return setError('Enter a valid email address.')
    setError('')
    setBusy(true)
    try {
      await forgotPassword(email.trim())
      setSent(true)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthShell>
      {sent ? (
        <EmptyState
          icon="mail"
          title="Check your inbox"
          message={`If an account exists for ${email}, we've sent a link to reset your password.`}
          action={
            <Button to="/login" variant="secondary" icon="arrowLeft">
              Back to login
            </Button>
          }
        />
      ) : (
        <>
          <h1>Reset your password</h1>
          <p className="muted">Enter your account email and we&apos;ll send you a reset link.</p>
          <form onSubmit={submit} noValidate className="form-stack" style={{ marginTop: 24 }}>
            <Input label="Email" type="email" icon="mail" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} error={error} required />
            <Button type="submit" size="lg" className="btn--block" loading={busy}>
              Send reset link
            </Button>
          </form>
          <p className="auth-switch">
            Remembered it? <Link to="/login">Back to login</Link>
          </p>
        </>
      )}
    </AuthShell>
  )
}

// /reset-password: Supabase redirects here with #access_token=…&type=recovery.
export function ResetPassword() {
  const navigate = useNavigate()
  const toast = useToast()
  const [token] = useState(() => {
    const hash = new URLSearchParams(window.location.hash.slice(1))
    const t = hash.get('type') === 'recovery' ? hash.get('access_token') : null
    // Don't leave the token sitting in the address bar/history.
    if (window.location.hash) window.history.replaceState(null, '', window.location.pathname)
    return t
  })
  const [form, setForm] = useState({ password: '', confirm: '' })
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    const errs = {}
    if (form.password.length < 8) errs.password = 'Use at least 8 characters.'
    if (form.confirm !== form.password) errs.confirm = "Passwords don't match."
    setErrors(errs)
    if (Object.keys(errs).length) return
    setBusy(true)
    setFormError('')
    try {
      await resetPassword(token, form.password)
      toast({ title: 'Password updated', message: 'Log in with your new password.' })
      navigate('/login', { replace: true })
    } catch (err) {
      setFormError(err.message)
      setBusy(false)
    }
  }

  return (
    <AuthShell>
      {!token ? (
        <EmptyState
          icon="lock"
          title="This link isn't valid"
          message="Open the reset link from your email, or request a new one."
          action={
            <Button to="/forgot-password" icon="mail">
              Request a new link
            </Button>
          }
        />
      ) : (
        <>
          <h1>Choose a new password</h1>
          <p className="muted">Make it at least 8 characters.</p>
          <form onSubmit={submit} noValidate className="form-stack" style={{ marginTop: 24 }}>
            {formError && (
              <p className="form-error" role="alert">
                <Icon name="alert" size={16} /> {formError}
              </p>
            )}
            <Input label="New password" type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} error={errors.password} required />
            <Input label="Confirm new password" type="password" autoComplete="new-password" value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} error={errors.confirm} required />
            <Button type="submit" size="lg" className="btn--block" loading={busy}>
              Update password
            </Button>
          </form>
        </>
      )}
    </AuthShell>
  )
}
