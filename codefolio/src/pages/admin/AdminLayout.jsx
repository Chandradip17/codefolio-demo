import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import Icon from '../../components/Icon'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'

const NAV = [
  { to: '/admin', label: 'Overview', icon: 'grid', end: true },
  { to: '/admin/events', label: 'Events', icon: 'calendar', end: true },
  { to: '/admin/events/new', label: 'Add Event', icon: 'plus' },
  { to: '/admin/bookings', label: 'Bookings', icon: 'ticket' },
  { to: '/admin/checkin', label: 'Check-in', icon: 'scan' },
  { to: '/admin/host-requests', label: 'Host requests', icon: 'shield', admin: true },
  { to: '/dashboard', label: 'My tickets', icon: 'qr' },
  { to: '/admin/profile', label: 'Profile', icon: 'user' },
]

export default function AdminLayout() {
  const { user, logout } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()

  return (
    <div className="admin container">
      <aside className="admin__side" aria-label="Admin navigation">
        <div className="admin__who">
          <span className="avatar" aria-hidden="true">
            {user.name.slice(0, 1)}
          </span>
          <div>
            <strong>{user.name}</strong>
            <small>{user.isAdmin ? 'Platform admin' : user.chapter || 'Organizer'}</small>
          </div>
        </div>
        <nav>
          <ul>
            {NAV.filter((n) => !n.admin || user.isAdmin).map((n) => (
              <li key={n.to}>
                <NavLink to={n.to} end={n.end} className="side-link">
                  <Icon name={n.icon} size={18} />
                  <span>{n.label}</span>
                </NavLink>
              </li>
            ))}
            <li>
              <button
                className="side-link"
                onClick={() => {
                  logout()
                  toast({ title: 'Logged out', tone: 'info' })
                  navigate('/')
                }}
              >
                <Icon name="logout" size={18} />
                <span>Logout</span>
              </button>
            </li>
          </ul>
        </nav>
      </aside>
      <div className="admin__main">
        <Outlet />
      </div>
    </div>
  )
}
