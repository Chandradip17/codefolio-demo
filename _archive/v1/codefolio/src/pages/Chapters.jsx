import { useMemo, useState } from 'react'
import ChapterCard from '../components/ChapterCard'
import Icon from '../components/Icon'
import { EmptyState, SectionHeader } from '../components/ui'
import { useData } from '../context/DataContext'
import { CHAPTERS } from '../data/chapters'

export default function Chapters() {
  const { catalogue, gdg, gdgStatus } = useData()
  const [q, setQ] = useState('')
  const needle = q.trim().toLowerCase()

  const counts = useMemo(() => {
    const all = {}
    const live = {}
    for (const e of catalogue) {
      all[e.city] = (all[e.city] || 0) + 1
      if (e.source !== 'codefolio') live[e.city] = (live[e.city] || 0) + 1
    }
    return { all, live }
  }, [catalogue])

  const featured = CHAPTERS.filter((c) => !needle || `${c.name} ${c.city} ${c.description} ${c.tags.join(' ')}`.toLowerCase().includes(needle))

  // Every Indian chapter that currently has a live event on gdg.community.dev.
  const liveChapters = useMemo(() => {
    const m = new Map()
    for (const e of gdg) {
      const cur = m.get(e.organizerChapter) || { name: e.organizerChapter, city: e.rawCity || e.city, state: e.state, url: e.chapterUrl, count: 0, next: e }
      cur.count++
      if (e.date < cur.next.date) cur.next = e
      m.set(e.organizerChapter, cur)
    }
    return [...m.values()]
      .filter((c) => !needle || `${c.name} ${c.city} ${c.state || ''}`.toLowerCase().includes(needle))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
  }, [gdg, needle])

  return (
    <>
      <section className="page-hero" aria-labelledby="chapters-h">
        <div className="container">
          <p className="eyebrow">GDG Chapters</p>
          <h1 id="chapters-h">Find your developer community</h1>
          <p className="page-hero__sub">Google Developer Groups are local, volunteer-run communities. Find one in your city and show up.</p>
          <div className="search-xl" role="search">
            <Icon name="search" size={22} className="search-xl__icon" />
            <label htmlFor="chapter-search" className="sr-only">
              Search chapters
            </label>
            <input id="chapter-search" type="search" placeholder="Search by chapter, city or topic…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>
      </section>

      <section className="container section section--flush-top" aria-labelledby="featured-h">
        <SectionHeader id="featured-h" title="Featured city chapters" subtitle={`${featured.length} of ${CHAPTERS.length} chapters`} />
        {featured.length ? (
          <div className="chapter-grid">
            {featured.map((c) => (
              <ChapterCard key={c.id} chapter={c} count={counts.all[c.city] || 0} liveCount={counts.live[c.city] || 0} />
            ))}
          </div>
        ) : (
          <EmptyState title="No chapters match" message="Try another city or topic." />
        )}
      </section>

      <section className="container section section--flush-top" aria-labelledby="live-ch-h">
        <SectionHeader
          id="live-ch-h"
          eyebrow="Live from gdg.community.dev"
          title="Chapters with upcoming events"
          subtitle={gdgStatus.loading ? 'Loading live chapters…' : `${liveChapters.length} chapters across India have events scheduled`}
        />
        {gdgStatus.loading ? (
          <div className="live-chapters">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="skeleton" style={{ height: 76, borderRadius: 16 }} />
            ))}
          </div>
        ) : gdgStatus.error ? (
          <EmptyState icon="alert" title="Live chapters unavailable" message="We couldn't reach GDG Community right now." />
        ) : (
          <ul className="live-chapters">
            {liveChapters.map((c) => (
              <li key={c.name}>
                <a href={c.url} target="_blank" rel="noopener noreferrer" className="live-chapter">
                  <span className="avatar" aria-hidden="true">
                    {c.name.replace(/^GDG( on Campus| Cloud)?\s*/i, '').slice(0, 1)}
                  </span>
                  <span className="live-chapter__text">
                    <strong>{c.name}</strong>
                    <small>
                      {c.city}
                      {c.state ? `, ${c.state}` : ''} · {c.count} upcoming
                    </small>
                  </span>
                  <Icon name="external" size={16} />
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  )
}
