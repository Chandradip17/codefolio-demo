import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { FullPageSpinner } from '../../components/guards'
import { Button, ErrorState } from '../../components/ui'
import { useAuth } from '../../context/AuthContext'
import { takeNext } from '../../lib/nextPath'

// Google OAuth and email links land here with ?code=… (PKCE). supabase-js
// exchanges it for a session automatically; we just wait, then route onward.
export default function AuthCallback() {
  const { session, profile, ready, onboarded } = useAuth()
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

  if (urlError || (timedOut && !session)) {
    return (
      <div className="page-center">
        <div className="narrow">
          <ErrorState
            title="Sign-in didn't complete"
            message={
              urlError
                ? urlError.replace(/\+/g, ' ')
                : 'The sign-in link may have expired or was already used. Request a new code and try again.'
            }
          />
          <p className="center" style={{ marginTop: 16 }}>
            <Button to="/login" variant="secondary">
              Back to login
            </Button>
          </p>
        </div>
      </div>
    )
  }
  if (!ready || !session || !profile) return <FullPageSpinner label="Signing you in" />
  return <Navigate to={onboarded ? takeNext('/home') : '/onboarding'} replace />
}
