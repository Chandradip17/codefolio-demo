import { useEffect, useState } from 'react'
import AroundIndia from '../../components/AroundIndia'
import Icon from '../../components/Icon'
import { Button } from '../../components/ui'
import { useAuth } from '../../context/AuthContext'
import { supabase } from '../../lib/supabase'

const CAPABILITIES = [
  { icon: 'search', title: 'Discover developer events', text: 'Meetups, workshops and DevFests from communities across India, filterable by city, date and format.' },
  { icon: 'trophy', title: 'Join hackathons', text: 'Apply solo or as a team with one profile. Hosts review complete teams, not scattered forms.' },
  { icon: 'users', title: 'Build teams', text: 'Create a team, share a code or invite link, and keep membership within the size rules.' },
  { icon: 'layers', title: 'Showcase projects', text: 'Publish what you built with your stack, links, screenshots and every contributor credited.' },
  { icon: 'calendar', title: 'Host events', text: 'Approved hosts create events and hackathons, review applications and bring in co-hosts.' },
  { icon: 'checkCircle', title: 'Track participation', text: 'Approval, a personal check-in QR, and an attendance record that lands on your profile.' },
]

const STEPS = [
  ['Create your profile', 'Sign in with Google or an email code, then set up your developer profile once.'],
  ['Discover', 'Find events and hackathons that match your city, skills and schedule.'],
  ['Apply', 'Apply to events; for hackathons choose solo, create a team, or join one.'],
  ['Get approved', 'Hosts review applications. You are notified when a decision is made.'],
  ['Participate', 'Show up and build. Teams stay in sync on Codefolio.'],
  ['Check in with your QR', 'A unique QR is issued only after approval and works only for that event.'],
  ['Showcase your work', 'Add the project to your profile with your teammates as contributors.'],
]

// The participation lifecycle, drawn as a log. It illustrates the flow, not live data.
const FLOW = [
  ['applied', 'Application submitted', 'Build with Gemini · Hack Night'],
  ['review', 'Team reviewed by host', '4 members · min 2 / max 4'],
  ['approved', 'Approved', 'check-in QR issued'],
  ['checkin', 'Checked in', 'scanned at the venue'],
  ['shipped', 'Project published', 'on every member’s profile'],
]

function Stats() {
  const [stats, setStats] = useState(null)
  useEffect(() => {
    supabase.rpc('platform_stats').then(({ data, error }) => !error && setStats(data))
  }, [])
  if (!stats) return null
  const members = stats.members ?? 0
  return (
    <section className="section section--rule" aria-labelledby="stats-h">
      <div className="wrap stats-row">
        <h2 id="stats-h" className="eyebrow">
          Codefolio today
        </h2>
        {members > 0 ? (
          <p className="stat">
            <strong>{members.toLocaleString('en-IN')}</strong> {members === 1 ? 'developer has' : 'developers have'} set up a profile
          </p>
        ) : (
          <p className="stat stat--quiet">We&apos;re just getting started. Be one of the first developers on Codefolio.</p>
        )}
      </div>
    </section>
  )
}

export default function Landing() {
  const { session } = useAuth()
  return (
    <>
      <section className="hero wrap" aria-labelledby="hero-h">
        <div className="hero__copy">
          <p className="eyebrow">Developer events &amp; hackathons · India</p>
          <h1 id="hero-h">
            Discover. Build.
            <br />
            Participate.
          </h1>
          <p className="hero__lead">
            Codefolio is where developers find events and hackathons, apply with one profile, check in with a personal QR, and show what they built.
          </p>
          <div className="hero__ctas">
            <Button size="lg" to="/home" iconRight="arrowRight">
              {session ? 'Open Codefolio' : 'Explore Codefolio'}
            </Button>
            {!session && (
              <Button size="lg" variant="secondary" to="/login">
                Log in
              </Button>
            )}
          </div>
          <p className="hero__note">
            <Icon name="lock" size={13} /> Events, hackathons, profiles and projects are visible to signed-in members.
          </p>
        </div>

        <figure className="flow" aria-label="How a hackathon application moves through Codefolio">
          <figcaption className="flow__cap">
            <span>participation.log</span>
            <span className="flow__caphint">example</span>
          </figcaption>
          <ol className="flow__list">
            {FLOW.map(([k, title, meta], i) => (
              <li key={k} className={`flow__item flow__item--${k}`}>
                <span className="flow__t">{String(i + 1).padStart(2, '0')}</span>
                <span className="flow__dot" aria-hidden="true" />
                <span>
                  <strong>{title}</strong>
                  <small>{meta}</small>
                </span>
              </li>
            ))}
          </ol>
        </figure>
      </section>

      <section id="overview" className="section section--rule" aria-labelledby="overview-h">
        <div className="wrap">
          <div className="section__head">
            <p className="eyebrow">Overview</p>
            <h2 id="overview-h">One profile for everything you do at developer events</h2>
          </div>
          <ul className="capabilities">
            {CAPABILITIES.map((c) => (
              <li key={c.title}>
                <Icon name={c.icon} size={18} />
                <h3>{c.title}</h3>
                <p>{c.text}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section id="around" className="section section--rule" aria-labelledby="around-h">
        <div className="wrap split">
          <div className="section__head">
            <p className="eyebrow">Around India</p>
            <h2 id="around-h">Happening across the community</h2>
            <p className="muted">
              Live listings from GDG Community and Devfolio, refreshed every few minutes. Registration happens on their sites. Events hosted on Codefolio appear
              inside the app.
            </p>
          </div>
          <AroundIndia limit={6} />
        </div>
      </section>

      <section id="how" className="section section--rule" aria-labelledby="how-h">
        <div className="wrap">
          <div className="section__head">
            <p className="eyebrow">How it works</p>
            <h2 id="how-h">From profile to project, in seven steps</h2>
          </div>
          <ol className="steps">
            {STEPS.map(([t, d], i) => (
              <li key={t}>
                <span className="steps__n">{i + 1}</span>
                <div>
                  <h3>{t}</h3>
                  <p>{d}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <Stats />

      <section className="section section--rule cta" aria-labelledby="cta-h">
        <div className="wrap cta__inner">
          <h2 id="cta-h">Your next event starts with a profile.</h2>
          <Button size="lg" to="/home" iconRight="arrowRight">
            {session ? 'Open Codefolio' : 'Get started'}
          </Button>
        </div>
      </section>
    </>
  )
}
