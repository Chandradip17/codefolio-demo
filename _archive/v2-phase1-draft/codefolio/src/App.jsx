import { useEffect } from 'react'
import { Route, Routes, useLocation } from 'react-router-dom'
import AppShell from './components/AppShell'
import PublicLayout from './components/PublicLayout'
import { RedirectIfSignedIn, RequireApp, RequireOnboarding } from './components/guards'
import Landing from './pages/public/Landing'
import Login from './pages/public/Login'
import AuthCallback from './pages/public/AuthCallback'
import Onboarding from './pages/app/Onboarding'
import Home from './pages/app/Home'
import Profile from './pages/app/Profile'
import Settings from './pages/app/Settings'
import NotFound from './pages/NotFound'

const TITLES = {
  '/': 'Codefolio · Developer events, hackathons & projects',
  '/login': 'Sign in · Codefolio',
  '/onboarding': 'Set up your profile · Codefolio',
  '/home': 'Home · Codefolio',
  '/settings': 'Settings · Codefolio',
}

function RouteEffects() {
  const { pathname, hash } = useLocation()
  useEffect(() => {
    if (!hash) window.scrollTo(0, 0)
    if (TITLES[pathname]) document.title = TITLES[pathname]
    else if (!pathname.startsWith('/profile/')) document.title = 'Codefolio'
  }, [pathname, hash])
  return null
}

export default function App() {
  return (
    <>
      <RouteEffects />
      <Routes>
        {/* Public */}
        <Route element={<PublicLayout />}>
          <Route index element={<Landing />} />
        </Route>
        <Route
          path="login"
          element={
            <RedirectIfSignedIn>
              <Login />
            </RedirectIfSignedIn>
          }
        />
        <Route path="auth/callback" element={<AuthCallback />} />
        <Route
          path="onboarding"
          element={
            <RequireOnboarding>
              <Onboarding />
            </RequireOnboarding>
          }
        />

        {/* Signed in + onboarded */}
        <Route element={<RequireApp />}>
          <Route element={<AppShell />}>
            <Route path="home" element={<Home />} />
            <Route path="profile/:username" element={<Profile />} />
            <Route path="settings" element={<Settings />} />
          </Route>
        </Route>

        <Route path="*" element={<NotFound />} />
      </Routes>
    </>
  )
}
