import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import * as api from '../services/api'
import { supabase } from '../services/supabase'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [ready, setReady] = useState(false)
  const [authUserId, setAuthUserId] = useState(undefined) // undefined = still restoring
  const [profileError, setProfileError] = useState(null)
  const loadedFor = useRef(null)

  // Follow Supabase's session (sign-in, sign-out, OAuth return, token refresh).
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setAuthUserId(data.session?.user?.id ?? null))
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      // Keep this callback synchronous; load the profile in an effect below.
      setAuthUserId(session?.user?.id ?? null)
    })
    return () => data.subscription.unsubscribe()
  }, [])

  const refreshUser = useCallback(async () => {
    try {
      const u = await api.me()
      setUser(u)
      setProfileError(null)
      return u
    } catch (e) {
      setProfileError(e.message)
      return null
    }
  }, [])

  // Load the profile once per signed-in identity (not on every token refresh).
  useEffect(() => {
    if (authUserId === undefined) return
    if (!authUserId) {
      loadedFor.current = null
      setUser(null)
      setReady(true)
      return
    }
    if (loadedFor.current === authUserId) return
    loadedFor.current = authUserId
    setReady(false)
    refreshUser().finally(() => setReady(true))
  }, [authUserId, refreshUser])

  const login = useCallback(async (email, password) => {
    const u = await api.login(email, password)
    loadedFor.current = u.id
    setUser(u)
    return u
  }, [])

  const signup = useCallback(async (input) => {
    const u = await api.signup(input)
    loadedFor.current = u.id
    setUser(u)
    return u
  }, [])

  const verifyEmailCode = useCallback(async (email, code) => {
    const u = await api.verifyEmailCode(email, code)
    loadedFor.current = u.id
    setUser(u)
    return u
  }, [])

  const logout = useCallback(async () => {
    await api.logout()
    loadedFor.current = null
    setUser(null)
  }, [])

  const updateProfile = useCallback(async (patch) => {
    const u = await api.updateMe(patch)
    setUser(u)
    return u
  }, [])

  const value = useMemo(
    () => ({
      user,
      ready,
      profileError,
      login,
      signup,
      logout,
      updateProfile,
      refreshUser,
      signInWithGoogle: api.signInWithGoogle,
      sendEmailCode: api.sendEmailCode,
      verifyEmailCode,
      isOrganizer: user?.role === 'organizer',
      isAdmin: Boolean(user?.isAdmin),
      onboarded: Boolean(user?.onboarded),
    }),
    [user, ready, profileError, login, signup, logout, updateProfile, refreshUser, verifyEmailCode],
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export const useAuth = () => useContext(AuthContext)
