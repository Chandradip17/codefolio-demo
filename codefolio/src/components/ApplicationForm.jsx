import { useEffect, useMemo, useState } from 'react'
import Icon from './Icon'
import { Button, Input, Select, Textarea } from './ui'
import { useAuth } from '../context/AuthContext'
import { useData } from '../context/DataContext'
import * as api from '../services/api'
import { cx } from '../utils/format'

const MAX_FILE = 5 * 1024 * 1024
const FILE_ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp,.zip,.txt'

// Profile-backed questions start filled in (still editable).
function prefillValue(key, user) {
  switch (key) {
    case 'name':
      return user.name || ''
    case 'email':
      return user.email || ''
    case 'college_company':
      return user.college || user.company || ''
    case 'skills':
      return (user.skills || []).join(', ')
    case 'github':
      return user.githubUrl || ''
    case 'linkedin':
      return user.linkedinUrl || ''
    case 'portfolio':
      return user.portfolioUrl || ''
    default:
      return ''
  }
}

const readDataUrl = (file) =>
  new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result)
    r.onerror = () => reject(new Error('Could not read that file.'))
    r.readAsDataURL(file)
  })

const kb = (n) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)

function FileQuestion({ q, value, error, onChange }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const id = `q-${q.id}`

  async function pick(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setErr('')
    if (file.size > MAX_FILE) return setErr('Files must be under 5 MB.')
    setBusy(true)
    try {
      const dataUrl = await readDataUrl(file)
      onChange(await api.uploadApplicationFile(file.name, dataUrl))
    } catch (x) {
      setErr(x.message)
    } finally {
      setBusy(false)
    }
  }

  const shown = err || error
  return (
    <div className={cx('field', shown && 'has-error')}>
      <span className="field__label" id={`${id}-label`}>
        {q.label}
        {q.required && <span aria-hidden="true" className="field__req"> *</span>}
      </span>
      <div className="file-answer">
        {value ? (
          <span className="file-answer__name">
            <Icon name="checkCircle" size={16} /> {value.name} <small className="muted">· {kb(value.size)}</small>
          </span>
        ) : (
          <span className="muted small">PDF, image, ZIP or text · up to 5 MB</span>
        )}
        <label className={cx('btn btn--secondary btn--sm', busy && 'is-loading')}>
          {busy ? <span className="spinner" aria-hidden="true" /> : <Icon name={value ? 'refresh' : 'plus'} size={15} />}
          {value ? 'Replace' : 'Upload file'}
          <input type="file" accept={FILE_ACCEPT} onChange={pick} disabled={busy} className="sr-only" aria-labelledby={`${id}-label`} />
        </label>
        {value && !q.required && (
          <Button type="button" size="sm" variant="ghost" onClick={() => onChange(null)}>
            Remove
          </Button>
        )}
      </div>
      {shown ? (
        <p className="field__error" role="alert">
          <Icon name="alert" size={14} /> {shown}
        </p>
      ) : (
        q.help && <p className="field__hint">{q.help}</p>
      )}
    </div>
  )
}

function Question({ q, value, error, onChange }) {
  const common = { label: q.label, required: q.required, error, hint: q.help }
  switch (q.type) {
    case 'long_text':
      return <Textarea {...common} rows={4} maxLength={3000} value={value || ''} onChange={(e) => onChange(e.target.value)} />
    case 'url':
      return <Input {...common} type="url" inputMode="url" placeholder="https://" maxLength={500} value={value || ''} onChange={(e) => onChange(e.target.value)} />
    case 'number':
      return <Input {...common} type="number" inputMode="decimal" value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
    case 'single_choice':
      return (
        <Select
          {...common}
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          options={[{ value: '', label: 'Choose one…' }, ...q.options.map((o) => ({ value: o, label: o }))]}
        />
      )
    case 'multiple_choice': {
      const picked = Array.isArray(value) ? value : []
      return (
        <div className={cx('field', error && 'has-error')} role="group" aria-labelledby={`q-${q.id}-label`}>
          <span className="field__label" id={`q-${q.id}-label`}>
            {q.label}
            {q.required && <span aria-hidden="true" className="field__req"> *</span>}
          </span>
          <div className="chip-row">
            {q.options.map((o) => {
              const on = picked.includes(o)
              return (
                <button key={o} type="button" className="chip" aria-pressed={on} onClick={() => onChange(on ? picked.filter((x) => x !== o) : [...picked, o])}>
                  {on && <Icon name="check" size={14} />} {o}
                </button>
              )
            })}
          </div>
          {error ? (
            <p className="field__error" role="alert">
              <Icon name="alert" size={14} /> {error}
            </p>
          ) : (
            <p className="field__hint">{q.help || 'Pick all that apply.'}</p>
          )}
        </div>
      )
    }
    default:
      return <Input {...common} maxLength={300} value={value || ''} onChange={(e) => onChange(e.target.value)} />
  }
}

// The application step of the event modal: the host's questions, then a
// Pending request. Nothing is booked until the host approves it.
export default function ApplicationForm({ event, seats, onBack, onSubmitted }) {
  const { user } = useAuth()
  const { bookEvent } = useData()
  const [form, setForm] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [answers, setAnswers] = useState({})
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let live = true
    api
      .eventForm(event.id)
      .then((f) => {
        if (!live) return
        setForm(f)
        const init = {}
        for (const q of f.questions) if (q.prefill) init[q.id] = prefillValue(q.prefill, user)
        setAnswers(init)
      })
      .catch((e) => live && setLoadError(e.message))
    return () => {
      live = false
    }
  }, [event.id, user])

  const required = useMemo(() => form?.questions.filter((q) => q.required).length || 0, [form])

  const set = (id) => (v) => {
    setAnswers((a) => ({ ...a, [id]: v }))
    setErrors((e) => ({ ...e, [id]: undefined }))
  }

  async function submit(e) {
    e.preventDefault()
    setFormError('')
    const missing = {}
    for (const q of form.questions) {
      const v = answers[q.id]
      if (q.required && (v == null || v === '' || (Array.isArray(v) && !v.length))) missing[q.id] = 'This question is required.'
    }
    if (Object.keys(missing).length) {
      setErrors(missing)
      setFormError('Please answer the required questions.')
      return
    }
    setBusy(true)
    try {
      const payload = {}
      for (const q of form.questions) {
        const v = answers[q.id]
        if (v == null || v === '' || (Array.isArray(v) && !v.length)) continue
        payload[q.id] = typeof v === 'string' ? v.trim() : v
      }
      const booking = await bookEvent(event.id, seats, payload)
      onSubmitted(booking)
    } catch (x) {
      setBusy(false)
      if (x.fields) setErrors(x.fields)
      setFormError(x.message)
    }
  }

  return (
    <div className="apply">
      <div className="apply__head">
        <button type="button" className="link apply__back" onClick={onBack} disabled={busy}>
          <Icon name="arrowLeft" size={16} /> Back to event
        </button>
        <p className="eyebrow">Application · {seats} {seats === 1 ? 'seat' : 'seats'}</p>
        <h2 className="apply__title">{event.title}</h2>
        <p className="muted">
          The organizer reviews every application. Your seat is held only once they approve it, and then your check-in QR appears in your
          dashboard.
        </p>
      </div>

      {loadError ? (
        <p className="form-error" role="alert">
          <Icon name="alert" size={15} /> {loadError}
        </p>
      ) : !form ? (
        <div className="modal-loading">
          <span className="spinner spinner--lg" aria-hidden="true" /> Loading the application form…
        </div>
      ) : (
        <form className="form-stack apply__form" onSubmit={submit} noValidate>
          {formError && (
            <p className="form-error" role="alert">
              <Icon name="alert" size={15} /> {formError}
            </p>
          )}
          {form.questions.map((q) =>
            q.type === 'file' ? (
              <FileQuestion key={q.id} q={q} value={answers[q.id]} error={errors[q.id]} onChange={set(q.id)} />
            ) : (
              <Question key={q.id} q={q} value={answers[q.id]} error={errors[q.id]} onChange={set(q.id)} />
            ),
          )}
          {!form.questions.length && <p className="muted">No questions for this event. Just send your request.</p>}
          <div className="form-actions">
            <span className="muted small apply__req">{required ? `* ${required} required` : ''}</span>
            <Button type="button" variant="ghost" onClick={onBack} disabled={busy}>
              Back
            </Button>
            <Button type="submit" icon="ticket" loading={busy}>
              Request my seat{seats > 1 ? `s (${seats})` : ''}
            </Button>
          </div>
        </form>
      )}
    </div>
  )
}
