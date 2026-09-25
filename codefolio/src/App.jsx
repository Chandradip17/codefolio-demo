import { useEffect } from 'react'
import { Outlet, Route, Routes, useLocation } from 'react-router-dom'
import Navbar from './components/Navbar'
import Footer from './components/Footer'
import ProtectedRoute from './components/ProtectedRoute'
import { EventModalHost } from './components/EventModal'
import Home from './pages/Home'
import Events from './pages/Events'
import Chapters from './pages/Chapters'
import About from './pages/About'
import Login from './pages/Login'
import Signup from './pages/Signup'
import { ForgotPassword, ResetPassword } from './pages/PasswordReset'
import Dashboard from './pages/Dashboard'
import Profile from './pages/Profile'
import NotFound from './pages/NotFound'
import AdminLayout from './pages/admin/AdminLayout'
import AdminOverview from './pages/admin/AdminOverview'
import AdminEvents from './pages/admin/AdminEvents'
import AdminEventForm from './pages/admin/AdminEventForm'
import AdminBookings from './pages/admin/AdminBookings'

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
  '/admin': 'Admin Panel · Codefolio',
}

function RouteEffects() {
  const { pathname } = useLocation()
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' })
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
        <Route path="events" element={<Events />} />
        <Route path="chapters" element={<Chapters />} />
        <Route path="about" element={<About />} />
        <Route path="login" element={<Login />} />
        <Route path="signup" element={<Signup />} />
        <Route path="forgot-password" element={<ForgotPassword />} />
        <Route path="reset-password" element={<ResetPassword />} />
        <Route
          path="dashboard"
          element={
            <ProtectedRoute role="attendee">
              <Dashboard />
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
          <Route path="bookings" element={<AdminBookings />} />
          <Route path="profile" element={<Profile embedded />} />
        </Route>
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  )
}
