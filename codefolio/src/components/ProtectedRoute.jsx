import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { rememberNext } from '../services/supabase'
import { EmptyState, Button } from './ui'

export function PageSpinner() {
  return (
    <div className="page-loading" aria-busy="true">
      <span className="spinner spinner--lg" aria-hidden="true" />
    </div>
  )
}

// role: 'organizer' = approved hosts (and platform admins); 'admin' = platform admins.
const allowed = (user, role) =>
  !role ||
  (role === 'admin'
    ? user.isAdmin
    : role === 'judge'
      ? user.isJudge
      : role === 'organizer'
        ? user.role === 'organizer' || user.isAdmin
        : user.role === role)

// Signed in + onboarded (+ optional role). The database enforces access with RLS;
// this decides which screen to show and remembers where the visitor was going.
export default function ProtectedRoute({ role, children }) {
  const { user, ready } = useAuth()
  const location = useLocation()
  const here = location.pathname + location.search

  if (!ready) return <PageSpinner />
  if (!user) {
    rememberNext(here)
    return <Navigate to="/login" replace state={{ from: here }} />
  }
  if (!user.onboarded) {
    rememberNext(here)
    return <Navigate to="/onboarding" replace />
  }
  if (!allowed(user, role) && role === 'judge') {
    return (
      <div className="container page-pad">
        <EmptyState
          icon="lock"
          title="Judges only"
          message="The Judge Dashboard is for approved judges. Apply to become a judge and an administrator will review your application."
          action={
            <Button to="/judge/apply" iconRight="arrowRight">
              Judge application
            </Button>
          }
        />
      </div>
    )
  }
  if (!allowed(user, role)) {
    const host = role === 'organizer'
    return (
      <div className="container page-pad">
        <EmptyState
          icon="lock"
          title={host ? 'Organizers only' : role === 'admin' ? 'Platform admins only' : 'Attendees only'}
          message={
            host
              ? 'The Admin Panel is for approved hosts. Send a host request and a Codefolio admin will review it.'
              : role === 'admin'
                ? 'Only Codefolio platform admins can review host requests.'
                : 'This dashboard is for attendee bookings. As an organizer, head to your Admin Panel.'
          }
          action={
            <Button to={host ? '/host' : role === 'admin' ? '/admin' : '/admin'} iconRight="arrowRight">
              {host ? 'Request host access' : 'Go to Admin Panel'}
            </Button>
          }
        />
      </div>
    )
  }
  return children
}
