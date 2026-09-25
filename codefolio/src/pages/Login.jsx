import { useEffect, useRef, useState } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import AuthShell from '../components/AuthShell'
import Icon from '../components/Icon'
import { Button, Input } from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { peekNext, rememberNext, safePath } from '../services/supabase'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const RESEND_SECONDS = 60

function GoogleG() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  )
}

// Where to go after signing in: onboarding first if the profile isn't set up.
const destination = (u, from) => (!u.onboarded ? '/onboarding' : peekNext() || from || (u.role === 'organizer' ? '/admin' : '/dashboard'))

export default function Login() {
  const { login, user, signInWithGoogle, sendEmailCode, verifyEmailCode } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const location = useLocation()
  const from = safePath(location.state?.from) || peekNext()
  const [mode, setMode] = useState('password') // 'password' | 'code'
  const [form, setForm] = useState({ email: '', password: '' })
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState('')
  const [busy, setBusy] = useState(false)
  const [show, setShow] = useState(false)
  const [code, setCode] = useState({ sent: false, value: '', cooldown: 0 })
  const codeRef = useRef(null)

  useEffect(() => {
    if (from) rememberNext(from)
  }, [from])
  useEffect(() => {
    if (!code.cooldown) return
    const t = setTimeout(() => setCode((c) => ({ ...c, cooldown: c.cooldown - 1 })), 1000)
    return () => clearTimeout(t)
  }, [code.cooldown])

  if (user && !busy) return <Navigate to={destination(user, from)} replace />

  const done = (u) => {
    toast({ title: `Welcome back, ${u.name.split(' ')[0]}!` })
    navigate(destination(u, from), { replace: true })
  }

  const validate = () => {
    const e = {}
    if (!EMAIL_RE.test(form.email.trim())) e.email = 'Enter a valid email address.'
    if (mode === 'password' && !form.password) e.password = 'Enter your password.'
    setErrors(e)
    return !Object.keys(e).length
  }

  async function submit(ev) {
    ev.preventDefault()
    setFormError('')
    if (!validate()) return
    setBusy(true)
    try {
      done(await login(form.email, form.password))
    } catch (e) {
      setFormError(e.message)
      setBusy(false)
    }
  }

  async function google() {
    setFormError('')
    setBusy(true)
    try {
      await signInWithGoogle() // leaves the page on success
    } catch (e) {
      setFormError(e.message)
      setBusy(false)
    }
  }

  async function sendCode(ev) {
    ev?.preventDefault()
    setFormError('')
    if (!validate()) return
    setBusy(true)
    try {
      await sendEmailCode(form.email)
      setCode({ sent: true, value: '', cooldown: RESEND_SECONDS })
      setTimeout(() => codeRef.current?.focus(), 50)
    } catch (e) {
      setFormError(e.message)
    } finally {
      setBusy(false)
    }
  }

  async function verifyCode(ev) {
    ev.preventDefault()
    const token = code.value.replace(/\D/g, '')
    if (token.length < 6) return setErrors({ code: 'Enter the code from your email.' })
    setErrors({})
    setFormError('')
    setBusy(true)
    try {
      done(await verifyEmailCode(form.email, token))
    } catch (e) {
      setFormError(e.message)
      setBusy(false)
    }
  }

  const fill = (email, password) => {
    setMode('password')
    setForm({ email, password })
    setErrors({})
  }

  const emailField = (
    <Input
      label="Email"
      type="email"
      icon="mail"
      autoComplete="email"
      value={form.email}
      onChange={(e) => setForm({ ...form, email: e.target.value })}
      error={errors.email}
      disabled={mode === 'code' && code.sent}
      required
    />
  )

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

      {formError && (
        <p className="form-error" role="alert">
          <Icon name="alert" size={16} /> {formError}
        </p>
      )}

      <Button variant="secondary" size="lg" className="btn--block btn--google" onClick={google} disabled={busy}>
        <GoogleG /> Continue with Google
      </Button>
      <div className="or-divider">
        <span>or</span>
      </div>

      {mode === 'password' ? (
        <form onSubmit={submit} noValidate className="form-stack">
          {emailField}
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
          <div className="form-row-split">
            <button type="button" className="link" onClick={() => (setMode('code'), setErrors({}), setFormError(''))}>
              Email me a sign-in code instead
            </button>
            <Link to="/forgot-password" className="link" state={{ email: form.email }}>
              Forgot Password?
            </Link>
          </div>
          <Button type="submit" size="lg" className="btn--block" loading={busy}>
            Login
          </Button>
        </form>
      ) : (
        <form onSubmit={code.sent ? verifyCode : sendCode} noValidate className="form-stack">
          {emailField}
          {code.sent && (
            <>
              <p className="small muted" role="status">
                We sent a sign-in code to <strong>{form.email}</strong>. You can also click the link in that email.
              </p>
              <Input
                ref={codeRef}
                label="Sign-in code"
                icon="lock"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={10}
                value={code.value}
                onChange={(e) => setCode((c) => ({ ...c, value: e.target.value.replace(/\D/g, '') }))}
                error={errors.code}
                required
              />
            </>
          )}
          <Button type="submit" size="lg" className="btn--block" loading={busy}>
            {code.sent ? 'Verify and log in' : 'Email me a code'}
          </Button>
          <div className="form-row-split">
            <button type="button" className="link" onClick={() => (setMode('password'), setCode({ sent: false, value: '', cooldown: 0 }), setErrors({}), setFormError(''))}>
              Use a password instead
            </button>
            {code.sent && (
              <button type="button" className="link" onClick={sendCode} disabled={code.cooldown > 0 || busy}>
                {code.cooldown > 0 ? `Resend in ${code.cooldown}s` : 'Resend code'}
              </button>
            )}
          </div>
        </form>
      )}
      <p className="auth-switch">
        Don&apos;t have an account? <Link to="/signup" state={{ from }}>Sign Up</Link>
      </p>
    </AuthShell>
  )
}
