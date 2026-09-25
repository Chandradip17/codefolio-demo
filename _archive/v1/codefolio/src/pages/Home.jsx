import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import Icon from '../components/Icon'
import EventGrid from '../components/EventGrid'
import ChapterCard from '../components/ChapterCard'
import LiveStatus from '../components/LiveStatus'
import { Button, SectionHeader } from '../components/ui'
import { useData } from '../context/DataContext'
import { useOpenEvent } from '../hooks/useOpenEvent'
import { CHAPTERS } from '../data/chapters'
import { PHOTOS, unsplash } from '../data/images'
import { dateParts, formatTime, todayISO } from '../utils/format'

// Platform stats: demo numbers for now, ready to be swapped for an API call.
const STATS = [
  { value: '500+', label: 'Events Hosted', icon: 'calendar' },
  { value: '50+', label: 'GDG Chapters', icon: 'users' },
  { value: '10K+', label: 'Seats Booked', icon: 'ticket' },
  { value: '25+', label: 'Cities', icon: 'pin' },
]

const SECTIONS = [
  {
    key: 'hackathon',
    icon: 'trophy',
    eyebrow: 'Build · Compete · Win',
    title: 'Hackathons',
    subtitle: 'Weekend sprints, overnight hacks and open applications from Devfolio and GDG chapters.',
  },
  {
    key: 'workshop',
    icon: 'wrench',
    eyebrow: 'Learn by doing',
    title: 'Workshops',
    subtitle: 'Hands-on study jams, code labs and bootcamps. Bring a laptop, leave with a project.',
  },
  {
    key: 'gdg',
    icon: 'users',
    eyebrow: 'Meet your community',
    title: 'GDG Events',
    subtitle: 'DevFests, meetups and talks hosted by Google Developer Groups across India.',
  },
]

const STEPS = [
  { n: '01', title: 'Discover', text: 'Browse GDG events and hackathons happening across India.', icon: 'search' },
  { n: '02', title: 'Book', text: 'Choose an event and reserve your seat.', icon: 'ticket' },
  { n: '03', title: 'Show Up & Build', text: 'Attend, learn, meet developers and build something amazing.', icon: 'code' },
]

// Pick a spread of sources so each row shows live + hosted events.
function pickFor(list, n = 3) {
  const out = []
  const seen = new Set()
  const bySource = ['codefolio', 'devfolio', 'gdg']
  for (let round = 0; out.length < n && round < n; round++) {
    for (const src of bySource) {
      const next = list.find((e) => e.source === src && !seen.has(e.id) && e.status !== 'Cancelled')
      if (next && out.length < n) {
        out.push(next)
        seen.add(next.id)
      }
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date))
}

function Hero() {
  const { catalogue } = useData()
  const openEvent = useOpenEvent()
  const featured = catalogue.find((e) => e.source === 'codefolio' && e.category === 'hackathon' && e.availableSeats > 0)

  return (
    <section className="hero" aria-labelledby="hero-title">
      <div className="hero__bg" aria-hidden="true" />
      <div className="container hero__inner">
        <div className="hero__copy">
          <LiveStatus className="hero__live" />
          <h1 id="hero-title" className="hero__title">
            <span>Discover.</span> <span className="c-indigo">Connect.</span> <span className="c-saffron">Build.</span>
          </h1>
          <p className="hero__sub">The community calendar for GDG events &amp; hackathons across India.</p>
          <p className="hero__desc">
            Find developer events, workshops, meetups and hackathons happening across India&apos;s developer community. Discover events near
            you, connect with builders and book your seat.
          </p>
          <div className="hero__ctas">
            <Button to="/events" size="lg" iconRight="arrowRight">
              Explore Events
            </Button>
            <Button to="/signup?role=organizer" size="lg" variant="secondary">
              Become an Organizer
            </Button>
          </div>
          <ul className="hero__cities" aria-label="Popular cities">
            {['Bengaluru', 'Delhi', 'Pune', 'Hyderabad', 'Mumbai', 'Chennai', 'Kolkata'].map((c) => (
              <li key={c}>
                <Link to={`/events?city=${c}`}>{c}</Link>
              </li>
            ))}
          </ul>
        </div>

        <div className="hero__visual" aria-hidden="true">
          <div className="hero__photo hero__photo--main">
            <img src={unsplash(PHOTOS.laptopsTeam, 900, 1000)} alt="" />
          </div>
          <div className="hero__photo hero__photo--small">
            <img src={unsplash(PHOTOS.conference, 500, 400)} alt="" />
          </div>
          <div className="float-card float-card--code">
            <div className="float-card__dots">
              <i />
              <i />
              <i />
            </div>
            <pre>
              <code>
                <span className="tok-k">const</span> seat = <span className="tok-k">await</span>
                {'\n'}  codefolio.<span className="tok-f">book</span>(<span className="tok-s">&quot;DevFest&quot;</span>)
                {'\n'}
                <span className="tok-c">{'// ✓ CF-7QX2PA confirmed'}</span>
              </code>
            </pre>
          </div>
          {featured && (
            <button className="float-card float-card--ticket" tabIndex={-1} onClick={() => openEvent(featured.id)}>
              <span className="float-card__date">
                <small>{dateParts(featured.date).month}</small>
                <strong>{dateParts(featured.date).day}</strong>
              </span>
              <span className="float-card__info">
                <small>Next hackathon · {featured.city}</small>
                <strong>{featured.title}</strong>
                <em>
                  {formatTime(featured.time)} · {featured.availableSeats} seats left
                </em>
              </span>
            </button>
          )}
          <div className="float-card float-card--badge">
            <Icon name="zap" size={16} /> 1-click booking
          </div>
        </div>
      </div>
    </section>
  )
}

export default function Home() {
  const { catalogue, localStatus, gdgStatus, dfStatus, refreshLive, loadLocal } = useData()
  const byCategory = useMemo(() => {
    const out = {}
    const today = todayISO()
    for (const s of SECTIONS) {
      const all = catalogue.filter((e) => e.category === s.key)
      // Prefer events that haven't started yet; ongoing ones are only a fallback.
      const fresh = all.filter((e) => e.date >= today)
      out[s.key] = pickFor(fresh.length >= 3 ? fresh : all)
    }
    return out
  }, [catalogue])

  const counts = useMemo(() => {
    const m = {}
    for (const e of catalogue) m[e.city] = (m[e.city] || 0) + 1
    return m
  }, [catalogue])
  const liveCounts = useMemo(() => {
    const m = {}
    for (const e of catalogue) if (e.source !== 'codefolio') m[e.city] = (m[e.city] || 0) + 1
    return m
  }, [catalogue])

  const loading = localStatus.loading || gdgStatus.loading || dfStatus.loading
  const allFailed = localStatus.error && gdgStatus.error && dfStatus.error

  return (
    <>
      <Hero />

      <section className="stats-band" aria-label="Codefolio in numbers">
        <div className="container stats">
          {STATS.map((s) => (
            <div key={s.label} className="stat">
              <span className="stat__icon" aria-hidden="true">
                <Icon name={s.icon} size={20} />
              </span>
              <strong className="stat__value">{s.value}</strong>
              <span className="stat__label">{s.label}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="section" aria-labelledby="next-title">
        <div className="container">
          <SectionHeader
            id="next-title"
            eyebrow="Upcoming across India"
            title="What's happening next?"
            subtitle="Three ways to show up: hack, learn, or meet your local GDG. Live listings refresh automatically."
            action={<LiveStatus />}
          />

          {SECTIONS.map((s) => (
            <div key={s.key} className={`cat-block cat-block--${s.key}`}>
              <div className="cat-block__head">
                <span className="cat-block__icon" aria-hidden="true">
                  <Icon name={s.icon} size={22} />
                </span>
                <div>
                  <p className="eyebrow">{s.eyebrow}</p>
                  <h3>{s.title}</h3>
                  <p className="muted">{s.subtitle}</p>
                </div>
                <Link to={`/events?section=${s.key}`} className="link link--arrow">
                  View all {s.title.toLowerCase()} <Icon name="arrowRight" size={16} />
                </Link>
              </div>
              <EventGrid
                events={byCategory[s.key]}
                loading={loading}
                error={allFailed ? 'We couldn’t load events right now.' : null}
                onRetry={() => {
                  loadLocal()
                  refreshLive({ force: true })
                }}
                skeletons={3}
              />
            </div>
          ))}

          <div className="center">
            <Button to="/events" size="lg" iconRight="arrowRight">
              View All Events
            </Button>
          </div>
        </div>
      </section>

      <section className="section section--tint" aria-labelledby="how-title">
        <div className="container">
          <SectionHeader id="how-title" eyebrow="How booking works" title="From discovery to your seat in three steps." />
          <ol className="steps">
            {STEPS.map((s) => (
              <li key={s.n} className="step">
                <span className="step__n">{s.n}</span>
                <span className="step__icon" aria-hidden="true">
                  <Icon name={s.icon} size={24} />
                </span>
                <h3>{s.title}</h3>
                <p>{s.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="section" aria-labelledby="chapters-title">
        <div className="container">
          <SectionHeader
            id="chapters-title"
            eyebrow="GDG Chapters"
            title="Find your developer community"
            action={
              <Link to="/chapters" className="link link--arrow">
                All chapters <Icon name="arrowRight" size={16} />
              </Link>
            }
          />
          <div className="chapter-grid">
            {CHAPTERS.map((c) => (
              <ChapterCard key={c.id} chapter={c} count={counts[c.city] || 0} liveCount={liveCounts[c.city] || 0} />
            ))}
            <Link to="/chapters" className="chapter-more">
              <Icon name="globe" size={28} />
              <strong>50+ chapters</strong>
              <span>Browse every live GDG chapter in India</span>
              <Icon name="arrowRight" size={18} />
            </Link>
          </div>
        </div>
      </section>

      <section className="section" aria-labelledby="cta-title">
        <div className="container">
          <div className="cta-banner">
            <div className="cta-banner__art" aria-hidden="true">
              <img src={unsplash(PHOTOS.speaker, 800, 600)} alt="" />
            </div>
            <div className="cta-banner__copy">
              <p className="eyebrow eyebrow--light">For organizers</p>
              <h2 id="cta-title">Have a developer event to share?</h2>
              <p>Bring your community together. Create your event on Codefolio and reach developers across India.</p>
              <div className="hero__ctas">
                <Button to="/signup?role=organizer" size="lg" variant="saffron">
                  Become an Organizer
                </Button>
                <Button to="/about" size="lg" variant="outline-light">
                  Learn More
                </Button>
              </div>
            </div>
          </div>
        </div>
      </section>
    </>
  )
}
