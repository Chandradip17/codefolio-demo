import Icon from '../components/Icon'
import { Button, SectionHeader } from '../components/ui'
import { PHOTOS, unsplash } from '../data/images'

const PILLARS = [
  { title: 'Discover', text: 'Find events across India, from DevFests to campus hack nights, in one calendar.', icon: 'search', tone: 'indigo' },
  { title: 'Connect', text: 'Meet developers and technology communities in your city and online.', icon: 'users', tone: 'coral' },
  { title: 'Build', text: 'Participate in hackathons and build real projects with real teammates.', icon: 'code', tone: 'saffron' },
  { title: 'Grow', text: 'Learn, network and grow with the community, one event at a time.', icon: 'sparkles', tone: 'green' },
]

export default function About() {
  return (
    <>
      <section className="page-hero page-hero--about" aria-labelledby="about-h">
        <div className="container about-hero">
          <div>
            <p className="eyebrow">About Codefolio</p>
            <h1 id="about-h">Built for India&apos;s developer community.</h1>
            <p className="page-hero__sub">
              Codefolio helps developers, students, builders and technology enthusiasts discover community events and hackathons, without
              hunting across a dozen group chats, forms and feeds.
            </p>
            <p className="muted">
              We pull live listings from public GDG Community and Devfolio feeds, and let organizers host bookable events with real-time seat
              tracking and instant confirmations.
            </p>
            <div className="hero__ctas">
              <Button to="/events" iconRight="arrowRight">
                Explore Events
              </Button>
              <Button to="/signup?role=organizer" variant="secondary">
                Become an Organizer
              </Button>
            </div>
          </div>
          <div className="about-collage" aria-hidden="true">
            <img src={unsplash(PHOTOS.friends, 600, 700)} alt="" />
            <img src={unsplash(PHOTOS.codeMac, 500, 400)} alt="" />
            <img src={unsplash(PHOTOS.audience, 500, 400)} alt="" />
          </div>
        </div>
      </section>

      <section className="section" aria-labelledby="flow-h">
        <div className="container">
          <SectionHeader id="flow-h" eyebrow="Our loop" title="Discover → Connect → Build → Grow" />
          <ol className="flow">
            {PILLARS.map((p, i) => (
              <li key={p.title} className={`flow__item flow__item--${p.tone}`}>
                <span className="flow__icon" aria-hidden="true">
                  <Icon name={p.icon} size={26} />
                </span>
                <span className="flow__n">0{i + 1}</span>
                <h3>{p.title}</h3>
                <p>{p.text}</p>
                {i < PILLARS.length - 1 && (
                  <span className="flow__arrow" aria-hidden="true">
                    <Icon name="arrowRight" size={20} />
                  </span>
                )}
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="section section--tint" aria-labelledby="sources-h">
        <div className="container">
          <SectionHeader id="sources-h" eyebrow="Where events come from" title="Three sources, one calendar" />
          <div className="sources">
            <div className="source-card">
              <span className="badge badge--live badge--dot">Live · GDG</span>
              <h3>GDG Community</h3>
              <p>Upcoming events from Google Developer Group chapters in India, pulled from the public gdg.community.dev listings.</p>
            </div>
            <div className="source-card">
              <span className="badge badge--live badge--dot">Live · Devfolio</span>
              <h3>Devfolio</h3>
              <p>Hackathons with open applications in India and online, straight from Devfolio&apos;s public search.</p>
            </div>
            <div className="source-card">
              <span className="badge badge--neutral">Codefolio</span>
              <h3>Hosted on Codefolio</h3>
              <p>Events created by organizers here, with instant booking, live seat counts and attendee management.</p>
            </div>
          </div>
          <p className="muted small center">
            Codefolio is an independent community project and is not affiliated with Google or Devfolio. Sample events are marked
            &ldquo;Sample&rdquo;.
          </p>
        </div>
      </section>
    </>
  )
}
