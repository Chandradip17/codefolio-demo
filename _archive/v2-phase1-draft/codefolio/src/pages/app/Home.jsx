import { Link } from 'react-router-dom'
import AroundIndia from '../../components/AroundIndia'
import Icon from '../../components/Icon'
import { Avatar, Button, PageHeader } from '../../components/ui'
import { useAuth } from '../../context/AuthContext'

// Optional profile fields that make applications stronger.
const CHECKS = [
  ['avatar_url', 'Add a profile photo'],
  ['bio', 'Write a short bio'],
  ['skills', 'List your skills'],
  ['github_url', 'Link your GitHub'],
  ['college', 'Add your college or company'],
]

export default function Home() {
  const { profile } = useAuth()
  const first = profile.full_name?.split(' ')[0]
  const done = CHECKS.filter(([k]) => (Array.isArray(profile[k]) ? profile[k].length : profile[k] || (k === 'college' && profile.company)))
  const missing = CHECKS.filter((c) => !done.includes(c))

  return (
    <div className="wrap page">
      <PageHeader eyebrow="Home" title={`Welcome, ${first}`} description="Your developer events, hackathons and projects will collect here." />

      <div className="home-grid">
        <section className="panel" aria-labelledby="me-h">
          <div className="me">
            <Avatar src={profile.avatar_url} name={profile.full_name} size={56} />
            <div>
              <h2 id="me-h" className="me__name">
                {profile.full_name}
              </h2>
              <p className="muted">@{profile.username}</p>
            </div>
          </div>
          {missing.length > 0 ? (
            <>
              <div className="progress" aria-label={`Profile ${done.length} of ${CHECKS.length} complete`}>
                <span style={{ width: `${(done.length / CHECKS.length) * 100}%` }} />
              </div>
              <p className="small muted">
                Profile {done.length}/{CHECKS.length}. Hosts review your profile when you apply.
              </p>
              <ul className="checklist">
                {missing.map(([k, label]) => (
                  <li key={k}>
                    <Icon name="plus" size={14} />
                    <Link to="/settings">{label}</Link>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="small muted">
              <Icon name="checkCircle" size={14} /> Your profile is complete.
            </p>
          )}
          <div className="panel__actions">
            <Button size="sm" variant="secondary" to={`/profile/${profile.username}`}>
              View profile
            </Button>
            <Button size="sm" variant="ghost" to="/settings">
              Edit
            </Button>
          </div>
        </section>

        <section className="panel" aria-labelledby="around-h">
          <div className="panel__head">
            <h2 id="around-h">Around India</h2>
            <span className="small muted">GDG Community · Devfolio · opens their site</span>
          </div>
          <AroundIndia limit={8} />
        </section>
      </div>
    </div>
  )
}
