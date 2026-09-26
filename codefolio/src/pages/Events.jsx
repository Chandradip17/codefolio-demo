import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import EventGrid from '../components/EventGrid'
import EventFilters, { FILTER_DEFAULTS } from '../components/EventFilters'
import LiveStatus from '../components/LiveStatus'
import Modal from '../components/Modal'
import Icon from '../components/Icon'
import { Button, EmptyState, ErrorState, Segmented } from '../components/ui'
import { useData } from '../context/DataContext'
import { CITIES } from '../data/chapters'
import { dateBucketMatch } from '../utils/format'

const PAGE = 12
const COMPETITION_OPT = { value: 'competition', label: 'Competitions', icon: 'zap' }
const SECTION_OPTS = [
  { value: 'all', label: 'All', icon: 'layers' },
  { value: 'hackathon', label: 'Hackathons', icon: 'trophy' },
  { value: 'workshop', label: 'Workshops', icon: 'wrench' },
  { value: 'gdg', label: 'GDG Events', icon: 'users' },
]

function matches(e, q) {
  if (!q) return true
  const hay = `${e.title} ${e.organizerChapter} ${e.city} ${e.rawCity || ''} ${e.venue || ''} ${e.description || ''} ${e.tagline || ''} ${(e.tags || []).join(' ')}`.toLowerCase()
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w))
}

export default function Events() {
  const { catalogue, localStatus, gdgStatus, dfStatus, unstopStatus, refreshLive, loadLocal } = useData()
  const unstopOn = unstopStatus.configured
  const [params, setParams] = useSearchParams()
  const [drawer, setDrawer] = useState(false)
  const [limit, setLimit] = useState(PAGE)

  const q = params.get('q') || ''
  const section = params.get('section') || 'all'
  const filters = {
    city: params.get('city') || 'All',
    mode: params.get('mode') || 'All',
    date: params.get('date') || 'All',
    source: params.get('source') || 'All',
  }
  const [query, setQuery] = useState(q)
  const deferredQ = useDeferredValue(query)

  // Keep the URL in sync so filtered views are shareable.
  const update = (patch) =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p)
        for (const [k, v] of Object.entries(patch)) {
          if (!v || v === 'All' || v === 'all') next.delete(k)
          else next.set(k, v)
        }
        return next
      },
      { replace: true },
    )

  useEffect(() => {
    const t = setTimeout(() => {
      if (query !== q) update({ q: query.trim() })
    }, 250)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

  // Follow external URL changes (links, back/forward) into the search box.
  useEffect(() => {
    setQuery((cur) => (cur.trim() === q ? cur : q))
  }, [q])

  useEffect(() => setLimit(PAGE), [section, filters.city, filters.mode, filters.date, filters.source, deferredQ])

  const base = useMemo(
    () =>
      catalogue.filter((e) => {
        if (!matches(e, deferredQ)) return false
        if (filters.city !== 'All') {
          if (filters.city === 'Online') {
            if (e.mode !== 'Online') return false
          } else if (filters.city === 'Other cities') {
            if (CITIES.includes(e.city) || e.city === 'Online') return false
          } else if (e.city !== filters.city) return false
        }
        if (filters.mode !== 'All' && e.mode !== filters.mode) return false
        if (!dateBucketMatch(e.date, filters.date)) return false
        if (filters.source !== 'All' && e.source !== filters.source) return false
        return true
      }),
    [catalogue, deferredQ, filters.city, filters.mode, filters.date, filters.source],
  )

  const sectionCounts = useMemo(() => {
    const c = { all: base.length, hackathon: 0, workshop: 0, gdg: 0, competition: 0 }
    for (const e of base) if (e.category in c) c[e.category]++
    return c
  }, [base])

  const results = section === 'all' ? base : base.filter((e) => e.category === section)
  const activeFilters = Object.entries(filters).filter(([k, v]) => v !== FILTER_DEFAULTS[k]).length
  const anyActive = activeFilters > 0 || q || section !== 'all'
  const loading = localStatus.loading || gdgStatus.loading || dfStatus.loading || (unstopOn && unstopStatus.loading)
  const liveErrors = [gdgStatus.error && 'GDG Community', dfStatus.error && 'Devfolio', unstopOn && unstopStatus.error && 'Unstop'].filter(Boolean)
  // The Competitions tab only exists when a source (Unstop) actually lists competitions.
  const sectionOpts = catalogue.some((e) => e.category === 'competition') ? [...SECTION_OPTS.slice(0, 3), COMPETITION_OPT, SECTION_OPTS[3]] : SECTION_OPTS

  const clearAll = () => {
    setQuery('')
    setParams(new URLSearchParams(), { replace: true })
  }

  return (
    <>
      <section className="page-hero" aria-labelledby="events-title">
        <div className="container">
          <p className="eyebrow">Events &amp; Hackathons</p>
          <h1 id="events-title">Find your next developer event.</h1>
          <p className="page-hero__sub">Meet builders, learn new technologies, compete in hackathons and grow your network.</p>

          <form className="search-xl" role="search" onSubmit={(e) => e.preventDefault()}>
            <Icon name="search" size={22} className="search-xl__icon" />
            <label htmlFor="event-search" className="sr-only">
              Search events
            </label>
            <input
              id="event-search"
              type="search"
              placeholder="Search events, hackathons, chapters..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoComplete="off"
            />
            {query && (
              <button type="button" className="icon-btn" onClick={() => setQuery('')} aria-label="Clear search">
                <Icon name="x" size={18} />
              </button>
            )}
          </form>
          <LiveStatus className="page-hero__live" />
        </div>
      </section>

      <section className="container events-page" aria-label="Event results">
        <div className="events-toolbar">
          <Segmented
            label="Event type"
            value={section}
            onChange={(v) => update({ section: v })}
            options={sectionOpts.map((o) => ({ ...o, count: sectionCounts[o.value] }))}
          />
        </div>

        <div className="filter-bar">
          <div className="filter-bar__desktop">
            <EventFilters values={filters} onChange={(v) => update(v)} unstop={unstopOn} />
          </div>
          <Button variant="secondary" icon="filter" className="filter-bar__mobile-btn" onClick={() => setDrawer(true)}>
            Filters{activeFilters ? ` (${activeFilters})` : ''}
          </Button>
          <Button variant="ghost" icon="x" onClick={clearAll} disabled={!anyActive}>
            Clear Filters
          </Button>
        </div>

        <div className="results-head">
          <p className="results-count" aria-live="polite">
            <strong>{results.length}</strong> {results.length === 1 ? 'event' : 'events'} found
            {loading && <span className="muted"> · loading live feeds…</span>}
          </p>
        </div>

        {liveErrors.length > 0 && !loading && (
          <div className="inline-alert" role="alert">
            <Icon name="alert" size={18} />
            <span>
              Couldn&apos;t reach {liveErrors.join(' and ')} right now. Showing everything else.
            </span>
            <Button size="sm" variant="secondary" icon="refresh" onClick={() => refreshLive({ force: true })}>
              Retry
            </Button>
          </div>
        )}

        {localStatus.error && (
          <div className="inline-alert" role="alert">
            <Icon name="alert" size={18} />
            <span>Codefolio-hosted events couldn&apos;t load: {localStatus.error}</span>
            <Button size="sm" variant="secondary" icon="refresh" onClick={loadLocal}>
              Retry
            </Button>
          </div>
        )}
        {localStatus.error && !results.length && !loading ? (
          <ErrorState message={localStatus.error} onRetry={loadLocal} />
        ) : (
          <EventGrid
            events={results.slice(0, limit)}
            loading={loading && results.length === 0}
            skeletons={6}
            empty={
              <EmptyState
                title="No events found"
                message="Try changing your search or filters."
                action={
                  anyActive && (
                    <Button variant="secondary" icon="x" onClick={clearAll}>
                      Clear Filters
                    </Button>
                  )
                }
              />
            }
          />
        )}

        {results.length > limit && (
          <div className="center">
            <Button variant="secondary" size="lg" onClick={() => setLimit((l) => l + PAGE)}>
              Load more ({results.length - limit} more)
            </Button>
          </div>
        )}
      </section>

      <Modal
        open={drawer}
        onClose={() => setDrawer(false)}
        title="Filters"
        size="drawer"
        footer={
          <>
            <Button variant="ghost" onClick={clearAll}>
              Clear Filters
            </Button>
            <Button onClick={() => setDrawer(false)}>Show {results.length} events</Button>
          </>
        }
      >
        <EventFilters values={filters} onChange={(v) => update(v)} layout="stack" unstop={unstopOn} />
      </Modal>
    </>
  )
}
