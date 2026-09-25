import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import * as api from '../services/api'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let alive = true
    ;(async () => {
      if (api.hasSession()) {
        try {
          const u = await api.me()
          if (alive) setUser(u)
        } catch (e) {
          // A bad/expired session logs you out; a network error keeps the token for next time.
          if (e.status === 401) api.setSession(null)
        }
      }
      if (alive) setReady(true)
    })()
    const onExpired = () => setUser(null)
    window.addEventListener('cf:session-expired', onExpired)
    return () => {
      alive = false
      window.removeEventListener('cf:session-expired', onExpired)
    }
  }, [])

  const login = useCallback(async (email, password) => {
    const u = await api.login(email, password)
    setUser(u)
    return u
  }, [])

  const signup = useCallback(async (input) => {
    const u = await api.signup(input)
    setUser(u)
    return u
  }, [])

  const logout = useCallback(() => {
    api.logout()
    setUser(null)
  }, [])

  const updateProfile = useCallback(async (patch) => {
    const u = await api.updateMe(patch)
    setUser(u)
    return u
  }, [])

  const value = useMemo(
    () => ({ user, ready, login, signup, logout, updateProfile, isOrganizer: user?.role === 'organizer' }),
    [user, ready, login, signup, logout, updateProfile],
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export const useAuth = () => useContext(AuthContext)
