import { Navigate, useNavigate } from 'react-router-dom'
import ProfileForm from '../components/ProfileForm'
import { PageSpinner } from '../components/ProtectedRoute'
import { Button, ErrorState } from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { peekNext } from '../services/supabase'

// First sign-in: members must pick a username (and can add the rest) before
// using the app. Enforced in the database too (onboarding_minimum constraint).
export default function Onboarding() {
  const { user, ready, profileError, refreshUser, logout } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()

  if (!ready) return <PageSpinner />
  if (!user) {
    if (profileError) {
      return (
        <div className="container page-pad">
          <ErrorState message={profileError} onRetry={refreshUser} />
        </div>
      )
    }
    return <Navigate to="/login" replace />
  }
  if (user.onboarded) return <Navigate to={peekNext() || (user.role === 'organizer' ? '/admin' : '/dashboard')} replace />

  return (
    <div className="container page-pad onboarding">
      <header className="dash-head">
        <div>
          <p className="eyebrow">Welcome to Codefolio</p>
          <h1>Set up your developer profile</h1>
          <p className="muted">
            Hosts see this when you apply, and teammates see it when you join a team. <strong>Name and username are required</strong>; you can change
            everything later from your profile.
          </p>
        </div>
        <Button
          variant="ghost"
          icon="logout"
          onClick={async () => {
            await logout()
            navigate('/')
          }}
        >
          Sign out
        </Button>
      </header>
      <ProfileForm
        mode="onboarding"
        onSaved={() => {
          toast({ title: 'You’re all set! 🎉', message: 'Your Codefolio profile is ready.' })
          navigate(peekNext() || (user.role === 'organizer' ? '/admin' : '/events'), { replace: true })
        }}
      />
    </div>
  )
}
