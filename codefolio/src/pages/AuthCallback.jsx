import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { PageSpinner } from '../components/ProtectedRoute'
import { Button, ErrorState } from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { peekNext } from '../services/supabase'

// Google OAuth and email sign-in links land here with ?code=… (PKCE);
// supabase-js exchanges it for a session automatically.
export default function AuthCallback() {
  const { user, ready } = useAuth()
  const [urlError] = useState(() => {
    const q = new URLSearchParams(window.location.search)
    const h = new URLSearchParams(window.location.hash.slice(1))
    return q.get('error_description') || h.get('error_description') || q.get('error') || null
  })
  const [timedOut, setTimedOut] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setTimedOut(true), 12000)
    return () => clearTimeout(t)
  }, [])

  if (urlError || (timedOut && !user)) {
    return (
      <div className="container page-pad">
        <ErrorState
          title="Sign-in didn’t complete"
          message={urlError ? urlError.replace(/\+/g, ' ') : 'The sign-in link may have expired or was already used. Request a new code and try again.'}
        />
        <div className="center">
          <Button to="/login" variant="secondary">
            Back to login
          </Button>
        </div>
      </div>
    )
  }
  if (!ready || !user) return <PageSpinner />
  return <Navigate to={!user.onboarded ? '/onboarding' : peekNext() || (user.role === 'organizer' ? '/admin' : '/dashboard')} replace />
}
