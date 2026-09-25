import { useState } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import AuthShell from '../components/AuthShell'
import Icon from '../components/Icon'
import { Button, Input } from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default function Login() {
  const { login, user } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const location = useLocation()
  const from = location.state?.from
  const [form, setForm] = useState({ email: '', password: '' })
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState('')
  const [busy, setBusy] = useState(false)
  const [show, setShow] = useState(false)

  if (user && !busy) return <Navigate to={from || (user.role === 'organizer' ? '/admin' : '/dashboard')} replace />

  const validate = () => {
    const e = {}
    if (!EMAIL_RE.test(form.email)) e.email = 'Enter a valid email address.'
    if (!form.password) e.password = 'Enter your password.'
    setErrors(e)
    return !Object.keys(e).length
  }

  async function submit(ev) {
    ev.preventDefault()
    setFormError('')
    if (!validate()) return
    setBusy(true)
    try {
      const u = await login(form.email, form.password)
      toast({ title: `Welcome back, ${u.name.split(' ')[0]}!` })
      navigate(from || (u.role === 'organizer' ? '/admin' : '/dashboard'), { replace: true })
    } catch (e) {
      setFormError(e.message)
      setBusy(false)
    }
  }

  const fill = (email, password) => {
    setForm({ email, password })
    setErrors({})
  }

  return (
    <AuthShell>
      <h1>Welcome back</h1>
      <p className="muted">Log in to book seats and manage your events.</p>

      <div className="demo-accounts" aria-label="Demo accounts">
        <p className="small muted">Try a demo account:</p>
        <div>
          <button type="button" className="chip" onClick={() => fill('demo@codefolio.dev', 'demo1234')}>
            <Icon name="ticket" size={14} /> Attendee
          </button>
          <button type="button" className="chip" onClick={() => fill('organizer@codefolio.dev', 'organizer1234')}>
            <Icon name="grid" size={14} /> Organizer
          </button>
        </div>
      </div>

      <form onSubmit={submit} noValidate className="form-stack">
        {formError && (
          <p className="form-error" role="alert">
            <Icon name="alert" size={16} /> {formError}
          </p>
        )}
        <Input
          label="Email"
          type="email"
          icon="mail"
          autoComplete="email"
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
          error={errors.email}
          required
        />
        <div className="field-with-action">
          <Input
            label="Password"
            type={show ? 'text' : 'password'}
            icon="lock"
            autoComplete="current-password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            error={errors.password}
            required
          />
          <button type="button" className="icon-btn field-with-action__btn" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide password' : 'Show password'}>
            <Icon name={show ? 'eyeOff' : 'eye'} size={18} />
          </button>
        </div>
        <div className="form-row-end">
          <Link to="/forgot-password" className="link" state={{ email: form.email }}>
            Forgot Password?
          </Link>
        </div>
        <Button type="submit" size="lg" className="btn--block" loading={busy}>
          Login
        </Button>
      </form>
      <p className="auth-switch">
        Don&apos;t have an account? <Link to="/signup" state={{ from }}>Sign Up</Link>
      </p>
    </AuthShell>
  )
}
