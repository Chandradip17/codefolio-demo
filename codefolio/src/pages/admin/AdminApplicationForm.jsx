import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import Icon from '../../components/Icon'
import { ConfirmDialog } from '../../components/Modal'
import { Button, EmptyState, ErrorState, Input, Select, Textarea } from '../../components/ui'
import { useData } from '../../context/DataContext'
import { useToast } from '../../context/ToastContext'
import * as api from '../../services/api'
import { cx, formatDate } from '../../utils/format'

const TYPES = [
  { value: 'text', label: 'Short text' },
  { value: 'long_text', label: 'Long text' },
  { value: 'url', label: 'Link (URL)' },
  { value: 'number', label: 'Number' },
  { value: 'single_choice', label: 'Single choice' },
  { value: 'multiple_choice', label: 'Multiple choice' },
  { value: 'file', label: 'File upload' },
]
const isChoice = (t) => t === 'single_choice' || t === 'multiple_choice'
const MAX_QUESTIONS = 30

// Stable ids: answers are stored per question id, so an id never changes once
// created (renaming the label keeps old answers attached).
function newId(label, taken) {
  const base = (label || 'question').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30) || 'question'
  let id = base
  for (let n = 2; taken.has(id); n++) id = `${base}_${n}`
  return id
}

// Editor state keeps options as one-per-line text so typing feels natural.
const toDraft = (qs) => qs.map((q) => ({ ...q, key: q.id, optionsText: (q.options || []).join('\n') }))
const fromDraft = (qs) =>
  qs.map(({ key, optionsText, ...q }) => {
    const out = { id: q.id, type: q.type, label: q.label.trim(), required: Boolean(q.required) }
    if (q.help?.trim()) out.help = q.help.trim()
    if (q.prefill) out.prefill = q.prefill
    if (isChoice(q.type))
      out.options = optionsText
        .split('\n')
        .map((o) => o.trim())
        .filter(Boolean)
    return out
  })

function problems(qs) {
  const out = {}
  qs.forEach((q) => {
    const e = {}
    if (q.label.trim().length < 2) e.label = 'Write the question (at least 2 characters).'
    if (isChoice(q.type)) {
      const n = new Set(q.optionsText.split('\n').map((o) => o.trim()).filter(Boolean)).size
      if (n < 2) e.options = 'Add at least 2 options, one per line.'
      if (n > 20) e.options = 'Keep it to 20 options or fewer.'
    }
    if (Object.keys(e).length) out[q.key] = e
  })
  return out
}

export default function AdminApplicationForm() {
  const { id } = useParams()
  const { myEvents, hostBookings, localStatus, loadLocal } = useData()
  const toast = useToast()
  const event = myEvents.find((e) => e.id === id)
  const [meta, setMeta] = useState(null) // { version, isDefault, defaults }
  const [qs, setQs] = useState([])
  const [saved, setSaved] = useState('[]')
  const [error, setError] = useState('')
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(false)
  const [askReset, setAskReset] = useState(false)

  useEffect(() => {
    let live = true
    api
      .adminEventForm(id)
      .then(({ form, defaults }) => {
        if (!live) return
        setMeta({ version: form.version, isDefault: form.isDefault, defaults })
        const d = toDraft(form.questions)
        setQs(d)
        setSaved(JSON.stringify(fromDraft(d)))
      })
      .catch((e) => live && setError(e.message))
    return () => {
      live = false
    }
  }, [id])

  const dirty = useMemo(() => JSON.stringify(fromDraft(qs)) !== saved, [qs, saved])
  const applications = hostBookings.filter((b) => b.eventId === id).length

  const patch = (key, p) => {
    setQs((list) => list.map((q) => (q.key === key ? { ...q, ...p } : q)))
    setErrors((e) => ({ ...e, [key]: undefined }))
  }
  const move = (i, d) =>
    setQs((list) => {
      const next = list.slice()
      ;[next[i], next[i + d]] = [next[i + d], next[i]]
      return next
    })
  const add = () =>
    setQs((list) => {
      const qid = newId('question', new Set(list.map((q) => q.id)))
      return [...list, { key: `${qid}:${Date.now()}`, id: qid, type: 'text', label: '', required: false, optionsText: '' }]
    })

  async function save() {
    const p = problems(qs)
    setErrors(p)
    if (Object.keys(p).length) {
      toast({ title: 'Check the highlighted questions', tone: 'error' })
      return
    }
    // Give brand-new questions an id based on their wording.
    const taken = new Set()
    const final = qs.map((q) => {
      let qid = q.id
      if (q.key !== q.id && /^question(_\d+)?$/.test(q.id)) qid = newId(q.label, new Set([...qs.map((x) => x.id), ...taken]))
      taken.add(qid)
      return { ...q, id: qid }
    })
    setBusy(true)
    try {
      const form = await api.saveEventForm(id, fromDraft(final))
      const d = toDraft(form.questions)
      setQs(d)
      setSaved(JSON.stringify(fromDraft(d)))
      setMeta((m) => ({ ...m, version: form.version, isDefault: false }))
      toast({ title: 'Application form saved', message: `Version ${form.version} · new applicants see it right away.` })
    } catch (e) {
      toast({ title: "Couldn't save the form", message: e.message, tone: 'error' })
    } finally {
      setBusy(false)
    }
  }

  function resetToDefault() {
    const def = event?.category === 'hackathon' ? meta.defaults.hackathon : meta.defaults.event
    setQs(toDraft(def))
    setErrors({})
    setAskReset(false)
  }

  if (error) return <ErrorState message={error} />
  if (localStatus.error && !event) return <ErrorState message={localStatus.error} onRetry={loadLocal} />
  if (!localStatus.loading && !event) {
    return (
      <EmptyState
        icon="calendar"
        title="Event not found"
        message="You can only edit application forms for events you created."
        action={
          <Button to="/admin/events" iconRight="arrowRight">
            Back to events
          </Button>
        }
      />
    )
  }

  return (
    <>
      <header className="dash-head">
        <div>
          <p className="eyebrow">Application form</p>
          <h1>{event?.title || 'Loading…'}</h1>
          <p className="muted">
            {event && `${formatDate(event.date, { weekday: true })} · `}
            {meta ? (meta.isDefault ? 'Using the default form' : `Version ${meta.version}`) : ''}
            {applications > 0 && ` · ${applications} ${applications === 1 ? 'application' : 'applications'} so far (their answers are kept)`}
          </p>
        </div>
        <Button variant="secondary" icon="users" to={`/admin/bookings?for=${encodeURIComponent(id)}`}>
          View applications
        </Button>
      </header>

      {!meta ? (
        <div className="skeleton" style={{ height: 320, borderRadius: 20 }} />
      ) : (
        <div className="event-form">
          <p className="small muted">
            <Icon name="info" size={14} /> Questions marked with a profile icon are prefilled from the applicant&apos;s Codefolio profile. Applicants
            can still edit them.
          </p>

          {qs.map((q, i) => {
            const e = errors[q.key] || {}
            return (
              <fieldset key={q.key} className={cx('card form-section qb', (e.label || e.options) && 'has-error')}>
                <legend className="qb__legend">
                  <span className="qb__num">{i + 1}</span>
                  <span className="truncate">{q.label || 'New question'}</span>
                  {q.prefill && <Icon name="user" size={15} aria-label="Prefilled from profile" />}
                </legend>
                <div className="qb__tools">
                  <Button size="sm" variant="ghost" icon="arrowUp" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move question ${i + 1} up`} />
                  <Button size="sm" variant="ghost" icon="arrowDown" disabled={i === qs.length - 1} onClick={() => move(i, 1)} aria-label={`Move question ${i + 1} down`} />
                  <Button
                    size="sm"
                    variant="danger-ghost"
                    icon="trash"
                    onClick={() => setQs((list) => list.filter((x) => x.key !== q.key))}
                    aria-label={`Delete question ${i + 1}`}
                  />
                </div>
                <div className="qb__row">
                  <Input label="Question" required value={q.label} maxLength={200} error={e.label} onChange={(ev) => patch(q.key, { label: ev.target.value })} />
                  <Select label="Answer type" value={q.type} options={TYPES} onChange={(ev) => patch(q.key, { type: ev.target.value })} />
                </div>
                {isChoice(q.type) && (
                  <Textarea
                    label="Options"
                    hint="One per line (2–20)."
                    rows={4}
                    value={q.optionsText}
                    error={e.options}
                    onChange={(ev) => patch(q.key, { optionsText: ev.target.value })}
                  />
                )}
                <Input label="Help text (optional)" value={q.help || ''} maxLength={300} onChange={(ev) => patch(q.key, { help: ev.target.value })} />
                <label className="check-row">
                  <input type="checkbox" checked={q.required} onChange={(ev) => patch(q.key, { required: ev.target.checked })} />
                  <span>Required</span>
                </label>
              </fieldset>
            )
          })}

          {!qs.length && <EmptyState icon="list" title="No questions" message="Applicants will only choose their seats. Add a question to learn more about them." />}

          <div className="form-actions form-actions--sticky">
            <Button variant="ghost" icon="refresh" onClick={() => setAskReset(true)} disabled={busy}>
              Reset to default
            </Button>
            <Button variant="secondary" icon="plus" onClick={add} disabled={qs.length >= MAX_QUESTIONS || busy}>
              Add question
            </Button>
            <Button icon="check" onClick={save} loading={busy} disabled={!dirty}>
              {dirty ? 'Save form' : 'Saved'}
            </Button>
          </div>
          <p className="small muted">
            <Link className="link" to="/admin/events">
              <Icon name="arrowLeft" size={14} /> Back to events
            </Link>
          </p>
        </div>
      )}

      <ConfirmDialog
        open={askReset}
        onClose={() => setAskReset(false)}
        onConfirm={resetToDefault}
        tone="info"
        title="Reset to the default form?"
        confirmLabel="Reset"
        cancelLabel="Cancel"
        message={<p>This replaces the questions in the editor with the default {event?.category === 'hackathon' ? 'hackathon' : 'event'} form. Nothing is saved until you click Save.</p>}
      />
    </>
  )
}
