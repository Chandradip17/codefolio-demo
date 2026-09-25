import { useEffect } from 'react'
import { Outlet, Route, Routes, useLocation } from 'react-router-dom'
import Navbar from './components/Navbar'
import Footer from './components/Footer'
import ProtectedRoute from './components/ProtectedRoute'
import { EventModalHost } from './components/EventModal'
import { useAuth } from './context/AuthContext'
import { clearNext } from './services/supabase'
import Home from './pages/Home'
import Events from './pages/Events'
import Chapters from './pages/Chapters'
import About from './pages/About'
import Login from './pages/Login'
import Signup from './pages/Signup'
import { ForgotPassword, ResetPassword } from './pages/PasswordReset'
import Dashboard from './pages/Dashboard'
import Profile from './pages/Profile'
import PublicProfile from './pages/PublicProfile'
import Onboarding from './pages/Onboarding'
import AuthCallback from './pages/AuthCallback'
import NotFound from './pages/NotFound'
import AdminLayout from './pages/admin/AdminLayout'
import AdminOverview from './pages/admin/AdminOverview'
import AdminEvents from './pages/admin/AdminEvents'
import AdminEventForm from './pages/admin/AdminEventForm'
import AdminBookings from './pages/admin/AdminBookings'
import AdminCheckIn from './pages/admin/AdminCheckIn'
import AdminHostRequests from './pages/admin/AdminHostRequests'
import AdminApplicationForm from './pages/admin/AdminApplicationForm'
import HostRequest from './pages/HostRequest'

const TITLES = {
  '/': 'Codefolio · GDG events & hackathons across India',
  '/events': 'Events & Hackathons · Codefolio',
  '/chapters': 'GDG Chapters · Codefolio',
  '/about': 'About · Codefolio',
  '/login': 'Login · Codefolio',
  '/signup': 'Sign up · Codefolio',
  '/forgot-password': 'Reset password · Codefolio',
  '/reset-password': 'New password · Codefolio',
  '/dashboard': 'My Dashboard · Codefolio',
  '/profile': 'Profile · Codefolio',
  '/onboarding': 'Set up your profile · Codefolio',
  '/auth/callback': 'Signing in · Codefolio',
  '/admin': 'Admin Panel · Codefolio',
  '/host': 'Host on Codefolio · Codefolio',
}

const AUTH_PAGES = ['/login', '/signup', '/onboarding', '/auth/callback', '/forgot-password', '/reset-password']

function RouteEffects() {
  const { pathname } = useLocation()
  const { user } = useAuth()
  // Once a signed-in, onboarded member reaches a real page, the saved
  // "where you were going" destination has done its job.
  useEffect(() => {
    if (user?.onboarded && !AUTH_PAGES.includes(pathname)) clearNext()
  }, [pathname, user?.onboarded])
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' })
    if (pathname.startsWith('/profile/')) return // the profile page sets its own title
    document.title = TITLES[pathname] || (pathname.startsWith('/admin') ? 'Admin Panel · Codefolio' : 'Codefolio')
  }, [pathname])
  return null
}

function Layout() {
  return (
    <>
      <RouteEffects />
      <Navbar />
      <main id="main" tabIndex={-1}>
        <Outlet />
      </main>
      <Footer />
      <EventModalHost />
    </>
  )
}

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        {/* Members only (spec §4): logged-out visitors see the landing page and About. */}
        <Route
          path="events"
          element={
            <ProtectedRoute>
              <Events />
            </ProtectedRoute>
          }
        />
        <Route
          path="chapters"
          element={
            <ProtectedRoute>
              <Chapters />
            </ProtectedRoute>
          }
        />
        <Route path="about" element={<About />} />
        <Route path="login" element={<Login />} />
        <Route path="signup" element={<Signup />} />
        <Route path="forgot-password" element={<ForgotPassword />} />
        <Route path="reset-password" element={<ResetPassword />} />
        <Route path="auth/callback" element={<AuthCallback />} />
        <Route path="onboarding" element={<Onboarding />} />
        <Route
          path="profile/:username"
          element={
            <ProtectedRoute>
              <PublicProfile />
            </ProtectedRoute>
          }
        />
        <Route
          path="dashboard"
          element={
            <ProtectedRoute>
              <Dashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="host"
          element={
            <ProtectedRoute>
              <HostRequest />
            </ProtectedRoute>
          }
        />
        <Route
          path="profile"
          element={
            <ProtectedRoute>
              <Profile />
            </ProtectedRoute>
          }
        />
        <Route
          path="admin"
          element={
            <ProtectedRoute role="organizer">
              <AdminLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<AdminOverview />} />
          <Route path="events" element={<AdminEvents />} />
          <Route path="events/new" element={<AdminEventForm key="new" />} />
          <Route path="events/:id/edit" element={<AdminEventForm key="edit" />} />
          <Route path="events/:id/application" element={<AdminApplicationForm />} />
          <Route path="bookings" element={<AdminBookings />} />
          <Route path="checkin" element={<AdminCheckIn />} />
          <Route
            path="host-requests"
            element={
              <ProtectedRoute role="admin">
                <AdminHostRequests />
              </ProtectedRoute>
            }
          />
          <Route path="profile" element={<Profile embedded />} />
        </Route>
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  )
}
