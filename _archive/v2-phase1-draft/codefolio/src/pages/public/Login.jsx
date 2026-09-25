import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import Icon from '../../components/Icon'
import { LogoMark } from '../../components/Logo'
import { Button, Input } from '../../components/ui'
import { useAuth } from '../../context/AuthContext'
import { peekNext, rememberNext, safePath } from '../../lib/nextPath'

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

export default function Login() {
  const { signInWithGoogle, sendEmailCode, verifyEmailCode } = useAuth()
  const location = useLocation()
  const [params] = useSearchParams()
  const [step, setStep] = useState('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(null) // 'google' | 'send' | 'verify'
  const [cooldown, setCooldown] = useState(0)
  const codeRef = useRef(null)

  // Where to go after login: router state (from a guard), ?next=, or what we stored earlier.
  const next = safePath(location.state?.next) || safePath(params.get('next')) || peekNext()
  useEffect(() => {
    if (next) rememberNext(next)
  }, [next])

  useEffect(() => {
    if (!cooldown) return
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000)
    return () => clearTimeout(t)
  }, [cooldown])

  async function google() {
    setError('')
    setBusy('google')
    try {
      await signInWithGoogle(next) // navigates away on success
    } catch (e) {
      setError(e.message)
      setBusy(null)
    }
  }

  async function send(e) {
    e?.preventDefault()
    const addr = email.trim().toLowerCase()
    if (!EMAIL_RE.test(addr)) return setError('Enter a valid email address.')
    setError('')
    setBusy('send')
    try {
      await sendEmailCode(addr, next)
      setEmail(addr)
      setStep('code')
      setCode('')
      setCooldown(RESEND_SECONDS)
      setTimeout(() => codeRef.current?.focus(), 50)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(null)
    }
  }

  async function verify(e) {
    e.preventDefault()
    const token = code.replace(/\D/g, '')
    if (token.length < 6) return setError('Enter the code from your email.')
    setError('')
    setBusy('verify')
    try {
      await verifyEmailCode(email, token)
      // The route guard takes over once the session + profile load.
    } catch (err) {
      setError(err.message)
      setBusy(null)
    }
  }

  const signup = params.get('intent') === 'signup'

  return (
    <div className="auth-page">
      <div className="auth-card">
        <Link to="/" className="auth-card__logo" aria-label="Codefolio home">
          <LogoMark size={36} />
        </Link>
        <h1>{signup ? 'Create your Codefolio account' : 'Sign in to Codefolio'}</h1>
        <p className="muted">{signup ? 'Sign in once and your account is created automatically.' : 'New here? Signing in creates your account.'}</p>
        {next && next !== '/home' && (
          <p className="auth-card__next">
            <Icon name="arrowRight" size={13} /> You&apos;ll continue to <code>{next}</code>
          </p>
        )}

        {error && (
          <p className="alert alert--error" role="alert">
            <Icon name="alert" size={16} /> {error}
          </p>
        )}

        {step === 'email' ? (
          <>
            <Button variant="secondary" size="lg" block onClick={google} loading={busy === 'google'} disabled={Boolean(busy)} className="btn--google">
              {busy !== 'google' && <GoogleG />} Continue with Google
            </Button>
            <div className="divider">
              <span>or use an email code</span>
            </div>
            <form onSubmit={send} noValidate className="stack">
              <Input label="Email" type="email" autoComplete="email" inputMode="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
              <Button type="submit" size="lg" block loading={busy === 'send'} disabled={Boolean(busy)}>
                Email me a code
              </Button>
            </form>
          </>
        ) : (
          <form onSubmit={verify} noValidate className="stack">
            <p className="auth-card__sent">
              We sent a sign-in code to <strong>{email}</strong>. It expires in a few minutes. You can also click the link in the email.
            </p>
            <Input
              ref={codeRef}
              label="Code"
              required
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={10}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              className="code-input"
              placeholder="123456"
            />
            <Button type="submit" size="lg" block loading={busy === 'verify'} disabled={busy === 'verify'}>
              Verify and continue
            </Button>
            <div className="auth-card__row">
              <Button variant="link" onClick={() => (setStep('email'), setError(''))}>
                Use a different email
              </Button>
              <Button variant="link" onClick={send} disabled={cooldown > 0 || Boolean(busy)}>
                {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}
              </Button>
            </div>
          </form>
        )}

        <p className="auth-card__fine">
          By continuing you agree to use Codefolio respectfully. We only use your email to sign you in and send event updates.
        </p>
      </div>
    </div>
  )
}
