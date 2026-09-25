import { useEffect, useRef, useState } from 'react'
import Icon from './Icon'
import { Button, Input, Select, Textarea } from './ui'
import { useAuth } from '../context/AuthContext'
import { uploadAvatar, usernameAvailable } from '../services/api'
import { CITIES } from '../data/chapters'
import { cx } from '../utils/format'

// Mirrors the profiles table constraints (server/supabase/migrations/*_phase1_identity.sql).
const RESERVED = ['admin', 'root', 'support', 'codefolio', 'api', 'me', 'settings', 'host', 'null', 'undefined']
const USERNAME_RE = /^[a-z0-9_]{3,20}$/
const GITHUB_RE = /^https:\/\/(www\.)?github\.com\/[A-Za-z0-9_.-]+\/?$/i
const LINKEDIN_RE = /^https:\/\/([a-z]{2,3}\.)?linkedin\.com\/(in|company)\/[^\s/]+\/?$/i
const PORTFOLIO_RE = /^https?:\/\/[^\s]+\.[^\s]+$/i
const MAX_SKILLS = 30

function usernameProblem(u) {
  if (!u) return 'Choose a username.'
  if (u.length < 3) return 'At least 3 characters.'
  if (u.length > 20) return 'At most 20 characters.'
  if (!USERNAME_RE.test(u)) return 'Use lowercase letters, numbers and underscores only.'
  if (RESERVED.includes(u)) return 'That username is reserved.'
  return null
}
const normGithub = (v) => {
  const s = v.trim()
  if (!s) return ''
  const h = s.replace(/^https?:\/\//i, '').replace(/^(www\.)?github\.com\//i, '').replace(/\/+$/, '')
  return /^[A-Za-z0-9_.-]+$/.test(h) ? `https://github.com/${h}` : s
}
const normLinkedin = (v) => {
  const s = v.trim()
  if (!s) return ''
  if (/^[A-Za-z0-9_-]+$/.test(s)) return `https://www.linkedin.com/in/${s}`
  return (/^https?:\/\//i.test(s) ? s : `https://${s}`).replace(/^http:\/\//i, 'https://').replace(/\/+$/, '')
}
const normUrl = (v) => (v.trim() ? (/^https?:\/\//i.test(v.trim()) ? v.trim() : `https://${v.trim()}`) : '')

async function squareJpeg(file) {
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
    c.width = c.height = Math.min(512, side)
    c.getContext('2d').drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, c.width, c.height)
    return await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.86))
  } finally {
    URL.revokeObjectURL(url)
  }
}

export function AvatarImage({ src, name, className }) {
  return (
    <div className={cx('avatar', className)} aria-hidden="true">
      {src ? <img src={src} alt="" referrerPolicy="no-referrer" /> : (name || '?').slice(0, 1)}
    </div>
  )
}

function SkillsInput({ value, onChange }) {
  const [draft, setDraft] = useState('')
  const add = (raw) => {
    const s = raw.trim().replace(/\s+/g, ' ').slice(0, 32)
    if (!s || value.some((v) => v.toLowerCase() === s.toLowerCase()) || value.length >= MAX_SKILLS) return setDraft('')
    onChange([...value, s])
    setDraft('')
  }
  return (
    <div className="field">
      <label className="field__label" htmlFor="skills-input">
        Skills
      </label>
      <div className="tag-input" onClick={() => document.getElementById('skills-input')?.focus()}>
        {value.map((s) => (
          <span key={s} className="tag tag-input__tag">
            {s}
            <button type="button" aria-label={`Remove ${s}`} onClick={() => onChange(value.filter((v) => v !== s))}>
              <Icon name="x" size={12} />
            </button>
          </span>
        ))}
        <input
          id="skills-input"
          value={draft}
          placeholder={value.length ? '' : 'e.g. React, Go, Figma'}
          disabled={value.length >= MAX_SKILLS}
          onChange={(e) => (e.target.value.endsWith(',') ? add(e.target.value.slice(0, -1)) : setDraft(e.target.value))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              add(draft)
            } else if (e.key === 'Backspace' && !draft && value.length) onChange(value.slice(0, -1))
          }}
          onBlur={() => draft && add(draft)}
          aria-describedby="skills-hint"
        />
      </div>
      <p className="field__hint" id="skills-hint">
        Press Enter or comma to add · {value.length}/{MAX_SKILLS}
      </p>
    </div>
  )
}

// Onboarding + profile editing share this form.
export default function ProfileForm({ mode = 'edit', onSaved }) {
  const { user, updateProfile } = useAuth()
  const [form, setForm] = useState(() => ({
    name: user.name || '',
    username: user.username || '',
    avatarUrl: user.avatarUrl || '',
    college: user.college || '',
    company: user.company || '',
    city: user.city || '',
    chapter: user.chapter || '',
    bio: user.bio || '',
    skills: user.skills || [],
    githubUrl: user.githubUrl || '',
    linkedinUrl: user.linkedinUrl || '',
    portfolioUrl: user.portfolioUrl || '',
  }))
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState('')
  const [busy, setBusy] = useState(false)
  const [upload, setUpload] = useState({ busy: false, error: '' })
  const [check, setCheck] = useState({ status: 'idle' })
  const fileRef = useRef(null)

  const set = (k, v) => {
    setForm((f) => ({ ...f, [k]: v }))
    setErrors((e) => ({ ...e, [k]: undefined }))
  }
  const bind = (k) => ({ value: form[k], onChange: (e) => set(k, e.target.value) })

  // Live username availability (debounced).
  useEffect(() => {
    const u = form.username
    const problem = usernameProblem(u)
    if (!u) return setCheck({ status: 'idle' })
    if (problem) return setCheck({ status: 'invalid', message: problem })
    if (u === user.username) return setCheck({ status: 'ok' })
    setCheck({ status: 'checking' })
    let alive = true
    const t = setTimeout(async () => {
      try {
        const free = await usernameAvailable(u)
        if (alive) setCheck(free ? { status: 'ok' } : { status: 'taken', message: 'That username is taken.' })
      } catch (e) {
        if (alive) setCheck({ status: 'error', message: e.message })
      }
    }, 350)
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [form.username, user.username])

  async function pickPhoto(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setUpload({ busy: true, error: '' })
    try {
      set('avatarUrl', await uploadAvatar(await squareJpeg(file)))
      setUpload({ busy: false, error: '' })
    } catch (err) {
      setUpload({ busy: false, error: err.message })
    }
  }

  async function submit(ev) {
    ev.preventDefault()
    if (busy) return
    const f = {
      ...form,
      name: form.name.trim().replace(/\s+/g, ' '),
      username: form.username.trim().toLowerCase(),
      githubUrl: normGithub(form.githubUrl),
      linkedinUrl: normLinkedin(form.linkedinUrl),
      portfolioUrl: normUrl(form.portfolioUrl),
    }
    setForm(f)
    const e = {}
    if (f.name.length < 2 || f.name.length > 80) e.name = 'Enter your full name (2–80 characters).'
    const up = usernameProblem(f.username)
    if (up) e.username = up
    else if (check.status === 'taken') e.username = check.message
    if (f.githubUrl && !GITHUB_RE.test(f.githubUrl)) e.githubUrl = 'Use your GitHub profile, e.g. github.com/yourname'
    if (f.linkedinUrl && !LINKEDIN_RE.test(f.linkedinUrl)) e.linkedinUrl = 'Use a LinkedIn profile, e.g. linkedin.com/in/yourname'
    if (f.portfolioUrl && !PORTFOLIO_RE.test(f.portfolioUrl)) e.portfolioUrl = 'Enter a full website address.'
    if (f.bio.length > 600) e.bio = 'Keep your bio under 600 characters.'
    setErrors(e)
    setFormError('')
    if (Object.keys(e).length) {
      setTimeout(() => document.querySelector('[aria-invalid="true"]')?.focus(), 0)
      return
    }
    setBusy(true)
    try {
      await updateProfile({ ...f, ...(mode === 'onboarding' ? { onboarded: true } : {}) })
      onSaved?.()
    } catch (err) {
      if (err.fields) setErrors((x) => ({ ...x, ...err.fields }))
      setFormError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const usernameMsg = ['invalid', 'taken', 'error'].includes(check.status) ? check.message : undefined

  return (
    <form className="card form-stack profile__form" onSubmit={submit} noValidate>
      {formError && (
        <p className="form-error" role="alert">
          <Icon name="alert" size={16} /> {formError}
        </p>
      )}

      <div className="avatar-row">
        <AvatarImage src={form.avatarUrl} name={form.name} className="avatar--xl" />
        <div className="avatar-row__controls">
          <div className="avatar-row__btns">
            <Button type="button" size="sm" variant="secondary" icon="image" loading={upload.busy} onClick={() => fileRef.current?.click()}>
              {form.avatarUrl ? 'Change photo' : 'Upload photo'}
            </Button>
            {form.avatarUrl && !upload.busy && (
              <Button type="button" size="sm" variant="ghost" onClick={() => set('avatarUrl', '')}>
                Remove
              </Button>
            )}
          </div>
          <p className="field__hint">JPG, PNG or WebP · cropped to a square · stored in Supabase Storage</p>
          {upload.error && (
            <p className="field__error" role="alert">
              <Icon name="alert" size={14} /> {upload.error}
            </p>
          )}
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={pickPhoto} />
        </div>
      </div>

      <div className="grid-2">
        <Input label="Full Name" autoComplete="name" maxLength={80} error={errors.name} required {...bind('name')} />
        <Input
          label="Username"
          icon="user"
          autoComplete="username"
          maxLength={20}
          spellCheck={false}
          value={form.username}
          onChange={(e) => set('username', e.target.value.toLowerCase().replace(/\s/g, ''))}
          error={errors.username || usernameMsg}
          hint={
            check.status === 'checking'
              ? 'Checking availability…'
              : check.status === 'ok' && form.username
                ? `✓ Available · your profile: /profile/${form.username}`
                : 'Lowercase letters, numbers and underscores'
          }
          required
        />
      </div>

      <div className="grid-2">
        <Input label="College / University" maxLength={120} {...bind('college')} />
        <Input label="Company / Organization" maxLength={120} {...bind('company')} />
      </div>
      <div className="grid-2">
        <Select label="City" value={form.city} onChange={(e) => set('city', e.target.value)} options={[{ value: '', label: 'Not set' }, ...CITIES, 'Other']} />
        <Input label={user.role === 'organizer' ? 'Organization/Chapter' : 'Home chapter (optional)'} {...bind('chapter')} />
      </div>
      <Textarea label="Bio" rows={4} maxLength={600} placeholder="What do you build? What are you learning?" error={errors.bio} {...bind('bio')} />
      <SkillsInput value={form.skills} onChange={(v) => set('skills', v)} />

      <div className="grid-3">
        <Input label="GitHub" icon="github" placeholder="github.com/you" error={errors.githubUrl} {...bind('githubUrl')} onBlur={() => form.githubUrl && set('githubUrl', normGithub(form.githubUrl))} />
        <Input label="LinkedIn" icon="linkedin" placeholder="linkedin.com/in/you" error={errors.linkedinUrl} {...bind('linkedinUrl')} onBlur={() => form.linkedinUrl && set('linkedinUrl', normLinkedin(form.linkedinUrl))} />
        <Input label="Portfolio" icon="globe" placeholder="you.dev" error={errors.portfolioUrl} {...bind('portfolioUrl')} onBlur={() => form.portfolioUrl && set('portfolioUrl', normUrl(form.portfolioUrl))} />
      </div>

      <div className="form-actions">
        <Button type="submit" loading={busy} disabled={check.status === 'checking' || upload.busy}>
          {mode === 'onboarding' ? 'Finish setup' : 'Save profile'}
        </Button>
      </div>
    </form>
  )
}
