import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { PageSpinner } from '../components/ProtectedRoute'
import { Button, ErrorState } from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { friendlyAuthError, peekNext, supabase } from '../services/supabase'

// Google OAuth and email sign-in links land here with ?code=… (PKCE);
// We exchange the code for a session explicitly and wait for AuthContext to resolve the profile.
export default function AuthCallback() {
  const { user, ready, refreshUser } = useAuth()
  const [exchangeError, setExchangeError] = useState(null)
  const [urlError] = useState(() => {
    const q = new URLSearchParams(window.location.search)
    const h = new URLSearchParams(window.location.hash.slice(1))
    return q.get('error_description') || h.get('error_description') || q.get('error') || null
  })
  const [timedOut, setTimedOut] = useState(false)

  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    const code = q.get('code')
    if (code) {
      supabase.auth
        .exchangeCodeForSession(code)
        .then(({ data, error }) => {
          if (error) {
            console.error('OAuth code exchange failed:', error)
            setExchangeError(friendlyAuthError(error))
          } else if (data?.session && refreshUser) {
            refreshUser()
          }
        })
        .catch((err) => {
          console.error('Unexpected auth callback error:', err)
          setExchangeError(friendlyAuthError(err))
        })
    }
  }, [refreshUser])

  useEffect(() => {
    const t = setTimeout(() => setTimedOut(true), 15000)
    return () => clearTimeout(t)
  }, [])

  const errorMsg = urlError || exchangeError

  if (errorMsg || (timedOut && !user)) {
    return (
      <div className="container page-pad">
        <ErrorState
          title="Sign-in didn’t complete"
          message={errorMsg ? errorMsg.replace(/\+/g, ' ') : 'The sign-in link may have expired or was already used. Request a new code and try again.'}
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
