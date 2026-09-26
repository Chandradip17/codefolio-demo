import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import Icon from '../components/Icon'
import Modal from '../components/Modal'
import { Badge, Button, EmptyState, ErrorState, Input, Segmented, Select, Textarea } from '../components/ui'
import { useData } from '../context/DataContext'
import { useToast } from '../context/ToastContext'
import * as api from '../services/api'
import { formatDate, timeAgo } from '../utils/format'

const EXPERIENCE = [
  { value: 'beginner', label: 'Beginner' },
  { value: 'intermediate', label: 'Intermediate' },
  { value: 'advanced', label: 'Advanced' },
]
const AVAILABILITY = [
  { value: 'full_time', label: 'Whole event' },
  { value: 'part_time', label: 'Part-time' },
  { value: 'flexible', label: 'Flexible' },
]
const GOALS = [
  { value: 'win', label: 'Compete to win' },
  { value: 'learn', label: 'Learn new things' },
  { value: 'build', label: 'Build a real product' },
  { value: 'network', label: 'Meet people' },
]
const WEIGHT_LABEL = { skills: 'Skill complement', goal: 'Hackathon goal', experience: 'Experience', availability: 'Availability', interests: 'Project interests' }
const label = (list, v) => list.find((x) => x.value === v)?.label || v

// Hackathon choice (?h=<id>) shared by both Team Matcher pages.
function useMatcherHackathons() {
  const [params, setParams] = useSearchParams()
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const load = useCallback(() => api.matcherHackathons().then(setData, (e) => setError(e.message)), [])
  useEffect(() => {
    load()
  }, [load])
  const id = params.get('h') || data?.hackathons[0]?.id || ''
  const hackathon = data?.hackathons.find((h) => h.id === id) || null
  const choose = (v) => setParams(v ? { h: v } : {}, { replace: true })
  return { data, error, id, hackathon, choose, reload: load }
}

function InviteModal({ person, eventId, onClose, onSent }) {
  const toast = useToast()
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function send(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await api.sendTeamRequest(eventId, person.userId, message.trim())
      toast({ title: 'Invitation sent', message: `${person.name} will see it in their Team Matcher.` })
      onSent()
    } catch (x) {
      setError(x.message)
      setBusy(false)
    }
  }
  return (
    <Modal
      open
      onClose={onClose}
      title={`Invite ${person.name}`}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="invite-form" icon="mail" loading={busy}>
            Send invitation
          </Button>
        </>
      }
    >
      <form id="invite-form" className="form-stack" onSubmit={send} noValidate>
        {error && (
          <p className="form-error" role="alert">
            <Icon name="alert" size={15} /> {error}
          </p>
        )}
        <Textarea label="Message" rows={3} maxLength={300} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Hi! I’m building the frontend — want to team up?" hint="Optional · 300 characters" />
        <p className="small muted">If they accept, you’ll both see each other’s team code. Joining still goes through the normal hackathon application.</p>
      </form>
    </Modal>
  )
}

function MatchCard({ m, onInvite }) {
  const r = m.request
  return (
    <article className="card match-card">
      <div className="match-card__head">
        <span className="avatar" aria-hidden="true">
          {m.avatarUrl ? <img src={m.avatarUrl} alt="" referrerPolicy="no-referrer" /> : m.name.slice(0, 1)}
        </span>
        <div>
          <strong>{m.name}</strong>
          <small className="muted">
            {m.username ? (
              <Link className="link" to={`/profile/${m.username}`}>
                @{m.username}
              </Link>
            ) : null}
            {m.organization ? ` · ${m.organization}` : ''}
          </small>
        </div>
        <span className="match-card__pct" title="How well your preferences complement each other (not a prediction)">
          <strong>{m.match.percent}%</strong> fit
        </span>
      </div>
      <p className="small muted">
        {label(EXPERIENCE, m.experience)} · {label(AVAILABILITY, m.availability)} · {label(GOALS, m.goal)}
        {m.team ? ` · in a team (${m.team.size}/${m.team.max})` : ''}
      </p>
      <div className="match-card__why">
        <h4>Why this match</h4>
        <ul className="dot-list small">
          {m.match.reasons.map((x) => (
            <li key={x}>{x}</li>
          ))}
          {m.match.notes.map((x) => (
            <li key={x} className="muted">
              {x}
            </li>
          ))}
        </ul>
      </div>
      {m.skills.length > 0 && (
        <div className="tag-row">
          {m.skills.slice(0, 8).map((s) => (
            <span key={s} className="tag">
              {s}
            </span>
          ))}
        </div>
      )}
      {m.about && <p className="small pre-line">{m.about}</p>}
      <div className="row-actions">
        {r?.status === 'accepted' ? (
          <Badge tone="success" icon="check">
            Teamed up
          </Badge>
        ) : r?.status === 'pending' ? (
          <Badge tone="warn" icon="clock">
            {r.direction === 'outgoing' ? 'Invitation sent' : 'Invited you'}
          </Badge>
        ) : (
          <Button size="sm" icon="mail" onClick={() => onInvite(m)}>
            Invite to team
          </Button>
        )}
      </div>
    </article>
  )
}

function Requests({ eventId, version, onChange }) {
  const toast = useToast()
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const load = useCallback(() => api.teamRequests(eventId).then(setData, (e) => setError(e.message)), [eventId])
  useEffect(() => {
    load()
  }, [load, version])

  async function respond(r, action) {
    setBusy(r.id + action)
    try {
      await api.respondTeamRequest(r.id, action)
      toast({ title: { accept: 'Invitation accepted', reject: 'Invitation declined', cancel: 'Invitation withdrawn' }[action], tone: action === 'accept' ? 'success' : 'info' })
      load()
      onChange()
    } catch (e) {
      toast({ title: 'Couldn’t update invitation', message: e.message, tone: 'error' })
    } finally {
      setBusy('')
    }
  }

  const groups = useMemo(() => {
    const rs = data?.requests || []
    return {
      incoming: rs.filter((r) => r.status === 'pending' && r.direction === 'incoming'),
      outgoing: rs.filter((r) => r.status === 'pending' && r.direction === 'outgoing'),
      accepted: rs.filter((r) => r.status === 'accepted'),
      closed: rs.filter((r) => ['rejected', 'cancelled'].includes(r.status)).slice(0, 5),
    }
  }, [data])

  const row = (r, actions) => (
    <li key={r.id}>
      <div>
        <strong>{r.person?.name || 'Member'}</strong>
        <small>
          {r.message ? `“${r.message}” · ` : ''}
          {timeAgo(Date.parse(r.createdAt))}
        </small>
      </div>
      <span className="mini-list__right">{actions}</span>
    </li>
  )

  return (
    <section className="card" aria-labelledby="req-h">
      <div className="card__head">
        <h3 id="req-h">Invitations</h3>
        <Button size="sm" variant="ghost" icon="refresh" onClick={load} aria-label="Refresh invitations" />
      </div>
      {error ? (
        <p className="form-error">{error}</p>
      ) : !data ? (
        <div className="skeleton" style={{ height: 120, borderRadius: 14 }} />
      ) : (
        <div className="form-stack">
          {data.myTeam && (
            <p className="small">
              Your team: <strong>{data.myTeam.name}</strong> · code <code>{data.myTeam.code}</code>
            </p>
          )}
          {!data.requests.length && <p className="muted small">No invitations yet. Invite someone from your matches.</p>}
          {groups.incoming.length > 0 && (
            <div>
              <h4 className="eyebrow">Received</h4>
              <ul className="mini-list">
                {groups.incoming.map((r) =>
                  row(
                    r,
                    <>
                      <Button size="sm" icon="check" onClick={() => respond(r, 'accept')} loading={busy === r.id + 'accept'}>
                        Accept
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => respond(r, 'reject')} loading={busy === r.id + 'reject'}>
                        Decline
                      </Button>
                    </>,
                  ),
                )}
              </ul>
            </div>
          )}
          {groups.outgoing.length > 0 && (
            <div>
              <h4 className="eyebrow">Sent</h4>
              <ul className="mini-list">
                {groups.outgoing.map((r) =>
                  row(
                    r,
                    <Button size="sm" variant="danger-ghost" onClick={() => respond(r, 'cancel')} loading={busy === r.id + 'cancel'}>
                      Withdraw
                    </Button>,
                  ),
                )}
              </ul>
            </div>
          )}
          {groups.accepted.length > 0 && (
            <div>
              <h4 className="eyebrow">Teamed up</h4>
              <ul className="mini-list">
                {groups.accepted.map((r) =>
                  row(
                    r,
                    r.partnerTeam ? (
                      <span className="small">
                        {r.partnerTeam.name} · <code>{r.partnerTeam.code}</code>
                      </span>
                    ) : (
                      <small className="muted">{data.myTeam ? 'Share your code' : 'No team yet'}</small>
                    ),
                  ),
                )}
              </ul>
              <p className="small muted">To join a partner’s team, apply to the hackathon with “Join team” and their code. If neither of you has a team yet, one of you creates it when applying.</p>
            </div>
          )}
          {groups.closed.length > 0 && (
            <div>
              <h4 className="eyebrow">Closed</h4>
              <ul className="mini-list">{groups.closed.map((r) => row(r, <Badge tone={r.status === 'rejected' ? 'danger' : 'neutral'}>{r.status === 'rejected' ? 'Declined' : 'Withdrawn'}</Badge>))}</ul>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

export default function TeamMatcher() {
  const { subscribe } = useData()
  const { data, error, id, hackathon, choose } = useMatcherHackathons()
  const [matches, setMatches] = useState(null)
  const [page, setPage] = useState(1)
  const [mError, setMError] = useState(null)
  const [inviting, setInviting] = useState(null)
  const [q, setQ] = useState('')
  const [version, setVersion] = useState(0)

  const prefs = hackathon?.preferences
  const load = useCallback(
    async (p = 1) => {
      if (!id || !prefs) return
      setMError(null)
      try {
        const r = await api.teamMatches(id, p)
        setMatches((cur) => (p === 1 ? r : { ...r, matches: [...(cur?.matches || []), ...r.matches] }))
        setPage(p)
      } catch (e) {
        setMError(e)
      }
    },
    [id, prefs],
  )
  useEffect(() => {
    setMatches(null)
    load(1)
  }, [load])
  // Invitations change in real time.
  useEffect(
    () =>
      subscribe((type, d) => {
        if (type === 'team.request' && d.eventId === id) {
          setVersion((v) => v + 1)
          load(1)
        }
      }),
    [subscribe, id, load],
  )

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return (matches?.matches || []).filter((m) => !needle || `${m.name} ${m.username || ''} ${m.skills.join(' ')} ${m.organization || ''}`.toLowerCase().includes(needle))
  }, [matches, q])

  if (error) {
    return (
      <div className="container page-pad">
        <ErrorState message={error} />
      </div>
    )
  }

  return (
    <div className="container page-pad">
      <header className="dash-head">
        <div>
          <p className="eyebrow">Team Matcher</p>
          <h1>Find teammates</h1>
          <p className="muted">Teammates whose skills complement yours, ranked by a transparent score. Every match explains why.</p>
        </div>
        <div className="dash-head__actions">
          {id && (
            <Button to={`/team-matcher/preferences?h=${encodeURIComponent(id)}`} variant="secondary" icon="edit">
              {prefs ? 'Edit preferences' : 'Set preferences'}
            </Button>
          )}
        </div>
      </header>

      {!data ? (
        <div className="skeleton" style={{ height: 320, borderRadius: 20 }} />
      ) : !data.hackathons.length ? (
        <EmptyState
          icon="trophy"
          title="No team hackathons open"
          message="Team matching is available for upcoming hackathons that allow teams."
          action={
            <Button to="/events" icon="search">
              Browse events
            </Button>
          }
        />
      ) : (
        <>
          <div className="table-tools">
            <Select
              label="Hackathon"
              value={id}
              onChange={(e) => choose(e.target.value)}
              options={data.hackathons.map((h) => ({ value: h.id, label: `${h.title} · ${formatDate(h.date, { year: false })}` }))}
            />
            {prefs && <Input label="Search matches" icon="search" placeholder="Name, skill or college" value={q} onChange={(e) => setQ(e.target.value)} />}
          </div>

          <div className="dash-grid">
            <div className="dash-main">
              {!prefs ? (
                <EmptyState
                  icon="users"
                  title="Tell us what you’re looking for"
                  message={`Save your skills and the roles you need for ${hackathon?.title}. Then you’ll see ranked, explained matches.`}
                  action={
                    <Button to={`/team-matcher/preferences?h=${encodeURIComponent(id)}`} icon="edit">
                      Set preferences
                    </Button>
                  }
                />
              ) : mError ? (
                <ErrorState message={mError.message} onRetry={() => load(1)} />
              ) : !matches ? (
                <div className="booking-list">
                  {[0, 1].map((i) => (
                    <div key={i} className="skeleton" style={{ height: 200, borderRadius: 20 }} />
                  ))}
                </div>
              ) : !matches.total ? (
                <EmptyState icon="search" title="No matches yet" message="No one else looking for a team has saved preferences for this hackathon. Check back soon — invitations arrive in real time." />
              ) : (
                <>
                  {!prefs.available && (
                    <p className="form-error" role="status">
                      <Icon name="eyeOff" size={15} /> You’re hidden from other people’s matches. Turn on “Available for invitations” in your preferences to be found.
                    </p>
                  )}
                  <div className="match-list">
                    {shown.map((m) => (
                      <MatchCard key={m.userId} m={m} onInvite={setInviting} />
                    ))}
                  </div>
                  {!shown.length && <EmptyState icon="search" title="No matches found" message="Try a different search." />}
                  {matches.hasMore && !q && (
                    <Button variant="secondary" onClick={() => load(page + 1)} className="btn--block">
                      Show more matches
                    </Button>
                  )}
                </>
              )}
            </div>
            <aside className="dash-aside" aria-label="Invitations">
              {prefs && <Requests eventId={id} version={version} onChange={() => load(1)} />}
              <section className="card">
                <div className="card__head">
                  <h3>How matches are scored</h3>
                </div>
                <ul className="mini-list">
                  {Object.entries(data.weights).map(([k, w]) => (
                    <li key={k}>
                      <div>
                        <strong>{WEIGHT_LABEL[k] || k}</strong>
                      </div>
                      <span className="mini-list__right">{Math.round(w * 100)}%</span>
                    </li>
                  ))}
                </ul>
                <p className="small muted">The same inputs always give the same score. AI is never used to rank people.</p>
              </section>
            </aside>
          </div>
        </>
      )}
      {inviting && (
        <InviteModal
          person={inviting}
          eventId={id}
          onClose={() => setInviting(null)}
          onSent={() => {
            setInviting(null)
            setVersion((v) => v + 1)
            load(1)
          }}
        />
      )}
    </div>
  )
}

// Comma/Enter tag field (same look as the profile skills field).
export function TagField({ id, label, value, onChange, max, placeholder, hint }) {
  const [draft, setDraft] = useState('')
  const add = (raw) => {
    const s = raw.trim().replace(/\s+/g, ' ').slice(0, 40)
    if (!s || value.some((v) => v.toLowerCase() === s.toLowerCase()) || value.length >= max) return setDraft('')
    onChange([...value, s])
    setDraft('')
  }
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <div className="tag-input" onClick={() => document.getElementById(id)?.focus()}>
        {value.map((s) => (
          <span key={s} className="tag tag-input__tag">
            {s}
            <button type="button" aria-label={`Remove ${s}`} onClick={() => onChange(value.filter((v) => v !== s))}>
              <Icon name="x" size={12} />
            </button>
          </span>
        ))}
        <input
          id={id}
          value={draft}
          placeholder={value.length ? '' : placeholder}
          disabled={value.length >= max}
          onChange={(e) => (e.target.value.endsWith(',') ? add(e.target.value.slice(0, -1)) : setDraft(e.target.value))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              add(draft)
            } else if (e.key === 'Backspace' && !draft && value.length) onChange(value.slice(0, -1))
          }}
          onBlur={() => draft && add(draft)}
        />
      </div>
      <p className="field__hint">
        {hint ? `${hint} · ` : ''}Press Enter or comma to add · {value.length}/{max}
      </p>
    </div>
  )
}

export function TeamPreferences() {
  const toast = useToast()
  const navigate = useNavigate()
  const { data, error, id, hackathon, choose } = useMatcherHackathons()
  const [form, setForm] = useState(null)
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState('')
  const [busy, setBusy] = useState(false)
  const [suggesting, setSuggesting] = useState(false)
  const [suggestions, setSuggestions] = useState(null)

  useEffect(() => {
    if (!data) return
    const p = hackathon?.preferences
    setForm({
      skills: p?.skills || [],
      lookingFor: p?.lookingFor || [],
      experience: p?.experience || 'intermediate',
      availability: p?.availability || 'full_time',
      goal: p?.goal || 'learn',
      interests: p?.interests || [],
      about: p?.about || '',
      available: p?.available ?? true,
    })
    setSuggestions(null)
  }, [data, hackathon])
  const set = (k) => (v) => {
    setForm((f) => ({ ...f, [k]: v }))
    setErrors((x) => ({ ...x, [k]: undefined }))
  }

  async function submit(e) {
    e.preventDefault()
    setFormError('')
    const x = {}
    if (!form.skills.length) x.skills = 'Add at least one skill.'
    setErrors(x)
    if (Object.keys(x).length) return
    setBusy(true)
    try {
      await api.saveTeamPreferences({ eventId: id, ...form, about: form.about.trim() })
      toast({ title: 'Preferences saved', message: 'Your matches are ready.' })
      navigate(`/team-matcher?h=${encodeURIComponent(id)}`)
    } catch (err) {
      if (err.fields) setErrors(err.fields)
      setFormError(err.message)
      setBusy(false)
    }
  }

  async function suggest() {
    setSuggesting(true)
    try {
      setSuggestions(await api.interpretSkills(form.about))
    } catch (err) {
      toast({ title: 'No suggestions', message: err.message, tone: 'error' })
    } finally {
      setSuggesting(false)
    }
  }
  const addAll = (k, items) => set(k)([...new Set([...form[k], ...items])].slice(0, k === 'lookingFor' ? 15 : k === 'skills' ? 30 : 15))

  return (
    <div className="container page-pad">
      <p className="small">
        <Link className="link" to={`/team-matcher${id ? `?h=${encodeURIComponent(id)}` : ''}`}>
          <Icon name="arrowLeft" size={14} /> Team Matcher
        </Link>
      </p>
      <header className="dash-head">
        <div>
          <p className="eyebrow">Team Matcher</p>
          <h1>Team preferences</h1>
          <p className="muted">What you bring and who you need. Saved per hackathon; only matched members see your skills and summary.</p>
        </div>
      </header>

      {error ? (
        <ErrorState message={error} />
      ) : !data || !form ? (
        <div className="skeleton" style={{ height: 420, borderRadius: 20 }} />
      ) : !data.hackathons.length ? (
        <EmptyState icon="trophy" title="No team hackathons open" message="Team matching is available for upcoming hackathons that allow teams." />
      ) : (
        <form className="card form-stack prefs-form" onSubmit={submit} noValidate>
          {formError && (
            <p className="form-error" role="alert">
              <Icon name="alert" size={15} /> {formError}
            </p>
          )}
          <Select
            label="Hackathon"
            value={id}
            onChange={(e) => choose(e.target.value)}
            options={data.hackathons.map((h) => ({ value: h.id, label: `${h.title} · ${formatDate(h.date, { year: false })}` }))}
            hint={hackathon ? `Teams of ${hackathon.teamMin}–${hackathon.teamMax}${hackathon.theme ? ` · ${hackathon.theme}` : ''}` : undefined}
          />
          <TagField id="tm-skills" label="Your skills" value={form.skills} onChange={set('skills')} max={30} placeholder="e.g. React, Figma, Python" />
          {errors.skills && <p className="field__error">{errors.skills}</p>}
          <div className="field">
            <span className="field__label">Looking for</span>
            <div className="chip-row" role="group" aria-label="Roles you need">
              {data.roles.map((r) => (
                <button key={r.id} type="button" className="chip" aria-pressed={form.lookingFor.includes(r.id)} onClick={() => set('lookingFor')(form.lookingFor.includes(r.id) ? form.lookingFor.filter((x) => x !== r.id) : [...form.lookingFor, r.id])}>
                  {r.label}
                </button>
              ))}
            </div>
            <p className="field__hint">The roles your team is missing. This counts most in the match score.</p>
          </div>
          <div className="grid-2">
            <Select label="Experience" value={form.experience} onChange={(e) => set('experience')(e.target.value)} options={EXPERIENCE} />
            <Select label="What you want from this hackathon" value={form.goal} onChange={(e) => set('goal')(e.target.value)} options={GOALS} />
          </div>
          <div className="field">
            <span className="field__label">Availability</span>
            <Segmented label="Availability" value={form.availability} onChange={set('availability')} options={AVAILABILITY} />
          </div>
          <TagField id="tm-interests" label="Project interests" value={form.interests} onChange={set('interests')} max={15} placeholder="e.g. Education, Health, Climate" hint="Optional" />
          <Textarea label="About you" rows={3} maxLength={500} value={form.about} onChange={(e) => set('about')(e.target.value)} hint="Optional · shown to your matches · 500 characters" placeholder="I build dashboards and love clean UI…" />
          {data.aiAvailable && (
            <div className="field">
              <Button type="button" size="sm" variant="secondary" icon="sparkles" onClick={suggest} loading={suggesting} disabled={form.about.trim().length < 10}>
                Suggest skills with AI
              </Button>
              {suggestions && (
                <div className="form-stack prefs-suggest">
                  <p className="small muted">
                    <Icon name="info" size={14} /> AI suggestions — add only what’s true. They never affect the score directly.
                  </p>
                  {suggestions.skills.length > 0 && (
                    <p className="small">
                      Skills: {suggestions.skills.join(', ')}{' '}
                      <button type="button" className="link" onClick={() => addAll('skills', suggestions.skills)}>
                        Add
                      </button>
                    </p>
                  )}
                  {suggestions.roles.length > 0 && (
                    <p className="small">
                      Roles: {suggestions.roles.map((r) => data.roles.find((x) => x.id === r)?.label || r).join(', ')}{' '}
                      <button type="button" className="link" onClick={() => addAll('lookingFor', suggestions.roles)}>
                        Add to “Looking for”
                      </button>
                    </p>
                  )}
                  {suggestions.interests.length > 0 && (
                    <p className="small">
                      Interests: {suggestions.interests.join(', ')}{' '}
                      <button type="button" className="link" onClick={() => addAll('interests', suggestions.interests)}>
                        Add
                      </button>
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
          <label className="check-row">
            <input type="checkbox" checked={form.available} onChange={(e) => set('available')(e.target.checked)} />
            Available for invitations
          </label>
          <div className="row-actions">
            <Button type="submit" icon="check" loading={busy}>
              Save and see matches
            </Button>
          </div>
        </form>
      )}
    </div>
  )
}
