import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import Logo from './Logo'
import Icon from './Icon'
import { Avatar } from './ui'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'
import { cx } from '../utils/format'

// Primary nav grows as phases ship (see docs/ROADMAP.md). Only built routes appear.
const PRIMARY = [{ to: '/home', label: 'Home' }]

function ThemeToggle() {
  const { theme, setPreference } = useTheme()
  const next = theme === 'dark' ? 'light' : 'dark'
  return (
    <button type="button" className="icon-btn" onClick={() => setPreference(next)} aria-label={`Switch to ${next} theme`} title={`Switch to ${next} theme`}>
      <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={17} />
    </button>
  )
}

function UserMenu() {
  const { profile, signOut } = useAuth()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const wrap = useRef(null)
  const btn = useRef(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e) => !wrap.current?.contains(e.target) && setOpen(false)
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setOpen(false)
        btn.current?.focus()
      }
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    wrap.current?.querySelector('[role=menuitem]')?.focus()
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const onMenuKey = (e) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return
    e.preventDefault()
    const items = [...wrap.current.querySelectorAll('[role=menuitem]')]
    const i = items.indexOf(document.activeElement)
    const n = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
    items[n]?.focus()
  }

  const go = (to) => {
    setOpen(false)
    navigate(to)
  }

  return (
    <div className="menu" ref={wrap}>
      <button ref={btn} type="button" className="menu__trigger" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Avatar src={profile?.avatar_url} name={profile?.full_name} size={30} />
        <span className="sr-only">Account menu</span>
        <Icon name="chevronDown" size={14} />
      </button>
      {open && (
        <div className="menu__panel" role="menu" aria-label="Account" onKeyDown={onMenuKey}>
          <div className="menu__who">
            <strong>{profile?.full_name}</strong>
            <span>@{profile?.username}</span>
          </div>
          <button role="menuitem" className="menu__item" onClick={() => go(`/profile/${profile?.username}`)}>
            <Icon name="user" size={15} /> Profile
          </button>
          <button role="menuitem" className="menu__item" onClick={() => go('/settings')}>
            <Icon name="settings" size={15} /> Settings
          </button>
          <hr />
          <button
            role="menuitem"
            className="menu__item"
            onClick={async () => {
              setOpen(false)
              await signOut()
              navigate('/')
            }}
          >
            <Icon name="logout" size={15} /> Sign out
          </button>
        </div>
      )}
    </div>
  )
}

export default function AppShell() {
  const { pathname } = useLocation()
  const [navOpen, setNavOpen] = useState(false)
  useEffect(() => setNavOpen(false), [pathname])

  return (
    <div className="shell">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <header className="topbar">
        <div className="topbar__inner">
          <Logo to="/home" />
          <nav className={cx('topnav', navOpen && 'is-open')} aria-label="Primary" id="primary-nav">
            {PRIMARY.map((l) => (
              <NavLink key={l.to} to={l.to} className="topnav__link">
                {l.label}
              </NavLink>
            ))}
          </nav>
          <div className="topbar__end">
            <ThemeToggle />
            <UserMenu />
            {PRIMARY.length > 1 && (
              <button className="icon-btn topbar__burger" aria-label="Menu" aria-expanded={navOpen} aria-controls="primary-nav" onClick={() => setNavOpen((o) => !o)}>
                <Icon name={navOpen ? 'x' : 'menu'} size={18} />
              </button>
            )}
          </div>
        </div>
      </header>
      <main id="main" tabIndex={-1} className="shell__main">
        <Outlet />
      </main>
      <footer className="app-foot">
        <span>© 2026 Codefolio</span>
        <Link to="/settings">Settings</Link>
      </footer>
    </div>
  )
}
