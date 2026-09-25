import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import Icon from '../components/Icon'
import { AvatarImage } from '../components/ProfileForm'
import { Badge, Button, EmptyState, ErrorState } from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { useData } from '../context/DataContext'
import { useOpenEvent } from '../hooks/useOpenEvent'
import { profileByUsername } from '../services/api'
import { formatDate, formatDateTime, isPast } from '../utils/format'

const LINKS = [
  ['githubUrl', 'github', 'GitHub'],
  ['linkedinUrl', 'linkedin', 'LinkedIn'],
  ['portfolioUrl', 'globe', 'Portfolio'],
]

// /profile/:username: visible to signed-in members only (RLS on profiles).
export default function PublicProfile() {
  const { username } = useParams()
  const { user: me } = useAuth()
  const { events } = useData()
  const openEvent = useOpenEvent()
  const [state, setState] = useState({ loading: true, error: null, p: null })

  const load = useCallback(async () => {
    setState({ loading: true, error: null, p: null })
    try {
      setState({ loading: false, error: null, p: await profileByUsername(username) })
    } catch (e) {
      setState({ loading: false, error: e.message, p: null })
    }
  }, [username])

  useEffect(() => {
    load()
  }, [load])
  useEffect(() => {
    if (state.p) document.title = `${state.p.name} (@${state.p.username}) · Codefolio`
  }, [state.p])

  const hosted = useMemo(
    () => (state.p ? events.filter((e) => e.createdBy === state.p.id).sort((a, b) => b.date.localeCompare(a.date)) : []),
    [events, state.p],
  )

  if (state.loading) {
    return (
      <div className="page-loading" aria-busy="true">
        <span className="spinner spinner--lg" aria-hidden="true" />
      </div>
    )
  }
  if (state.error) {
    return (
      <div className="container page-pad">
        <ErrorState message={state.error} onRetry={load} />
      </div>
    )
  }
  const p = state.p
  if (!p) {
    return (
      <div className="container page-pad">
        <EmptyState icon="user" title={`No member called @${username}`} message="Check the spelling. Usernames are lowercase." action={<Button to="/events">Explore events</Button>} />
      </div>
    )
  }
  const isMe = me?.id === p.id

  return (
    <div className="container page-pad">
      <div className="profile">
        <aside className="profile__card">
          <AvatarImage src={p.avatarUrl} name={p.name} className="avatar--xl" />
          <h1 className="profile__name">{p.name}</h1>
          <p className="muted mono-handle">@{p.username}</p>
          <Badge tone={p.role === 'organizer' ? 'saffron' : 'indigo'} icon={p.role === 'organizer' ? 'grid' : 'ticket'}>
            {p.role === 'organizer' ? 'Organizer' : 'Attendee'}
          </Badge>
          {(p.college || p.company) && (
            <ul className="pp-facts">
              {p.college && (
                <li>
                  <Icon name="users" size={14} /> {p.college}
                </li>
              )}
              {p.company && (
                <li>
                  <Icon name="grid" size={14} /> {p.company}
                </li>
              )}
              {p.city && (
                <li>
                  <Icon name="pin" size={14} /> {p.city}
                </li>
              )}
            </ul>
          )}
          {LINKS.some(([k]) => p[k]) && (
            <div className="pp-links">
              {LINKS.filter(([k]) => p[k]).map(([k, icon, label]) => (
                <a key={k} href={p[k]} target="_blank" rel="noopener noreferrer me" className="icon-btn" aria-label={label} title={label}>
                  <Icon name={icon} size={18} />
                </a>
              ))}
            </div>
          )}
          <p className="small muted">Member since {formatDateTime(p.createdAt).split(',')[0]}</p>
          {isMe && (
            <Button size="sm" variant="secondary" icon="edit" to="/profile">
              Edit profile
            </Button>
          )}
        </aside>

        <div className="pp-main">
          <section className="card" aria-labelledby="pp-about">
            <h2 id="pp-about" className="pp-h">
              About
            </h2>
            {p.bio ? <p className="pp-bio">{p.bio}</p> : <p className="muted">{isMe ? 'You haven’t written a bio yet.' : 'No bio yet.'}</p>}
            {p.skills.length > 0 && (
              <div className="tag-row">
                {p.skills.map((s) => (
                  <span key={s} className="tag">
                    {s}
                  </span>
                ))}
              </div>
            )}
          </section>

          {(p.role === 'organizer' || hosted.length > 0) && (
            <section className="card" aria-labelledby="pp-hosted">
              <div className="card__head">
                <h2 id="pp-hosted" className="pp-h">
                  Hosted
                </h2>
                <span className="small muted">{hosted.length} on Codefolio</span>
              </div>
              {hosted.length ? (
                <ul className="mini-list">
                  {hosted.map((e) => (
                    <li key={e.id}>
                      <button type="button" className="pp-event" onClick={() => openEvent(e.id)}>
                        <strong>{e.title}</strong>
                        <small>
                          {formatDate(e.date, { weekday: true })} · {e.city}
                          {e.status === 'Cancelled' ? ' · Cancelled' : isPast(e.date) ? ' · Completed' : ''}
                        </small>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted small">No events hosted yet.</p>
              )}
            </section>
          )}

          {isMe && (
            <p className="small muted">
              <Icon name="info" size={14} /> This is how other members see your profile. <Link to="/profile">Edit it</Link>.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
