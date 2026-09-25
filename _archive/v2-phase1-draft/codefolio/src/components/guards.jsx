// Route guards. The database (RLS) is the real enforcement; these only decide
// which screen to show and where to send people.
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { peekNext, rememberNext, takeNext } from '../lib/nextPath'
import { Button, ErrorState, Spinner } from './ui'

export function FullPageSpinner({ label = 'Loading' }) {
  return (
    <div className="page-center">
      <Spinner size={22} label={label} />
    </div>
  )
}

function ProfileProblem() {
  const { profileError, refreshProfile, signOut } = useAuth()
  return (
    <div className="page-center">
      <div className="narrow">
        <ErrorState title="We couldn't load your profile" message={profileError} onRetry={refreshProfile} />
        <p className="center muted small" style={{ marginTop: 12 }}>
          <Button variant="link" onClick={signOut}>
            Sign out
          </Button>
        </p>
      </div>
    </div>
  )
}

// Signed in AND onboarded. Otherwise: remember destination → login/onboarding.
export function RequireApp() {
  const { session, profile, ready, onboarded } = useAuth()
  const location = useLocation()
  if (!ready) return <FullPageSpinner />
  const here = location.pathname + location.search
  if (!session) {
    rememberNext(here)
    return <Navigate to="/login" replace state={{ next: here }} />
  }
  if (!profile) return <ProfileProblem />
  if (!onboarded) {
    rememberNext(here)
    return <Navigate to="/onboarding" replace />
  }
  return <Outlet />
}

// Signed in but not onboarded yet.
export function RequireOnboarding({ children }) {
  const { session, profile, ready, onboarded } = useAuth()
  if (!ready) return <FullPageSpinner />
  if (!session) return <Navigate to="/login" replace />
  if (!profile) return <ProfileProblem />
  if (onboarded) return <Navigate to={takeNext('/home')} replace />
  return children
}

// Login screen: bounce signed-in users onward.
export function RedirectIfSignedIn({ children }) {
  const { session, ready, onboarded, profile } = useAuth()
  if (!ready) return <FullPageSpinner />
  if (session && profile) return <Navigate to={onboarded ? takeNext('/home') : '/onboarding'} replace />
  return children
}

export function RequireAdmin() {
  const { isAdmin } = useAuth()
  if (!isAdmin) return <Navigate to="/home" replace />
  return <Outlet />
}

export const hasPendingNext = () => Boolean(peekNext())
