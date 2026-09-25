import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { EmptyState, Button } from './ui'

export default function ProtectedRoute({ role, children }) {
  const { user, ready } = useAuth()
  const location = useLocation()

  if (!ready) {
    return (
      <div className="page-loading" aria-busy="true">
        <span className="spinner spinner--lg" aria-hidden="true" />
      </div>
    )
  }
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />
  if (role && user.role !== role) {
    return (
      <div className="container page-pad">
        <EmptyState
          icon="lock"
          title={role === 'organizer' ? 'Organizers only' : 'Attendees only'}
          message={
            role === 'organizer'
              ? 'The Admin Panel is only available to organizer accounts. Create an organizer account to host events.'
              : 'This dashboard is for attendee bookings. As an organizer, head to your Admin Panel.'
          }
          action={
            <Button to={role === 'organizer' ? '/dashboard' : '/admin'} iconRight="arrowRight">
              Go to {role === 'organizer' ? 'my dashboard' : 'Admin Panel'}
            </Button>
          }
        />
      </div>
    )
  }
  return children
}
