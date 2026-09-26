import { useEffect } from 'react'
import { Outlet, Route, Routes, useLocation } from 'react-router-dom'
import Navbar from './components/Navbar'
import Footer from './components/Footer'
import ProtectedRoute from './components/ProtectedRoute'
import { EventModalHost } from './components/EventModal'
import AiIdeasButton from './components/AiIdeasButton'
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
import JudgeApply from './pages/JudgeApply'
import JudgeDashboard from './pages/judge/JudgeDashboard'
import JudgeProject from './pages/judge/JudgeProject'
import HackathonResults from './pages/HackathonResults'
import AdminJudgeApplications from './pages/admin/AdminJudgeApplications'
import AdminExternalEvents from './pages/admin/AdminExternalEvents'
import OrganizerJudging from './pages/admin/OrganizerJudging'
import OrganizerResults from './pages/admin/OrganizerResults'
import OrganizerDemoDay from './pages/admin/OrganizerDemoDay'
import TeamMatcher, { TeamPreferences } from './pages/TeamMatcher'
import DemoPresentation from './pages/DemoPresentation'
import JudgeDemo from './pages/judge/JudgeDemo'
import IdeaAssistant from './pages/IdeaAssistant'
import HackathonCommunication from './pages/HackathonCommunication'
import OrganizerCommunication from './pages/admin/OrganizerCommunication'
import OrganizerAnalytics from './pages/admin/OrganizerAnalytics'
import ParticipantChat from './pages/ParticipantChat'
import OrganizerChatModeration from './pages/admin/OrganizerChatModeration'

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
  '/judge/apply': 'Judge Application · Codefolio',
  '/judge/dashboard': 'Judge Dashboard · Codefolio',
  '/team-matcher': 'Team Matcher · Codefolio',
  '/team-matcher/preferences': 'Team preferences · Codefolio',
  '/idea-assistant': 'Idea Assistant · Codefolio',
  '/hackathons/communication': 'Hackathon updates · Codefolio',
  '/hackathons/chat': 'Participant chat · Codefolio',
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
    document.title =
      TITLES[pathname] ||
      (pathname.startsWith('/admin') || pathname.startsWith('/organizer')
        ? 'Admin Panel · Codefolio'
        : pathname.startsWith('/judge')
          ? 'Judge Dashboard · Codefolio'
          : pathname.startsWith('/results')
            ? 'Results · Codefolio'
            : pathname.startsWith('/demo/')
              ? 'Demo Day · Codefolio'
              : pathname.startsWith('/hackathons/') && pathname.endsWith('/chat')
                ? 'Participant chat · Codefolio'
                : pathname.startsWith('/hackathons/')
                ? 'Hackathon updates · Codefolio'
                : 'Codefolio')
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
      <AiIdeasButton />
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
          path="judge/apply"
          element={
            <ProtectedRoute>
              <JudgeApply />
            </ProtectedRoute>
          }
        />
        <Route
          path="judge/dashboard"
          element={
            <ProtectedRoute role="judge">
              <JudgeDashboard />
            </ProtectedRoute>
          }
        />
        <Route
          path="judge/projects/:projectId"
          element={
            <ProtectedRoute role="judge">
              <JudgeProject />
            </ProtectedRoute>
          }
        />
        <Route
          path="judge/demo/:eventId"
          element={
            <ProtectedRoute role="judge">
              <JudgeDemo />
            </ProtectedRoute>
          }
        />
        <Route
          path="demo/:eventId"
          element={
            <ProtectedRoute>
              <DemoPresentation />
            </ProtectedRoute>
          }
        />
        <Route
          path="idea-assistant"
          element={
            <ProtectedRoute>
              <IdeaAssistant />
            </ProtectedRoute>
          }
        />
        <Route
          path="hackathons/chat"
          element={
            <ProtectedRoute>
              <ParticipantChat />
            </ProtectedRoute>
          }
        />
        <Route
          path="hackathons/:hackathonId/chat"
          element={
            <ProtectedRoute>
              <ParticipantChat />
            </ProtectedRoute>
          }
        />
        <Route
          path="hackathons/communication"
          element={
            <ProtectedRoute>
              <HackathonCommunication />
            </ProtectedRoute>
          }
        />
        <Route
          path="hackathons/:hackathonId/communication"
          element={
            <ProtectedRoute>
              <HackathonCommunication />
            </ProtectedRoute>
          }
        />
        <Route
          path="team-matcher"
          element={
            <ProtectedRoute>
              <TeamMatcher />
            </ProtectedRoute>
          }
        />
        <Route
          path="team-matcher/preferences"
          element={
            <ProtectedRoute>
              <TeamPreferences />
            </ProtectedRoute>
          }
        />
        <Route
          path="results/:hackathonId"
          element={
            <ProtectedRoute>
              <HackathonResults />
            </ProtectedRoute>
          }
        />
        <Route
          path="organizer"
          element={
            <ProtectedRoute role="organizer">
              <AdminLayout />
            </ProtectedRoute>
          }
        >
          <Route path="judging" element={<OrganizerJudging />} />
          <Route path="results/:hackathonId" element={<OrganizerResults />} />
          <Route path="demo-day" element={<OrganizerDemoDay />} />
          <Route path="communication" element={<OrganizerCommunication />} />
          <Route path="chat" element={<OrganizerChatModeration />} />
          <Route path="analytics/:hackathonId?" element={<OrganizerAnalytics />} />
        </Route>
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
          <Route
            path="external-events"
            element={
              <ProtectedRoute role="admin">
                <AdminExternalEvents />
              </ProtectedRoute>
            }
          />
          <Route
            path="judge-applications"
            element={
              <ProtectedRoute role="admin">
                <AdminJudgeApplications />
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
