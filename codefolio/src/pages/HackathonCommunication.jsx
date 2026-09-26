import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import AnnouncementItem from '../components/AnnouncementItem'
import Icon from '../components/Icon'
import { Button, EmptyState, ErrorState, Segmented, Select } from '../components/ui'
import { useData } from '../context/DataContext'
import { useToast } from '../context/ToastContext'
import * as api from '../services/api'
import { formatDate, formatIST } from '../utils/format'

// Hackathon updates for participants and judges. What each person sees is decided
// by the server (their role and team in this hackathon), never by this page.
export default function HackathonCommunication() {
  const { hackathonId } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const { subscribe } = useData()
  const [list, setList] = useState(null)
  const [listError, setListError] = useState('')
  const [feed, setFeed] = useState(null)
  const [error, setError] = useState(null)
  const [filter, setFilter] = useState('all')
  const [more, setMore] = useState(false)

  const loadList = useCallback(() => api.announcementHackathons().then(setList, (e) => setListError(e.message)), [])
  useEffect(() => {
    loadList()
  }, [loadList])
  const id = hackathonId || list?.[0]?.id || ''

  const load = useCallback(async () => {
    if (!id) return
    setError(null)
    try {
      setFeed(await api.announcements(id))
    } catch (e) {
      setError(e)
    }
  }, [id])
  useEffect(() => {
    setFeed(null)
    load()
  }, [load])
  // New / edited / archived announcements arrive without a refresh.
  useEffect(
    () =>
      subscribe((type, d) => {
        if ((type === 'announcement.published' || type === 'announcement.updated') && d.eventId === id) {
          load()
          loadList()
        }
      }),
    [subscribe, id, load, loadList],
  )

  async function loadMore() {
    setMore(true)
    try {
      const last = feed.announcements[feed.announcements.length - 1]
      const r = await api.announcements(id, last.publishAt)
      setFeed((f) => ({ ...f, announcements: [...f.announcements, ...r.announcements.filter((a) => !f.announcements.some((x) => x.id === a.id))], hasMore: r.hasMore }))
    } catch (e) {
      toast({ title: 'Couldn’t load more', message: e.message, tone: 'error' })
    } finally {
      setMore(false)
    }
  }

  async function markRead(ids) {
    try {
      await api.markAnnouncementsRead(id, ids)
      setFeed((f) => ({ ...f, announcements: f.announcements.map((a) => (!ids || ids.includes(a.id) ? { ...a, read: true } : a)) }))
      setList((l) => l?.map((h) => (h.id === id ? { ...h, unread: ids ? Math.max(0, h.unread - ids.length) : 0 } : h)))
    } catch (e) {
      toast({ title: 'Couldn’t update', message: e.message, tone: 'error' })
    }
  }

  const shown = useMemo(() => {
    const all = feed?.announcements || []
    return filter === 'unread' ? all.filter((a) => !a.read) : filter === 'important' ? all.filter((a) => a.important) : all
  }, [feed, filter])
  const unread = (feed?.announcements || []).filter((a) => !a.read).length
  const manager = feed?.role.manager

  return (
    <div className="container page-pad">
      <header className="dash-head">
        <div>
          <p className="eyebrow">Hackathon updates</p>
          <h1>{feed?.event.title || 'Updates'}</h1>
          <p className="muted">Announcements from the organizers of the hackathons you’re part of.</p>
        </div>
        <div className="dash-head__actions">
          {manager && (
            <Button to={`/organizer/communication?h=${encodeURIComponent(id)}`} variant="secondary" icon="edit">
              Communication Center
            </Button>
          )}
          {!manager && unread > 0 && (
            <Button variant="secondary" icon="check" onClick={() => markRead(null)}>
              Mark all as read
            </Button>
          )}
        </div>
      </header>

      {listError ? (
        <ErrorState message={listError} />
      ) : !list ? (
        <div className="skeleton" style={{ height: 280, borderRadius: 20 }} />
      ) : !list.length && !hackathonId ? (
        <EmptyState
          icon="radio"
          title="No hackathon updates yet"
          message="When you apply to a hackathon (or judge one), its organizers’ announcements appear here."
          action={
            <Button to="/events" icon="search">
              Browse events
            </Button>
          }
        />
      ) : (
        <>
          {list.length > 0 && (
            <div className="table-tools">
              <Select
                label="Hackathon"
                value={id}
                onChange={(e) => navigate(`/hackathons/${encodeURIComponent(e.target.value)}/communication`)}
                options={[
                  ...(list.some((h) => h.id === id) ? [] : [{ value: id, label: feed?.event.title || id }]),
                  ...list.map((h) => ({ value: h.id, label: `${h.title} · ${formatDate(h.date, { year: false })}${h.unread ? ` · ${h.unread} new` : ''}` })),
                ]}
              />
            </div>
          )}

          {error ? (
            error.status === 404 ? (
              <EmptyState icon="lock" title="Updates not available" message="You aren’t part of this hackathon." />
            ) : (
              <ErrorState message={error.message} onRetry={load} />
            )
          ) : !feed ? (
            <div className="skeleton" style={{ height: 280, borderRadius: 20 }} />
          ) : (
            <div className="dash-grid">
              <div className="dash-main">
                <div className="section-head section-head--tight">
                  <h2>Announcements</h2>
                  <Segmented
                    label="Filter announcements"
                    value={filter}
                    onChange={setFilter}
                    options={[
                      { value: 'all', label: 'All', count: feed.announcements.length },
                      ...(manager ? [] : [{ value: 'unread', label: 'Unread', count: unread }]),
                      { value: 'important', label: 'Important', count: feed.announcements.filter((a) => a.important).length },
                    ]}
                  />
                </div>
                {!shown.length ? (
                  <EmptyState
                    icon="radio"
                    title={filter === 'all' ? 'No announcements yet' : filter === 'unread' ? 'You’re all caught up' : 'No important announcements'}
                    message={filter === 'all' ? 'New announcements appear here as soon as the organizers post them.' : 'Nothing to show for this filter.'}
                  />
                ) : (
                  <div className="announce-list">
                    {shown.map((a) => (
                      <AnnouncementItem key={a.id} a={a} onRead={manager ? null : (x) => markRead([x.id])} />
                    ))}
                  </div>
                )}
                {feed.hasMore && filter === 'all' && (
                  <Button variant="secondary" className="btn--block" onClick={loadMore} loading={more}>
                    Show older announcements
                  </Button>
                )}
              </div>
              <aside className="dash-aside" aria-label="Deadlines">
                <section className="card">
                  <div className="card__head">
                    <h3>
                      <Icon name="clock" size={17} /> Upcoming deadlines
                    </h3>
                  </div>
                  {feed.deadlines.length ? (
                    <ul className="mini-list">
                      {feed.deadlines.map((d) => (
                        <li key={d.key}>
                          <div>
                            <strong>{d.label}</strong>
                            <small>{formatIST(d.at)}</small>
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="muted small">No upcoming deadlines in this hackathon’s listing.</p>
                  )}
                  <p className="small muted">From the hackathon’s listing. The organizers’ announcements take priority if they differ.</p>
                </section>
              </aside>
            </div>
          )}
        </>
      )}
    </div>
  )
}
