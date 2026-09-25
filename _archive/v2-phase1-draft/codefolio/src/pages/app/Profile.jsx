import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import Icon from '../../components/Icon'
import { Avatar, Button, EmptyState, ErrorState, Skeleton, Status, Tag } from '../../components/ui'
import { useAuth } from '../../context/AuthContext'
import { friendlyError, supabase } from '../../lib/supabase'

const LINKS = [
  ['github_url', 'github', 'GitHub'],
  ['linkedin_url', 'linkedin', 'LinkedIn'],
  ['portfolio_url', 'globe', 'Portfolio'],
]

export default function Profile() {
  const { username } = useParams()
  const { profile: me } = useAuth()
  const [state, setState] = useState({ loading: true, error: null, p: null })

  const load = useCallback(async () => {
    setState({ loading: true, error: null, p: null })
    const { data, error } = await supabase
      .from('profiles')
      .select('id, username, full_name, avatar_url, college, company, bio, skills, github_url, linkedin_url, portfolio_url, role, created_at')
      .eq('username', username.toLowerCase())
      .eq('onboarding_completed', true)
      .maybeSingle()
    setState({ loading: false, error: error ? friendlyError(error) : null, p: data })
  }, [username])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (state.p) document.title = `${state.p.full_name} (@${state.p.username}) · Codefolio`
  }, [state.p])

  if (state.loading) {
    return (
      <div className="wrap page" aria-busy="true">
        <div className="profile-head">
          <Skeleton w={96} h={96} style={{ borderRadius: '50%' }} />
          <div style={{ display: 'grid', gap: 8, flex: 1 }}>
            <Skeleton w="40%" h={24} />
            <Skeleton w="20%" />
            <Skeleton w="70%" />
          </div>
        </div>
      </div>
    )
  }
  if (state.error) return <div className="wrap page"><ErrorState message={state.error} onRetry={load} /></div>
  if (!state.p) {
    return (
      <div className="wrap page">
        <EmptyState icon="user" title={`No member called @${username}`} action={<Button to="/home" variant="secondary">Go home</Button>}>
          Check the spelling. Usernames are lowercase.
        </EmptyState>
      </div>
    )
  }

  const p = state.p
  const isMe = me?.id === p.id
  const affiliation = [p.college, p.company].filter(Boolean)

  return (
    <div className="wrap page">
      <section className="profile-head" aria-labelledby="p-name">
        <Avatar src={p.avatar_url} name={p.full_name} size={96} />
        <div className="profile-head__main">
          <div className="profile-head__title">
            <h1 id="p-name">{p.full_name}</h1>
            {p.role === 'admin' && <Status status="admin" />}
          </div>
          <p className="muted mono">@{p.username}</p>
          {affiliation.length > 0 && (
            <p className="profile-head__aff">
              {p.college && (
                <span>
                  <Icon name="graduation" size={15} /> {p.college}
                </span>
              )}
              {p.company && (
                <span>
                  <Icon name="briefcase" size={15} /> {p.company}
                </span>
              )}
            </p>
          )}
          <ul className="profile-head__links">
            {LINKS.filter(([k]) => p[k]).map(([k, icon, label]) => (
              <li key={k}>
                <a href={p[k]} target="_blank" rel="noopener noreferrer me">
                  <Icon name={icon} size={15} /> {label}
                </a>
              </li>
            ))}
          </ul>
        </div>
        {isMe && (
          <Button variant="secondary" size="sm" icon="edit" to="/settings">
            Edit profile
          </Button>
        )}
      </section>

      <div className="profile-body">
        <section aria-labelledby="about-h" className="profile-section">
          <h2 id="about-h" className="eyebrow">
            About
          </h2>
          {p.bio ? <p className="profile-bio">{p.bio}</p> : <p className="muted">{isMe ? 'You haven’t written a bio yet.' : 'No bio yet.'}</p>}
        </section>
        <section aria-labelledby="skills-h" className="profile-section">
          <h2 id="skills-h" className="eyebrow">
            Skills
          </h2>
          {p.skills?.length ? (
            <div className="tags">
              {p.skills.map((s) => (
                <Tag key={s}>{s}</Tag>
              ))}
            </div>
          ) : (
            <p className="muted">No skills listed.</p>
          )}
        </section>
        <p className="small muted">
          Member since {new Date(p.created_at).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}
        </p>
      </div>
    </div>
  )
}
