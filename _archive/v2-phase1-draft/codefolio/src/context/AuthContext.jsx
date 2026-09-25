import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { friendlyError, supabase } from '../lib/supabase'
import { rememberNext } from '../lib/nextPath'

const AuthContext = createContext(null)

// Public auth settings (enabled providers). null = couldn't tell; don't block.
let providerCache = null
async function googleEnabled() {
  try {
    providerCache ??= fetch(`${import.meta.env.VITE_SUPABASE_URL}/auth/v1/settings`, {
      headers: { apikey: import.meta.env.VITE_SUPABASE_ANON_KEY },
    }).then((r) => (r.ok ? r.json() : null))
    const s = await providerCache
    return s ? Boolean(s.external?.google) : null
  } catch {
    providerCache = null
    return null
  }
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(undefined) // undefined = still restoring
  const [profile, setProfile] = useState(null)
  const [profileState, setProfileState] = useState({ loading: false, error: null })

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null))
    // Keep this callback synchronous (Supabase warns against awaiting inside it).
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s ?? null))
    return () => data.subscription.unsubscribe()
  }, [])

  const userId = session?.user?.id
  const loadProfile = useCallback(async () => {
    if (!userId) {
      setProfile(null)
      return null
    }
    setProfileState({ loading: true, error: null })
    const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle()
    if (error) {
      setProfileState({ loading: false, error: friendlyError(error) })
      return null
    }
    setProfile(data)
    setProfileState({ loading: false, error: data ? null : 'Your profile record is missing. Try signing out and in again.' })
    return data
  }, [userId])

  useEffect(() => {
    loadProfile()
  }, [loadProfile])

  const signInWithGoogle = useCallback(async (next) => {
    rememberNext(next)
    // If the provider is off, Supabase would show a raw error page after the
    // redirect; check first so we can explain it here instead.
    const enabled = await googleEnabled()
    if (enabled === false) throw new Error('Google sign-in isn’t enabled for Codefolio yet. Use an email code for now.')
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    })
    if (error) throw new Error(/provider is not enabled|Unsupported provider/i.test(error.message) ? 'Google sign-in is not enabled for this project yet.' : friendlyError(error))
  }, [])

  const sendEmailCode = useCallback(async (email, next) => {
    rememberNext(next)
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: true, emailRedirectTo: `${window.location.origin}/auth/callback` },
    })
    if (error) throw new Error(friendlyError(error))
  }, [])

  const verifyEmailCode = useCallback(async (email, token) => {
    const { error } = await supabase.auth.verifyOtp({ email, token, type: 'email' })
    if (error) throw new Error(friendlyError(error))
  }, [])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
    setProfile(null)
  }, [])

  const value = useMemo(
    () => ({
      session,
      user: session?.user ?? null,
      profile,
      ready: session !== undefined && (!session || (!profileState.loading && (profile !== null || profileState.error !== null))),
      profileError: profileState.error,
      isAdmin: profile?.role === 'admin',
      onboarded: Boolean(profile?.onboarding_completed),
      refreshProfile: loadProfile,
      signInWithGoogle,
      sendEmailCode,
      verifyEmailCode,
      signOut,
    }),
    [session, profile, profileState, loadProfile, signInWithGoogle, sendEmailCode, verifyEmailCode, signOut],
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export const useAuth = () => useContext(AuthContext)
