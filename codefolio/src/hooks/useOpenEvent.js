import { useCallback } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { rememberNext } from '../services/supabase'

// The event modal is driven by the `?event=<id>` query param so it can be
// deep-linked, survives the login redirect and closes with the back button.
export function useOpenEvent() {
  const [, setParams] = useSearchParams()
  const { user } = useAuth()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  return useCallback(
    (id) => {
      // Event details are for members: logged-out visitors sign in first,
      // then land back on this event.
      if (!user) {
        const target = `${pathname === '/' ? '/events' : pathname}?event=${encodeURIComponent(id)}`
        rememberNext(target)
        navigate('/login', { state: { from: target } })
        return
      }
      setParams((p) => {
        const next = new URLSearchParams(p)
        next.set('event', id)
        return next
      })
    },
    [setParams, user, navigate, pathname],
  )
}

export function useCloseEvent() {
  const [, setParams] = useSearchParams()
  return useCallback(
    () =>
      setParams(
        (p) => {
          const next = new URLSearchParams(p)
          next.delete('event')
          return next
        },
        { replace: true },
      ),
    [setParams],
  )
}
