import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import Icon from './Icon'
import { Button, Input, Segmented, Select, Textarea } from './ui'
import { useAuth } from '../context/AuthContext'
import { useData } from '../context/DataContext'
import { CopyCode } from './BookingCard'
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

// Hackathon team limits (events without settings behave as teams of 1–4).
export const teamLimits = (event) => ({ min: event.teamMin ?? 1, max: event.teamMax ?? 4 })
const cleanCode = (v) => v.toUpperCase().replace(/[^A-Z0-9]/g, '')

// Hackathons: take part solo, create a team (gets a code) or join one by code.
function Participation({ event, value, onChange, error }) {
  const { min, max } = teamLimits(event)
  const soloOk = min <= 1
  const teamOk = max >= 2
  const [lookup, setLookup] = useState({ busy: false, team: null, error: '' })
  const set = (patch) => onChange({ ...value, ...patch })

  async function check() {
    const code = cleanCode(value.teamCode)
    if (code.length < 4) return setLookup({ busy: false, team: null, error: 'Enter the team code.' })
    setLookup({ busy: true, team: null, error: '' })
    try {
      setLookup({ busy: false, team: await api.teamLookup(event.id, code), error: '' })
    } catch (e) {
      setLookup({ busy: false, team: null, error: e.message })
    }
  }

  const limits = min === max ? `Teams of exactly ${min}.` : `Teams of ${min}–${max} members.`
  return (
    <div className={cx('field participation', error && 'has-error')}>
      <span className="field__label" id="participation-label">
        How are you taking part?<span aria-hidden="true" className="field__req"> *</span>
      </span>
      <Segmented
        label="How are you taking part?"
        size="block"
        value={value.mode}
        onChange={(mode) => {
          set({ mode })
          setLookup({ busy: false, team: null, error: '' })
        }}
        options={[
          { value: 'solo', label: 'Solo', icon: 'user', disabled: !soloOk, title: soloOk ? undefined : `Teams of at least ${min} only` },
          { value: 'team_create', label: 'Create team', icon: 'plus', disabled: !teamOk, title: teamOk ? undefined : 'This hackathon is solo only' },
          { value: 'team_join', label: 'Join team', icon: 'users', disabled: !teamOk, title: teamOk ? undefined : 'This hackathon is solo only' },
        ]}
      />
      <p className="field__hint">
        {!teamOk
          ? 'This hackathon is solo only.'
          : !soloOk
            ? `Solo participation is off: ${limits.toLowerCase()} Create a team or join one with a code.`
            : `${limits} You can also take part solo.`}
        {teamOk && (
          <>
            {' '}
            <Link className="link" to={`/team-matcher?h=${encodeURIComponent(event.id)}`}>
              Need teammates? Find them with Team Matcher
            </Link>
          </>
        )}
      </p>

      {value.mode === 'team_create' && (
        <Input
          label="Team name"
          required
          maxLength={60}
          value={value.teamName}
          onChange={(e) => set({ teamName: e.target.value })}
          placeholder="e.g. Byte Me"
          hint="You’ll get a unique team code. Share it so teammates can join (each member applies with their own form)."
        />
      )}

      {value.mode === 'team_join' && (
        <>
          <div className="participation__code">
            <Input
              label="Team code"
              required
              maxLength={20}
              value={value.teamCode}
              onChange={(e) => {
                set({ teamCode: e.target.value.toUpperCase() })
                if (lookup.team || lookup.error) setLookup({ busy: false, team: null, error: '' })
              }}
              placeholder="e.g. K7Q2MX"
              autoComplete="off"
              spellCheck={false}
            />
            <Button type="button" variant="secondary" onClick={check} loading={lookup.busy}>
              Check code
            </Button>
          </div>
          {lookup.team && (
            <p className="participation__found">
              <Icon name="checkCircle" size={15} /> <strong>{lookup.team.name}</strong>
              {lookup.team.leaderName ? ` · led by ${lookup.team.leaderName}` : ''} · {lookup.team.size} of {lookup.team.max} members
              {lookup.team.size >= lookup.team.max ? ' (full)' : ''}
            </p>
          )}
          {lookup.error && (
            <p className="field__error" role="alert">
              <Icon name="alert" size={14} /> {lookup.error}
            </p>
          )}
        </>
      )}

      {error && (
        <p className="field__error" role="alert">
          <Icon name="alert" size={14} /> {error}
        </p>
      )}
    </div>
  )
}

const cleanUtr = (v) => v.replace(/\s/g, '')
const rupees = (n) => `₹${Number(n).toLocaleString('en-IN')}`

// Paid events: where to pay (host's UPI QR, ID and number) + the applicant's UTR.
function FeePayment({ payment, value, onChange, error }) {
  const set = (patch) => onChange({ ...value, ...patch })
  return (
    <div className={cx('field participation fee-pay', error && 'has-error')}>
      <span className="field__label">
        Application fee · {rupees(payment.fee)}
        <span aria-hidden="true" className="field__req"> *</span>
      </span>
      <div className="fee-pay__grid">
        {payment.qrUrl && (
          <a href={payment.qrUrl} target="_blank" rel="noopener noreferrer" className="fee-pay__qr" title="Open the QR code full size">
            <img src={payment.qrUrl} alt={`UPI QR code to pay ${rupees(payment.fee)}`} />
          </a>
        )}
        <dl className="fee-pay__details">
          <div>
            <dt>Amount</dt>
            <dd>{rupees(payment.fee)}</dd>
          </div>
          <div>
            <dt>UPI ID</dt>
            <dd>
              <CopyCode value={payment.upiId} label="UPI ID" />
            </dd>
          </div>
          <div>
            <dt>UPI number</dt>
            <dd>
              <CopyCode value={payment.upiNumber} label="UPI number" />
            </dd>
          </div>
        </dl>
      </div>
      <p className="field__hint">
        Scan the QR or pay {rupees(payment.fee)} to the UPI ID / number with any UPI app, then enter the 12-digit UPI transaction ID (UTR) from
        your payment receipt. The organizer checks it before approving your application.
      </p>
      <Input
        label="UPI transaction ID (UTR)"
        required
        inputMode="numeric"
        maxLength={16}
        placeholder="e.g. 412345678901"
        value={value.ref}
        onChange={(e) => set({ ref: e.target.value.replace(/[^\d\s]/g, '') })}
        autoComplete="off"
      />
      <FileQuestion
        q={{ id: 'payment_proof', label: 'Payment screenshot', required: false, help: 'Optional. A screenshot of the successful payment.' }}
        value={value.proof}
        onChange={(proof) => set({ proof })}
      />
      {error && (
        <p className="field__error" role="alert">
          <Icon name="alert" size={14} /> {error}
        </p>
      )}
    </div>
  )
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
  const isHack = event.category === 'hackathon'
  const [part, setPart] = useState(() => ({ mode: teamLimits(event).min > 1 ? 'team_create' : 'solo', teamName: '', teamCode: '' }))
  const [partError, setPartError] = useState('')
  const [payment, setPayment] = useState(null) // where to pay, for paid events
  const [pay, setPay] = useState({ ref: '', proof: null })
  const [payError, setPayError] = useState('')

  useEffect(() => {
    let live = true
    api
      .eventApplication(event.id)
      .then(({ form: f, payment: p }) => {
        if (!live) return
        setForm(f)
        setPayment(p || null)
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
    let partProblem = ''
    if (isHack) {
      if (part.mode === 'team_create' && part.teamName.trim().length < 2) partProblem = 'Give your team a name (2–60 characters).'
      if (part.mode === 'team_join' && cleanCode(part.teamCode).length < 4) partProblem = 'Enter the team code your team leader shared.'
    }
    setPartError(partProblem)
    const payProblem = payment && !/^\d{12}$/.test(cleanUtr(pay.ref)) ? 'Enter the 12-digit UPI transaction ID (UTR) from your payment.' : ''
    setPayError(payProblem)
    if (Object.keys(missing).length || partProblem || payProblem) {
      setErrors(missing)
      setFormError(Object.keys(missing).length ? 'Please answer the required questions.' : partProblem || payProblem)
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
      const extra = {
        ...(isHack
          ? {
              participation: part.mode,
              teamName: part.mode === 'team_create' ? part.teamName.trim() : null,
              teamCode: part.mode === 'team_join' ? cleanCode(part.teamCode) : null,
            }
          : {}),
        ...(payment ? { paymentRef: cleanUtr(pay.ref), paymentProof: pay.proof || null } : {}),
      }
      const booking = await bookEvent(event.id, 1, payload, extra)
      onSubmitted(booking)
    } catch (x) {
      setBusy(false)
      if (x.fields) setErrors(x.fields)
      if (String(x.code).startsWith('team/')) setPartError(x.message)
      if (String(x.code).startsWith('payment/')) setPayError(x.message)
      setFormError(x.message)
    }
  }

  return (
    <div className="apply">
      <div className="apply__head">
        <button type="button" className="link apply__back" onClick={onBack} disabled={busy}>
          <Icon name="arrowLeft" size={16} /> Back to event
        </button>
        <p className="eyebrow">
          Individual application · 1 seat{event.applicationFee > 0 ? ` · fee ${rupees(event.applicationFee)}` : ''}
        </p>
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
          {isHack && (
            <Participation
              event={event}
              value={part}
              onChange={(v) => {
                setPart(v)
                setPartError('')
              }}
              error={partError}
            />
          )}
          {form.questions.map((q) =>
            q.type === 'file' ? (
              <FileQuestion key={q.id} q={q} value={answers[q.id]} error={errors[q.id]} onChange={set(q.id)} />
            ) : (
              <Question key={q.id} q={q} value={answers[q.id]} error={errors[q.id]} onChange={set(q.id)} />
            ),
          )}
          {!form.questions.length && <p className="muted">No questions for this event. Just send your request.</p>}
          {payment && (
            <FeePayment
              payment={payment}
              value={pay}
              onChange={(v) => {
                setPay(v)
                setPayError('')
              }}
              error={payError}
            />
          )}
          <div className="form-actions">
            <span className="muted small apply__req">{required ? `* ${required} required` : ''}</span>
            <Button type="button" variant="ghost" onClick={onBack} disabled={busy}>
              Back
            </Button>
            <Button type="submit" icon="ticket" loading={busy}>
              Request my seat
            </Button>
          </div>
        </form>
      )}
    </div>
  )
}
