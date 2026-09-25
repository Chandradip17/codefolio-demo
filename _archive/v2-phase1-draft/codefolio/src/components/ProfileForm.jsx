import { useEffect, useRef, useState } from 'react'
import Icon from './Icon'
import { Avatar, Button, Field, Input, Spinner, Textarea } from './ui'
import { useAuth } from '../context/AuthContext'
import { friendlyError, supabase } from '../lib/supabase'
import {
  GITHUB_RE,
  LIMITS,
  LINKEDIN_RE,
  PORTFOLIO_RE,
  constraintField,
  normalizeGithub,
  normalizeLinkedin,
  normalizeUrl,
  usernameProblem,
} from '../lib/profileRules'
import { cx } from '../utils/format'

const SKILL_SUGGESTIONS = [
  'JavaScript', 'TypeScript', 'React', 'Node.js', 'Python', 'Go', 'Rust', 'Java', 'Kotlin', 'Swift', 'Flutter', 'Dart',
  'Android', 'iOS', 'Next.js', 'Vue', 'Svelte', 'PostgreSQL', 'MongoDB', 'Firebase', 'Supabase', 'GCP', 'AWS', 'Azure',
  'Docker', 'Kubernetes', 'Machine Learning', 'TensorFlow', 'PyTorch', 'LLMs', 'UI/UX', 'Figma', 'DevOps', 'Web3',
]

// ---------- avatar ----------
async function toSquareJpeg(file, size = 512) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Use a JPG, PNG or WebP image.')
  if (file.size > 8 * 1024 * 1024) throw new Error('That image is over 8 MB. Choose a smaller one.')
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise((res, rej) => {
      const i = new Image()
      i.onload = () => res(i)
      i.onerror = () => rej(new Error("Couldn't read that image."))
      i.src = url
    })
    const side = Math.min(img.naturalWidth, img.naturalHeight)
    const c = document.createElement('canvas')
    c.width = c.height = Math.min(size, side)
    c.getContext('2d').drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, c.width, c.height)
    const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.86))
    if (!blob) throw new Error("Couldn't process that image.")
    return blob
  } finally {
    URL.revokeObjectURL(url)
  }
}

function AvatarPicker({ userId, value, name, onChange }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const input = useRef(null)

  async function pick(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBusy(true)
    setError('')
    try {
      const blob = await toSquareJpeg(file)
      const path = `${userId}/${Date.now()}.jpg`
      const { error: upErr } = await supabase.storage.from('avatars').upload(path, blob, { contentType: 'image/jpeg', cacheControl: '31536000' })
      if (upErr) throw new Error(friendlyError(upErr))
      const { data } = supabase.storage.from('avatars').getPublicUrl(path)
      onChange(data.publicUrl)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="avatar-picker">
      <Avatar src={value} name={name} size={72} />
      <div>
        <div className="avatar-picker__actions">
          <Button size="sm" variant="secondary" icon="upload" loading={busy} onClick={() => input.current?.click()}>
            {value ? 'Change photo' : 'Upload photo'}
          </Button>
          {value && !busy && (
            <Button size="sm" variant="ghost" onClick={() => onChange('')}>
              Remove
            </Button>
          )}
        </div>
        <p className="field__hint">JPG, PNG or WebP. Cropped to a square.</p>
        {error && (
          <p className="field__error" role="alert">
            <Icon name="alert" size={13} /> {error}
          </p>
        )}
        <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={pick} />
      </div>
    </div>
  )
}

// ---------- skills ----------
function SkillsInput({ value, onChange, error }) {
  const [draft, setDraft] = useState('')
  const id = 'skills-input'
  const add = (raw) => {
    const s = raw.trim().replace(/\s+/g, ' ').slice(0, LIMITS.skill)
    if (!s || value.some((v) => v.toLowerCase() === s.toLowerCase()) || value.length >= LIMITS.skills) return
    onChange([...value, s])
    setDraft('')
  }
  return (
    <Field
      label="Skills"
      id={id}
      error={error}
      hint={`Press Enter or comma to add. ${value.length}/${LIMITS.skills}`}
    >
      <div className="chips-input" onClick={() => document.getElementById(id)?.focus()}>
        {value.map((s) => (
          <span key={s} className="chip">
            {s}
            <button type="button" aria-label={`Remove ${s}`} onClick={() => onChange(value.filter((v) => v !== s))}>
              <Icon name="x" size={12} />
            </button>
          </span>
        ))}
        <input
          id={id}
          list="skill-suggestions"
          value={draft}
          placeholder={value.length ? '' : 'e.g. React, Go, Figma'}
          disabled={value.length >= LIMITS.skills}
          onChange={(e) => (e.target.value.endsWith(',') ? add(e.target.value.slice(0, -1)) : setDraft(e.target.value))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              add(draft)
            } else if (e.key === 'Backspace' && !draft && value.length) {
              onChange(value.slice(0, -1))
            }
          }}
          onBlur={() => draft && add(draft)}
          aria-describedby={`${id}-hint`}
        />
        <datalist id="skill-suggestions">
          {SKILL_SUGGESTIONS.filter((s) => !value.includes(s)).map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      </div>
    </Field>
  )
}

// ---------- username availability ----------
function useUsernameCheck(username, original) {
  const [state, setState] = useState({ status: 'idle' })
  useEffect(() => {
    const problem = usernameProblem(username)
    if (!username) return setState({ status: 'idle' })
    if (problem) return setState({ status: 'invalid', message: problem })
    if (username === original) return setState({ status: 'ok' })
    setState({ status: 'checking' })
    let alive = true
    const t = setTimeout(async () => {
      const { data, error } = await supabase.rpc('username_available', { p_username: username })
      if (!alive) return
      if (error) setState({ status: 'error', message: friendlyError(error) })
      else setState(data ? { status: 'ok' } : { status: 'taken', message: 'That username is taken.' })
    }, 350)
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [username, original])
  return state
}

// ---------- form ----------
const fromProfile = (p) => ({
  full_name: p?.full_name || '',
  username: p?.username || '',
  avatar_url: p?.avatar_url || '',
  college: p?.college || '',
  company: p?.company || '',
  bio: p?.bio || '',
  skills: p?.skills || [],
  github_url: p?.github_url || '',
  linkedin_url: p?.linkedin_url || '',
  portfolio_url: p?.portfolio_url || '',
})

export default function ProfileForm({ mode = 'edit', onSaved, submitLabel }) {
  const { user, profile, refreshProfile } = useAuth()
  const [form, setForm] = useState(() => fromProfile(profile))
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const check = useUsernameCheck(form.username, profile?.username || null)

  const set = (k, v) => {
    setForm((f) => ({ ...f, [k]: v }))
    setErrors((e) => ({ ...e, [k]: undefined }))
    setDirty(true)
  }
  const bind = (k) => ({ value: form[k], onChange: (e) => set(k, e.target.value) })

  // Warn before losing edits (refresh / close tab).
  useEffect(() => {
    if (!dirty || saving) return
    const h = (e) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [dirty, saving])

  function validate(f) {
    const e = {}
    const name = f.full_name.trim()
    if (name.length < 2) e.full_name = 'Enter your full name (at least 2 characters).'
    else if (name.length > LIMITS.fullName) e.full_name = `At most ${LIMITS.fullName} characters.`
    const up = usernameProblem(f.username)
    if (up) e.username = up
    else if (check.status === 'taken') e.username = check.message
    if (f.github_url && !GITHUB_RE.test(f.github_url)) e.github_url = 'Use your GitHub profile, e.g. https://github.com/yourname'
    if (f.linkedin_url && !LINKEDIN_RE.test(f.linkedin_url)) e.linkedin_url = 'Use a LinkedIn profile URL, e.g. https://www.linkedin.com/in/yourname'
    if (f.portfolio_url && !PORTFOLIO_RE.test(f.portfolio_url)) e.portfolio_url = 'Enter a full website address.'
    return e
  }

  async function submit(ev) {
    ev.preventDefault()
    if (saving) return
    const f = {
      ...form,
      full_name: form.full_name.trim().replace(/\s+/g, ' '),
      username: form.username.trim().toLowerCase(),
      github_url: normalizeGithub(form.github_url),
      linkedin_url: normalizeLinkedin(form.linkedin_url),
      portfolio_url: normalizeUrl(form.portfolio_url),
    }
    setForm(f)
    const e = validate(f)
    setErrors(e)
    setFormError('')
    if (Object.keys(e).length) {
      setTimeout(() => document.querySelector('[aria-invalid="true"]')?.focus(), 0)
      return
    }
    setSaving(true)
    const patch = {
      full_name: f.full_name,
      username: f.username,
      avatar_url: f.avatar_url || null,
      college: f.college.trim() || null,
      company: f.company.trim() || null,
      bio: f.bio.trim() || null,
      skills: f.skills,
      github_url: f.github_url || null,
      linkedin_url: f.linkedin_url || null,
      portfolio_url: f.portfolio_url || null,
      ...(mode === 'onboarding' ? { onboarding_completed: true } : {}),
    }
    const { error } = await supabase.from('profiles').update(patch).eq('id', user.id).select('id').single()
    if (error) {
      setSaving(false)
      if (error.code === '23505') {
        setErrors({ username: 'That username was just taken. Try another.' })
        return
      }
      const field = error.code === '23514' ? constraintField(error.message) : null
      if (field) setErrors({ [field]: 'This value isn’t allowed. Check the format.' })
      else setFormError(friendlyError(error))
      return
    }
    await refreshProfile()
    setSaving(false)
    setDirty(false)
    onSaved?.()
  }

  const usernameSuffix =
    check.status === 'checking' ? (
      <Spinner size={14} label="Checking username" />
    ) : check.status === 'ok' && form.username ? (
      <span className="ok-mark" aria-label="Available">
        <Icon name="check" size={15} />
      </span>
    ) : null

  return (
    <form className="profile-form" onSubmit={submit} noValidate>
      {formError && (
        <p className="alert alert--error" role="alert">
          <Icon name="alert" size={16} /> {formError}
        </p>
      )}

      <section className="form-section">
        <h2 className="form-section__title">Identity</h2>
        <AvatarPicker userId={user.id} value={form.avatar_url} name={form.full_name} onChange={(v) => set('avatar_url', v)} />
        <div className="grid-2">
          <Input label="Full name" required autoComplete="name" maxLength={LIMITS.fullName} error={errors.full_name} {...bind('full_name')} />
          <Input
            label="Username"
            required
            prefix="@"
            suffix={usernameSuffix}
            autoComplete="username"
            maxLength={20}
            spellCheck={false}
            value={form.username}
            onChange={(e) => set('username', e.target.value.toLowerCase().replace(/\s/g, ''))}
            error={errors.username || (['invalid', 'taken', 'error'].includes(check.status) ? check.message : undefined)}
            hint={`codefolio profile: /profile/${form.username || 'username'}`}
          />
        </div>
      </section>

      <section className="form-section">
        <h2 className="form-section__title">Background</h2>
        <div className="grid-2">
          <Input label="College / university" maxLength={LIMITS.college} autoComplete="organization" {...bind('college')} />
          <Input label="Company / organization" maxLength={LIMITS.company} {...bind('company')} />
        </div>
        <Textarea label="Bio" rows={4} maxLength={LIMITS.bio} placeholder="What do you build? What are you learning?" error={errors.bio} {...bind('bio')} />
        <SkillsInput value={form.skills} onChange={(v) => set('skills', v)} error={errors.skills} />
      </section>

      <section className="form-section">
        <h2 className="form-section__title">Links</h2>
        <Input label="GitHub" inputMode="url" placeholder="github.com/yourname" error={errors.github_url} {...bind('github_url')} onBlur={() => form.github_url && set('github_url', normalizeGithub(form.github_url))} />
        <Input label="LinkedIn" inputMode="url" placeholder="linkedin.com/in/yourname" error={errors.linkedin_url} {...bind('linkedin_url')} onBlur={() => form.linkedin_url && set('linkedin_url', normalizeLinkedin(form.linkedin_url))} />
        <Input label="Portfolio" inputMode="url" placeholder="yourname.dev" error={errors.portfolio_url} {...bind('portfolio_url')} onBlur={() => form.portfolio_url && set('portfolio_url', normalizeUrl(form.portfolio_url))} />
      </section>

      <div className={cx('form-actions', mode === 'onboarding' && 'form-actions--sticky')}>
        <Button type="submit" loading={saving} disabled={check.status === 'checking'}>
          {submitLabel || (mode === 'onboarding' ? 'Finish setup' : 'Save changes')}
        </Button>
      </div>
    </form>
  )
}
