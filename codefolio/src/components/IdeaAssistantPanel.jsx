import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import Icon from './Icon'
import { ConfirmDialog } from './Modal'
import { Badge, Button, EmptyState, ErrorState, Input, Segmented, Select } from './ui'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { useNow } from '../hooks/useNow'
import * as api from '../services/api'
import { cx, formatDate, formatDateTime } from '../utils/format'
import { TagField } from '../pages/TeamMatcher'

const EXPERIENCE = [
  { value: 'beginner', label: 'Beginner' },
  { value: 'intermediate', label: 'Intermediate' },
  { value: 'advanced', label: 'Advanced' },
]
const INTEREST_SUGGESTIONS = ['AI', 'Education', 'Healthcare', 'FinTech', 'Climate', 'Cybersecurity', 'Web', 'Mobile']
const TEAM_SIZES = [
  { value: 1, label: 'Solo' },
  { value: 2, label: '2' },
  { value: 3, label: '3' },
  { value: 4, label: '4' },
  { value: 5, label: '5+' },
]
const HOURS = [12, 24, 36, 48]
// Refinements (the server holds the actual instructions; only the id is sent).
const ACTIONS = [
  { id: 'develop', label: 'Develop this idea', icon: 'sparkles' },
  { id: 'easier', label: 'Make it simpler', icon: 'check' },
  { id: 'innovative', label: 'More innovative', icon: 'zap' },
  { id: 'technical', label: 'More technical', icon: 'code' },
  { id: 'ai', label: 'Add AI', icon: 'sparkles' },
  { id: 'mvp', label: 'Improve MVP', icon: 'layers' },
]

function List({ items, ordered }) {
  if (!items?.length) return <p className="muted small">Not specified.</p>
  const Tag = ordered ? 'ol' : 'ul'
  return (
    <Tag className={ordered ? 'idea-steps' : 'dot-list'}>
      {items.map((x) => (
        <li key={x}>{x}</li>
      ))}
    </Tag>
  )
}

// The structured idea. AI content is always labelled; the team decides.
export function IdeaView({ idea, aiGenerated, compact }) {
  const block = (title, body) => (
    <div className="judge-block">
      <h4>{title}</h4>
      {body}
    </div>
  )
  return (
    <div className="idea">
      <div className="idea__head">
        <h2>{idea.title}</h2>
        {aiGenerated && (
          <Badge tone="info" icon="sparkles">
            AI-generated
          </Badge>
        )}
      </div>
      {block('Problem', <p className="pre-line">{idea.problemStatement}</p>)}
      {block('Proposed solution', <p className="pre-line">{idea.solution}</p>)}
      {block('Core features', <List items={idea.features} ordered />)}
      {block(
        'Recommended tech stack',
        idea.techStack?.length ? (
          <div className="tag-row">
            {idea.techStack.map((t) => (
              <span key={t} className="tag">
                {t}
              </span>
            ))}
          </div>
        ) : (
          <p className="muted small">Not specified.</p>
        ),
      )}
      {block('MVP scope', <p className="pre-line">{idea.mvpScope || 'Not specified.'}</p>)}
      {!compact && (
        <details className="idea-more">
          <summary>Why it fits, users, roadmap &amp; risks</summary>
          <div className="idea-more__body">
            {idea.whyItFits && block('Why it fits this hackathon', <p className="pre-line">{idea.whyItFits}</p>)}
            {block('Target users', <p className="pre-line">{idea.targetUsers || 'Not specified.'}</p>)}
            {block('Implementation roadmap', <List items={idea.roadmap} ordered />)}
            {block('Potential challenges', <List items={idea.challenges} />)}
            {block('Future improvements', <List items={idea.futureImprovements} />)}
            {idea.assumptions?.length > 0 && block('Assumptions & things to verify', <List items={idea.assumptions} />)}
          </div>
        </details>
      )}
    </div>
  )
}

// One idea card: expand for details; refine in place; save.
function IdeaCard({ item, index, open, onToggle, onRefine, onSave, busy, disabled, aiDisabled }) {
  const { idea } = item
  return (
    <article className={cx('card idea-card', open && 'is-open')}>
      <button type="button" className="idea-card__head" onClick={onToggle} aria-expanded={open}>
        <span className="idea-card__num" aria-hidden="true">
          {index + 1}
        </span>
        <span className="idea-card__title">
          <strong>{idea.title}</strong>
          <small className="muted">{idea.whyItFits || idea.problemStatement}</small>
        </span>
        {item.savedId && !item.dirty && <Badge tone="success">Saved</Badge>}
        <Icon name="chevronDown" size={18} className="idea-card__chev" />
      </button>
      {open && (
        <div className="idea-card__body">
          <IdeaView idea={idea} aiGenerated={item.aiGenerated} />
          {item.aiGenerated && (
            <p className="small muted judge-ai__note">
              <Icon name="info" size={14} /> AI-generated suggestion. It can be wrong and isn’t a promise of any result. Check technologies and data sources; the hackathon’s real rules are in its listing.
            </p>
          )}
          <div className="row-actions idea-actions">
            {ACTIONS.map((a) => (
              <Button key={a.id} size="sm" variant="secondary" icon={a.icon} onClick={() => onRefine(a.id)} loading={busy === a.id} disabled={disabled || aiDisabled}>
                {a.label}
              </Button>
            ))}
            <Button size="sm" icon="check" onClick={onSave} loading={busy === 'save'} disabled={disabled || (item.savedId && !item.dirty)}>
              {item.savedId ? (item.dirty ? 'Save changes' : 'Saved') : 'Save idea'}
            </Button>
          </div>
        </div>
      )}
    </article>
  )
}

export default function IdeaAssistantPanel({ initialHackathon = '', onNavigate }) {
  const { user, updateProfile } = useAuth()
  const toast = useToast()
  const [list, setList] = useState(null)
  const [listError, setListError] = useState('')
  const [hackathonId, setHackathonId] = useState(initialHackathon)
  const [ctx, setCtx] = useState(null)
  const [ctxError, setCtxError] = useState(null)
  const [form, setForm] = useState(null)
  const [saveSkills, setSaveSkills] = useState(false)
  const [errors, setErrors] = useState({})
  const [results, setResults] = useState([]) // [{ idea, draftId, savedId, aiGenerated, dirty }]
  const [openIdx, setOpenIdx] = useState(0)
  const [busy, setBusy] = useState({ idx: -1, kind: '' })
  const [aiError, setAiError] = useState('')
  const [cooldownUntil, setCooldownUntil] = useState(0)
  const [saved, setSaved] = useState([])
  const [deleting, setDeleting] = useState(null)

  useEffect(() => {
    api.ideaHackathons().then(
      (r) => {
        setList(r)
        if (!initialHackathon && r.hackathons.length === 1) setHackathonId(r.hackathons[0].id)
      },
      (e) => setListError(e.message),
    )
  }, [initialHackathon])

  const loadSaved = useCallback(() => (hackathonId ? api.myIdeas(hackathonId).then(setSaved, () => setSaved([])) : null), [hackathonId])
  useEffect(() => {
    if (!hackathonId) return
    let live = true
    setCtx(null)
    setCtxError(null)
    setResults([])
    setAiError('')
    api.ideaContext(hackathonId).then(
      (c) => {
        if (!live) return
        setCtx(c)
        setForm({ problemArea: '', techPreference: '', difficulty: 'intermediate', count: c.ideaCount?.default || 3, ...c.prefill })
        setCooldownUntil(c.cooldownLeft ? Date.now() + c.cooldownLeft * 1000 : 0)
      },
      (e) => live && setCtxError(e),
    )
    loadSaved()
    return () => {
      live = false
    }
  }, [hackathonId, loadSaved])

  const now = useNow(cooldownUntil ? 250 : null)
  const cooldownLeft = Math.max(0, Math.ceil((cooldownUntil - now) / 1000))
  // Stop the clock once the wait is over.
  useEffect(() => {
    if (cooldownUntil && !cooldownLeft) setCooldownUntil(0)
  }, [cooldownUntil, cooldownLeft])
  const working = busy.kind !== ''

  const set = (k) => (v) => {
    setForm((f) => ({ ...f, [k]: v }))
    setErrors((x) => ({ ...x, [k]: undefined }))
  }
  const inputs = () => ({
    eventId: hackathonId,
    problemArea: form.problemArea.trim(),
    skills: form.skills,
    interests: form.interests,
    experience: form.experience,
    difficulty: form.difficulty,
    hours: Number(form.hours),
    teamSize: Number(form.teamSize),
    techPreference: form.techPreference.trim(),
  })
  const aiFailed = (e) => {
    setAiError(e.message)
    // Mirror the server: its cooldown also applies after a call that reached Gemini and failed.
    const wait = e.retryAfter || (['ai/unavailable', 'ai/rate_limited', 'ai/config_invalid'].includes(e.code) ? ctx?.cooldownSeconds : 0)
    if (wait) setCooldownUntil(Date.now() + wait * 1000)
  }

  async function generate() {
    const x = {}
    const h = Number(form.hours)
    if (!Number.isInteger(h) || h < 1 || h > 240) x.hours = 'Between 1 and 240 hours.'
    setErrors(x)
    if (Object.keys(x).length) return
    setBusy({ idx: -1, kind: 'generate' })
    setAiError('')
    try {
      if (saveSkills) {
        await updateProfile({ skills: form.skills.slice(0, 20) })
        setSaveSkills(false)
        toast({ title: 'Profile skills updated', tone: 'info' })
      }
      const r = await api.generateIdea({ ...inputs(), count: Number(form.count) })
      setResults(r.ideas.map(({ draftId, ...idea }) => ({ idea, draftId, savedId: null, aiGenerated: true, dirty: true })))
      setOpenIdx(0)
      setCooldownUntil(Date.now() + (r.cooldownSeconds || 0) * 1000)
    } catch (e) {
      if (e.fields) setErrors(e.fields)
      aiFailed(e)
    } finally {
      setBusy({ idx: -1, kind: '' })
    }
  }

  async function refine(i, action) {
    setBusy({ idx: i, kind: action })
    setAiError('')
    try {
      const r = await api.refineIdea(action, results[i].idea, inputs())
      const { draftId, ...idea } = r.idea
      setResults((list) => list.map((x, j) => (j === i ? { ...x, idea, draftId, aiGenerated: true, dirty: true } : x)))
      setCooldownUntil(Date.now() + (r.cooldownSeconds || 0) * 1000)
    } catch (e) {
      aiFailed(e)
    } finally {
      setBusy({ idx: -1, kind: '' })
    }
  }

  async function save(i) {
    const it = results[i]
    setBusy({ idx: i, kind: 'save' })
    try {
      const out = it.savedId ? await api.updateIdea(it.savedId, it.idea, inputs(), it.draftId) : await api.saveIdea(it.idea, inputs(), it.draftId)
      setResults((list) => list.map((x, j) => (j === i ? { ...x, savedId: out.id, dirty: false } : x)))
      toast({ title: it.savedId ? 'Idea updated' : 'Idea saved', message: 'Import it when you submit your project.' })
      loadSaved()
    } catch (e) {
      toast({ title: 'Couldn’t save the idea', message: e.message, tone: 'error' })
    } finally {
      setBusy({ idx: -1, kind: '' })
    }
  }

  function openSaved(s) {
    const { id, inputs: savedInputs, aiGenerated, ...idea } = s
    const at = results.findIndex((x) => x.savedId === id)
    if (at >= 0) setOpenIdx(at)
    else {
      setResults((list) => [{ idea, draftId: null, savedId: id, aiGenerated, dirty: false }, ...list])
      setOpenIdx(0)
    }
    if (savedInputs) setForm((f) => ({ ...f, ...savedInputs, eventId: undefined }))
  }

  async function confirmDelete() {
    try {
      await api.deleteIdea(deleting.id)
      setResults((list) => list.map((x) => (x.savedId === deleting.id ? { ...x, savedId: null, dirty: true } : x)))
      toast({ title: 'Idea deleted', tone: 'info' })
      loadSaved()
    } catch (e) {
      toast({ title: 'Couldn’t delete', message: e.message, tone: 'error' })
    } finally {
      setDeleting(null)
    }
  }

  // ---- Step 1: choose one of MY hackathons (the server decides which) ----
  if (listError) return <ErrorState message={listError} />
  if (!list) return <div className="skeleton" style={{ height: 240, borderRadius: 20 }} />
  if (!list.hackathons.length) {
    return (
      <EmptyState
        icon="sparkles"
        title="Apply to a hackathon first"
        message="The AI Idea Assistant works with hackathons you’ve applied to, so ideas fit their theme and rules."
        action={
          <Button to="/events" icon="search" onClick={onNavigate}>
            Browse hackathons
          </Button>
        }
      />
    )
  }
  if (!hackathonId) {
    return (
      <div className="form-stack">
        <p className="eyebrow">Step 1 · Choose a hackathon</p>
        <ul className="mini-list">
          {list.hackathons.map((h) => (
            <li key={h.id}>
              <div>
                <strong>{h.title}</strong>
                <small>
                  {formatDate(h.date, { year: false })}
                  {h.theme ? ` · ${h.theme}` : ''}
                  {h.ended ? ' · ended' : ''}
                  {h.saved ? ` · ${h.saved} saved idea${h.saved === 1 ? '' : 's'}` : ''}
                </small>
              </div>
              <span className="mini-list__right">
                <Button size="sm" variant="secondary" iconRight="arrowRight" onClick={() => setHackathonId(h.id)}>
                  Choose
                </Button>
              </span>
            </li>
          ))}
        </ul>
        <p className="small muted">Only hackathons you’ve applied to are listed.</p>
      </div>
    )
  }

  if (ctxError) {
    return (
      <div className="form-stack">
        <ErrorState message={ctxError.message} />
        <Button variant="ghost" icon="arrowLeft" onClick={() => setHackathonId('')}>
          Choose another hackathon
        </Button>
      </div>
    )
  }
  if (!ctx || !form) return <div className="skeleton" style={{ height: 320, borderRadius: 20 }} />
  const h = ctx.hackathon
  const hourOptions = [...new Set([...HOURS, ...(h.hours ? [h.hours] : []), Number(form.hours)])].sort((a, b) => a - b).map((v) => ({ value: v, label: `${v}h${v === h.hours ? ' (this hackathon)' : ''}` }))

  return (
    <div className="ia">
      {/* ---- Step 2: the hackathon, as stored in Codefolio ---- */}
      <section className="card judge-card" aria-labelledby="ia-h">
        <div className="card__head">
          <h3 id="ia-h">
            <Icon name="trophy" size={17} /> {h.title}
          </h3>
          {list.hackathons.length > 1 && (
            <Button size="sm" variant="ghost" icon="arrowLeft" onClick={() => setHackathonId('')}>
              Change
            </Button>
          )}
        </div>
        <div className="event-summary__nums">
          {h.theme && (
            <span>
              <strong>{h.theme}</strong> theme
            </span>
          )}
          <span>
            <strong>
              {h.teamMin}–{h.teamMax}
            </strong>{' '}
            per team
          </span>
          {h.hours && (
            <span>
              <strong>{h.hours}</strong> hours of hacking
            </span>
          )}
          <span>
            <strong>{formatDate(h.date, { year: false })}</strong>
            {h.endDate && h.endDate !== h.date ? ` – ${formatDate(h.endDate, { year: false })}` : ''}
          </span>
        </div>
        {(h.description || h.requirements?.length) && (
          <details className="ia-details">
            <summary className="small">Hackathon details the AI will use</summary>
            {h.description && <p className="small pre-line">{h.description}</p>}
            {h.requirements?.length > 0 && (
              <ul className="dot-list small">
                {h.requirements.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            )}
          </details>
        )}
      </section>

      {/* ---- Step 3: preferences (prefilled from the profile; editable for this session) ---- */}
      <section className="card judge-card" aria-labelledby="ia-pref-h">
        <div className="card__head">
          <h3 id="ia-pref-h">
            <Icon name="user" size={17} /> Your details
          </h3>
        </div>
        {!ctx.aiAvailable && (
          <p className="form-error" role="status">
            <Icon name="info" size={15} /> AI Idea Assistant is not configured on this server. Your saved ideas are still available.
          </p>
        )}
        <div className="form-stack">
          <TagField id="ia-skills" label="Skills" value={form.skills} onChange={set('skills')} max={20} placeholder="e.g. React, Python" hint="From your profile · changes apply to this session" />
          {user && (
            <label className="check-row">
              <input type="checkbox" checked={saveSkills} onChange={(e) => setSaveSkills(e.target.checked)} /> Save these skills to my profile
            </label>
          )}
          <TagField id="ia-interests" label="Interests" value={form.interests} onChange={set('interests')} max={10} placeholder="e.g. Education" hint="Optional" />
          <div className="chip-row" role="group" aria-label="Suggested interests">
            {INTEREST_SUGGESTIONS.map((t) => {
              const on = form.interests.some((x) => x.toLowerCase() === t.toLowerCase())
              return (
                <button
                  key={t}
                  type="button"
                  className="chip"
                  aria-pressed={on}
                  onClick={() =>
                    setForm((f) => {
                      const has = f.interests.some((x) => x.toLowerCase() === t.toLowerCase())
                      return { ...f, interests: has ? f.interests.filter((x) => x.toLowerCase() !== t.toLowerCase()) : [...f.interests, t].slice(0, 10) }
                    })
                  }
                >
                  {t}
                </button>
              )
            })}
          </div>
          <Input label="Problem area" value={form.problemArea} onChange={(e) => set('problemArea')(e.target.value)} maxLength={300} placeholder="e.g. attendance in rural schools" hint="Optional · leave empty for problems that fit the theme" />
          <div className="grid-2">
            <Select label="Experience" value={form.experience} onChange={(e) => set('experience')(e.target.value)} options={EXPERIENCE} />
            <Input label="Technology preference" value={form.techPreference} onChange={(e) => set('techPreference')(e.target.value)} maxLength={200} placeholder="e.g. Flutter, Firebase" hint="Optional" />
          </div>
          <div className="field">
            <span className="field__label">Difficulty</span>
            <Segmented label="Difficulty" value={form.difficulty} onChange={set('difficulty')} options={EXPERIENCE} />
          </div>
          <div className="field">
            <span className="field__label">Team size</span>
            <Segmented label="Team size" value={Math.min(5, Number(form.teamSize))} onChange={set('teamSize')} options={TEAM_SIZES} />
            <p className="field__hint">{ctx.prefill.teamSizeFromTeam ? `Your team currently has ${ctx.prefill.teamSize}.` : `This hackathon allows teams of ${h.teamMin}–${h.teamMax}.`}</p>
          </div>
          <div className="grid-2">
            <Select label="Development time" value={String(form.hours)} error={errors.hours} onChange={(e) => set('hours')(Number(e.target.value))} options={hourOptions.map((o) => ({ ...o, value: String(o.value) }))} />
            <Select label="Number of ideas" value={String(form.count)} onChange={(e) => set('count')(Number(e.target.value))} options={[3, 4, 5].map((n) => ({ value: String(n), label: `${n} ideas` }))} />
          </div>
          <div className="ia-generate">
            <span className="small muted" aria-live="polite">
              {cooldownLeft ? `You can ask again in ${cooldownLeft} second${cooldownLeft === 1 ? '' : 's'}.` : 'Takes about 15–30 seconds.'}
            </span>
            <Button icon="sparkles" onClick={generate} loading={busy.kind === 'generate'} disabled={!ctx.aiAvailable || working || Boolean(cooldownLeft)}>
              {results.length ? 'Generate new ideas' : 'Generate ideas'}
            </Button>
          </div>
        </div>
      </section>

      {aiError && (
        <p className="form-error" role="alert">
          <Icon name="alert" size={15} /> {aiError}
        </p>
      )}

      {/* ---- Generating: placeholders while Gemini works ---- */}
      {busy.kind === 'generate' && (
        <section className="ia-results" aria-live="polite" aria-busy="true">
          <p className="small muted ia-status">
            <span className="spinner" aria-hidden="true" /> Generating {form.count} ideas for {h.title}…
          </p>
          {Array.from({ length: Number(form.count) || 3 }, (_, i) => (
            <div key={i} className="skeleton" style={{ height: 72, borderRadius: 16 }} />
          ))}
        </section>
      )}

      {/* ---- Results ---- */}
      {results.length > 0 && busy.kind !== 'generate' && (
        <section className="ia-results" aria-label="Project ideas">
          <div className="section-head section-head--tight">
            <h2>Ideas for {h.title}</h2>
          </div>
          {results.map((it, i) => (
            <IdeaCard
              key={`${it.savedId || it.draftId || i}`}
              item={it}
              index={i}
              open={openIdx === i}
              onToggle={() => setOpenIdx(openIdx === i ? -1 : i)}
              onRefine={(a) => refine(i, a)}
              onSave={() => save(i)}
              busy={busy.idx === i ? busy.kind : ''}
              disabled={working}
              aiDisabled={!ctx.aiAvailable || Boolean(cooldownLeft)}
            />
          ))}
          {cooldownLeft > 0 && <p className="small muted">Refinements are available again in {cooldownLeft} second{cooldownLeft === 1 ? '' : 's'}.</p>}
        </section>
      )}

      {/* ---- Saved ideas (the existing saved-idea system) ---- */}
      <section className="card" aria-labelledby="ia-saved-h">
        <div className="card__head">
          <h3 id="ia-saved-h">Saved ideas</h3>
        </div>
        {saved.length ? (
          <ul className="mini-list">
            {saved.map((s) => (
              <li key={s.id}>
                <div>
                  <strong>{s.title}</strong>
                  <small>
                    {s.aiGenerated ? 'AI-generated · ' : ''}
                    {formatDateTime(s.updatedAt)}
                  </small>
                </div>
                <span className="mini-list__right demo-order-actions">
                  <Button size="sm" variant="ghost" onClick={() => openSaved(s)}>
                    Open
                  </Button>
                  <Button size="sm" variant="danger-ghost" icon="trash" aria-label={`Delete ${s.title}`} onClick={() => setDeleting(s)} />
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted small">No saved ideas for this hackathon yet.</p>
        )}
        <p className="small muted">
          To build one, open <strong>Submit project</strong> on your{' '}
          <Link className="link" to="/dashboard" onClick={onNavigate}>
            dashboard
          </Link>{' '}
          and choose “Import from a saved idea”.
        </p>
      </section>

      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={confirmDelete}
        title="Delete this idea?"
        confirmLabel="Delete idea"
        message={deleting && <p>“{deleting.title}” will be removed from your saved ideas. This can’t be undone.</p>}
      />
    </div>
  )
}
