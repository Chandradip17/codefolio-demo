import { Link, Outlet } from 'react-router-dom'
import Logo from './Logo'
import { Button } from './ui'
import { useAuth } from '../context/AuthContext'

export default function PublicLayout() {
  const { session, onboarded } = useAuth()
  return (
    <div className="shell">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <header className="topbar topbar--public">
        <div className="topbar__inner">
          <Logo />
          <nav className="topnav topnav--public" aria-label="Page sections">
            <a className="topnav__link" href="/#overview">
              Overview
            </a>
            <a className="topnav__link" href="/#how">
              How it works
            </a>
            <a className="topnav__link" href="/#around">
              Around India
            </a>
          </nav>
          <div className="topbar__end">
            {session ? (
              <Button size="sm" to={onboarded ? '/home' : '/onboarding'}>
                Open Codefolio
              </Button>
            ) : (
              <>
                <Button size="sm" variant="ghost" to="/login">
                  Log in
                </Button>
                <Button size="sm" to="/login?intent=signup">
                  Get started
                </Button>
              </>
            )}
          </div>
        </div>
      </header>
      <main id="main" tabIndex={-1} className="shell__main">
        <Outlet />
      </main>
      <footer className="site-foot">
        <div className="site-foot__inner">
          <div>
            <Logo />
            <p className="muted small">Developer events, hackathons and projects, in one profile.</p>
          </div>
          <nav aria-label="Footer" className="site-foot__links">
            <a href="/#overview">Overview</a>
            <a href="/#how">How it works</a>
            <Link to="/login">Log in</Link>
          </nav>
          <p className="muted small">© 2026 Codefolio · Built for India&apos;s developer community</p>
        </div>
      </footer>
    </div>
  )
}
