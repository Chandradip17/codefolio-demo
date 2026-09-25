import { Link } from 'react-router-dom'
import Icon from './Icon'
import { Logo } from './Navbar'

const COLS = [
  {
    title: 'Platform',
    links: [
      ['Events & Hackathons', '/events'],
      ['Hackathons', '/events?section=hackathon'],
      ['Workshops', '/events?section=workshop'],
      ['GDG Chapters', '/chapters'],
    ],
  },
  {
    title: 'Attendees',
    links: [
      ['Sign up', '/signup'],
      ['Login', '/login'],
      ['My Bookings', '/dashboard'],
      ['About Codefolio', '/about'],
    ],
  },
  {
    title: 'Organizers',
    links: [
      ['Become an Organizer', '/signup?role=organizer'],
      ['Admin Panel', '/admin'],
      ['Add an Event', '/admin/events/new'],
      ['Manage Bookings', '/admin/bookings'],
    ],
  },
]

const SOCIAL = [
  ['github', 'GitHub', 'https://github.com'],
  ['twitter', 'X (Twitter)', 'https://x.com'],
  ['linkedin', 'LinkedIn', 'https://linkedin.com'],
  ['instagram', 'Instagram', 'https://instagram.com'],
  ['youtube', 'YouTube', 'https://youtube.com'],
]

export default function Footer() {
  return (
    <footer className="footer">
      <div className="container footer__grid">
        <div className="footer__brand">
          <Logo light />
          <p>
            The community calendar for GDG events &amp; hackathons across India. Live listings from GDG Community and Devfolio, plus
            Codefolio-hosted events you can book in a click.
          </p>
          <ul className="footer__social">
            {SOCIAL.map(([icon, label, href]) => (
              <li key={icon}>
                <a href={href} target="_blank" rel="noopener noreferrer" aria-label={label} className="icon-btn icon-btn--dark">
                  <Icon name={icon} size={18} />
                </a>
              </li>
            ))}
          </ul>
        </div>
        {COLS.map((c) => (
          <nav key={c.title} aria-label={c.title} className="footer__col">
            <h3>{c.title}</h3>
            <ul>
              {c.links.map(([label, to]) => (
                <li key={label}>
                  <Link to={to}>{label}</Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className="container footer__bottom">
        <p>© 2026 Codefolio. Built for India&apos;s developer community.</p>
        <p className="footer__note">
          Not affiliated with Google or Devfolio. Live data from public gdg.community.dev &amp; devfolio.co listings.
        </p>
      </div>
    </footer>
  )
}
