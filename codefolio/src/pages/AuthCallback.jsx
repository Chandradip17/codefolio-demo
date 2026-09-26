import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { PageSpinner } from '../components/ProtectedRoute'
import { Button, ErrorState } from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { friendlyAuthError, peekNext, supabase } from '../services/supabase'

// Google OAuth and email sign-in links land here with ?code=… (PKCE) or hash tokens;
// We resolve the session and navigate the user to their destination.
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
      // First check if Supabase detectSessionInUrl already established the session
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (session) {
          if (refreshUser) refreshUser()
          return
        }
        // If not yet exchanged, explicitly exchange the PKCE code
        supabase.auth
          .exchangeCodeForSession(code)
          .then(({ data, error }) => {
            if (error) {
              // Code may have just been consumed by detectSessionInUrl in parallel: recheck session
              supabase.auth.getSession().then(({ data: { session: s } }) => {
                if (s && refreshUser) {
                  refreshUser()
                } else {
                  console.error('OAuth code exchange failed:', error)
                  setExchangeError(friendlyAuthError(error))
                }
              })
            } else if (data?.session && refreshUser) {
              refreshUser()
            }
          })
          .catch((err) => {
            supabase.auth.getSession().then(({ data: { session: s } }) => {
              if (s && refreshUser) {
                refreshUser()
              } else {
                console.error('Unexpected auth callback error:', err)
                setExchangeError(friendlyAuthError(err))
              }
            })
          })
      })
    } else {
      // Hash tokens or existing session: poll once
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (session && refreshUser) refreshUser()
      })
    }
  }, [refreshUser])

  useEffect(() => {
    const t = setTimeout(() => setTimedOut(true), 15000)
    return () => clearTimeout(t)
  }, [])

  // If user is resolved, always navigate into the application immediately
  if (user) {
    return <Navigate to={!user.onboarded ? '/onboarding' : peekNext() || (user.role === 'organizer' ? '/admin' : '/dashboard')} replace />
  }

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

  return <PageSpinner />
}
