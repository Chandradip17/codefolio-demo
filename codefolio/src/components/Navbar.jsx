import { useEffect, useState } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import Icon from './Icon'
import { Button } from './ui'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { cx } from '../utils/format'

const LINKS = [
  { to: '/', label: 'Home', end: true },
  { to: '/events', label: 'Events & Hackathons' },
  { to: '/chapters', label: 'GDG Chapters' },
  { to: '/about', label: 'About' },
]

export function Logo({ light }) {
  return (
    <Link to="/" className={cx('logo', light && 'logo--light')} aria-label="Codefolio home">
      <span className="logo__mark" aria-hidden="true">
        <span>{'{'}</span>
        <span className="logo__dot" />
        <span>{'}'}</span>
      </span>
      <span className="logo__text">
        Code<span>folio</span>
      </span>
    </Link>
  )
}

export default function Navbar() {
  const { user, logout } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [open, setOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => setOpen(false), [pathname])
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])
  useEffect(() => {
    document.body.classList.toggle('menu-open', open)
    if (!open) return
    const onKey = (e) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  const handleLogout = () => {
    logout()
    toast({ title: 'Logged out', message: 'See you at the next event!', tone: 'info' })
    navigate('/')
  }

  const accountLinks = user ? (
    <>
      {user.role === 'organizer' || user.isAdmin ? (
        <NavLink to="/admin" className="nav-link nav-link--pill">
          <Icon name="grid" size={16} /> Admin Panel
        </NavLink>
      ) : (
        <NavLink to="/dashboard" className="nav-link nav-link--pill">
          <Icon name="ticket" size={16} /> Dashboard
        </NavLink>
      )}
      <NavLink to="/profile" className="nav-link nav-link--pill">
        <span className="avatar avatar--xs" aria-hidden="true">
          {user.name.slice(0, 1)}
        </span>
        Profile
      </NavLink>
      <Button variant="ghost" size="sm" icon="logout" onClick={handleLogout}>
        Logout
      </Button>
    </>
  ) : (
    <>
      <Button variant="ghost" size="sm" to="/login">
        Login
      </Button>
      <Button size="sm" to="/signup">
        Sign Up
      </Button>
    </>
  )

  return (
    <header className={cx('navbar', scrolled && 'is-scrolled')}>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <nav className="navbar__inner container" aria-label="Main">
        <Logo />
        <ul className="navbar__links">
          {LINKS.map((l) => (
            <li key={l.to}>
              <NavLink to={l.to} end={l.end} className="nav-link">
                {l.label}
              </NavLink>
            </li>
          ))}
        </ul>
        <div className="navbar__actions">{accountLinks}</div>
        <button
          className="icon-btn navbar__toggle"
          aria-label={open ? 'Close menu' : 'Open menu'}
          aria-expanded={open}
          aria-controls="mobile-menu"
          onClick={() => setOpen((o) => !o)}
        >
          <Icon name={open ? 'x' : 'menu'} size={22} />
        </button>
      </nav>

      <div id="mobile-menu" className={cx('mobile-menu', open && 'is-open')} hidden={!open}>
        <ul>
          {LINKS.map((l) => (
            <li key={l.to}>
              <NavLink to={l.to} end={l.end} className="mobile-link">
                {l.label}
                <Icon name="chevronRight" size={18} />
              </NavLink>
            </li>
          ))}
        </ul>
        {user && <p className="mobile-menu__user">Signed in as <strong>{user.name}</strong> · {user.role}</p>}
        <div className="mobile-menu__actions">{accountLinks}</div>
      </div>
      {open && <div className="mobile-scrim" onClick={() => setOpen(false)} aria-hidden="true" />}
    </header>
  )
}
