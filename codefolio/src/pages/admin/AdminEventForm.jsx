import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import Icon from '../../components/Icon'
import { Button, EmptyState, Input, Segmented, Select, Textarea } from '../../components/ui'
import { useAuth } from '../../context/AuthContext'
import { useData } from '../../context/DataContext'
import { useToast } from '../../context/ToastContext'
import { CITIES } from '../../data/chapters'
import { PHOTOS, unsplash } from '../../data/images'
import { uploadImage } from '../../services/api'
import { cx, todayISO } from '../../utils/format'

const GALLERY = ['laptopsTeam', 'workshopRoom', 'conference', 'codeLaptop', 'highFive', 'speaker', 'codeDark', 'friends'].map((k) =>
  unsplash(PHOTOS[k], 800, 480),
)

const EMPTY = {
  title: '',
  category: 'gdg',
  mode: 'In-person',
  city: '',
  venue: '',
  date: '',
  time: '10:00',
  endTime: '',
  organizerChapter: '',
  capacity: '100',
  description: '',
  image: GALLERY[0],
  registrationDeadline: '',
  requirements: '',
  learn: '',
  tags: '',
}

const lines = (s) =>
  s
    .split('\n')
    .map((x) => x.trim())
    .filter(Boolean)

// Downscale in the browser before uploading to Supabase Storage (≤ ~200 KB).
function readImage(file) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) return reject(new Error('Please choose an image file.'))
    if (file.size > 8 * 1024 * 1024) return reject(new Error('Image must be under 8 MB.'))
    const img = new Image()
    img.onload = () => {
      const scale = Math.min(1, 900 / img.width)
      const c = document.createElement('canvas')
      c.width = Math.round(img.width * scale)
      c.height = Math.round(img.height * scale)
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height)
      resolve(c.toDataURL('image/jpeg', 0.78))
      URL.revokeObjectURL(img.src)
    }
    img.onerror = () => reject(new Error("Couldn't read that image."))
    img.src = URL.createObjectURL(file)
  })
}

export default function AdminEventForm() {
  const { id } = useParams()
  const isEdit = Boolean(id)
  const { user } = useAuth()
  const { myEvents: events, localStatus, createEvent, updateEvent } = useData()
  const toast = useToast()
  const navigate = useNavigate()
  const existing = useMemo(() => (isEdit ? events.find((e) => e.id === id) : null), [events, id, isEdit])

  const [form, setForm] = useState({ ...EMPTY, organizerChapter: user.chapter || '', city: CITIES.includes(user.city) ? user.city : '' })
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState('')
  const [busy, setBusy] = useState(false)
  const [loadedFor, setLoadedFor] = useState(null)
  const [uploading, setUploading] = useState(false)

  useEffect(() => {
    if (existing && loadedFor !== existing.id) {
      setForm({
        ...EMPTY,
        ...existing,
        capacity: String(existing.capacity),
        endTime: existing.endTime || '',
        registrationDeadline: existing.registrationDeadline || '',
        requirements: (existing.requirements || []).join('\n'),
        learn: (existing.learn || []).join('\n'),
        tags: (existing.tags || []).join(', '),
      })
      setLoadedFor(existing.id)
    }
  }, [existing, loadedFor])

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  if (isEdit && !existing) {
    if (localStatus.loading) return <div className="skeleton" style={{ height: 480, borderRadius: 20 }} />
    return (
      <EmptyState
        icon="calendar"
        title="Event not found"
        message="You can only edit Codefolio events that you created."
        action={
          <Button to="/admin/events" icon="arrowLeft" variant="secondary">
            Back to events
          </Button>
        }
      />
    )
  }

  function validate() {
    const e = {}
    const booked = existing ? existing.capacity - existing.availableSeats : 0
    if (form.title.trim().length < 5) e.title = 'Give the event a descriptive title (5+ characters).'
    if (!form.city) e.city = 'Choose a city.'
    if (form.mode === 'In-person' && form.venue.trim().length < 3) e.venue = 'Add a venue for in-person events.'
    if (!form.date) e.date = 'Pick a date.'
    else if (!isEdit && form.date < todayISO()) e.date = 'The date must be today or later.'
    if (!form.time) e.time = 'Pick a start time.'
    if (form.organizerChapter.trim().length < 2) e.organizerChapter = 'Which chapter is organizing?'
    const cap = Number(form.capacity)
    if (!Number.isInteger(cap) || cap < 1 || cap > 100000) e.capacity = 'Capacity must be a whole number between 1 and 100,000.'
    else if (cap < booked) e.capacity = `Already ${booked} seats booked. Capacity can't go below that.`
    if (form.description.trim().length < 30) e.description = 'Describe the event in at least 30 characters.'
    if (form.registrationDeadline && form.date && form.registrationDeadline > form.date) e.registrationDeadline = 'Deadline must be on or before the event date.'
    setErrors(e)
    return !Object.keys(e).length
  }

  async function submit(ev) {
    ev.preventDefault()
    setFormError('')
    if (!validate()) {
      setTimeout(() => document.querySelector('[aria-invalid="true"]')?.focus(), 0)
      return
    }
    setBusy(true)
    const payload = {
      title: form.title.trim(),
      category: form.category,
      mode: form.mode,
      city: form.city,
      venue: form.mode === 'Online' ? form.venue.trim() || 'Online' : form.venue.trim(),
      date: form.date,
      time: form.time,
      endTime: form.endTime || null,
      organizerChapter: form.organizerChapter.trim(),
      capacity: Number(form.capacity),
      description: form.description.trim(),
      image: form.image || GALLERY[0],
      registrationDeadline: form.registrationDeadline || null,
      requirements: lines(form.requirements),
      learn: lines(form.learn),
      tags: form.tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
    }
    try {
      if (isEdit) {
        await updateEvent(id, payload)
        toast({ title: 'Event updated successfully.' })
      } else {
        const created = await createEvent(payload)
        toast({ title: 'Event published 🎉', message: `${created.title} is now live on Codefolio.` })
      }
      navigate('/admin/events')
    } catch (e) {
      // Server-side validation errors come back per field.
      if (e.fields) setErrors((x) => ({ ...x, ...e.fields }))
      setFormError(e.message)
    } finally {
      setBusy(false)
    }
  }

  async function onUpload(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setUploading(true)
    try {
      const url = await uploadImage(await readImage(file))
      setForm((f) => ({ ...f, image: url }))
      setErrors((x) => ({ ...x, image: undefined }))
    } catch (err) {
      setErrors((x) => ({ ...x, image: err.message }))
    } finally {
      setUploading(false)
    }
  }

  return (
    <>
      <header className="dash-head">
        <div>
          <p className="eyebrow">{isEdit ? 'Edit event' : 'Add event'}</p>
          <h1>{isEdit ? existing.title : 'Create a new event'}</h1>
          <p className="muted">{isEdit ? 'Changes go live immediately.' : 'Published events appear on Codefolio right away and can be booked.'}</p>
        </div>
      </header>

      <form className="event-form" onSubmit={submit} noValidate>
        {formError && (
          <p className="form-error" role="alert">
            <Icon name="alert" size={16} /> {formError}
          </p>
        )}

        <fieldset className="card form-section">
          <legend>Basics</legend>
          <Input label="Event Title" value={form.title} onChange={set('title')} error={errors.title} required placeholder="e.g. Build with Gemini: Hack Night" />
          <div className="grid-2">
            <div className="field">
              <span className="field__label" id="type-label">
                Event Type
              </span>
              <Segmented
                label="Event Type"
                value={form.category}
                onChange={(v) => setForm((f) => ({ ...f, category: v }))}
                options={[
                  { value: 'hackathon', label: 'Hackathon', icon: 'trophy' },
                  { value: 'workshop', label: 'Workshop', icon: 'wrench' },
                  { value: 'gdg', label: 'Event', icon: 'users' },
                ]}
              />
            </div>
            <div className="field">
              <span className="field__label">Mode</span>
              <Segmented
                label="Mode"
                value={form.mode}
                onChange={(v) => setForm((f) => ({ ...f, mode: v }))}
                options={[
                  { value: 'In-person', label: 'In-person', icon: 'building' },
                  { value: 'Online', label: 'Online', icon: 'wifi' },
                ]}
              />
            </div>
          </div>
          <Input label="Organizer Chapter" value={form.organizerChapter} onChange={set('organizerChapter')} error={errors.organizerChapter} required />
        </fieldset>

        <fieldset className="card form-section">
          <legend>When &amp; where</legend>
          <div className="grid-2">
            <Select label="City" value={form.city} onChange={set('city')} error={errors.city} options={[{ value: '', label: 'Select a city' }, ...CITIES]} required />
            <Input
              label="Venue"
              value={form.venue}
              onChange={set('venue')}
              error={errors.venue}
              placeholder={form.mode === 'Online' ? 'e.g. Google Meet (optional)' : 'e.g. T-Hub, Raidurg'}
              required={form.mode === 'In-person'}
            />
          </div>
          <div className="grid-3">
            <Input label="Date" type="date" value={form.date} onChange={set('date')} error={errors.date} min={isEdit ? undefined : todayISO()} required />
            <Input label="Start time" type="time" value={form.time} onChange={set('time')} error={errors.time} required />
            <Input label="End time" type="time" value={form.endTime} onChange={set('endTime')} hint="Optional" />
          </div>
          <div className="grid-2">
            <Input
              label="Capacity"
              type="number"
              min="1"
              inputMode="numeric"
              value={form.capacity}
              onChange={set('capacity')}
              error={errors.capacity}
              hint={existing ? `${existing.capacity - existing.availableSeats} already booked` : 'Total seats available'}
              required
            />
            <Input
              label="Registration Deadline"
              type="date"
              value={form.registrationDeadline}
              onChange={set('registrationDeadline')}
              error={errors.registrationDeadline}
              hint="Optional"
            />
          </div>
        </fieldset>

        <fieldset className="card form-section">
          <legend>Details</legend>
          <Textarea label="Description" rows={5} value={form.description} onChange={set('description')} error={errors.description} required />
          <div className="grid-2">
            <Textarea label="Requirements" rows={4} value={form.requirements} onChange={set('requirements')} hint="One per line" />
            <Textarea label="What attendees will learn" rows={4} value={form.learn} onChange={set('learn')} hint="One per line" />
          </div>
          <Input label="Tags" value={form.tags} onChange={set('tags')} hint="Comma-separated, e.g. Gemini, Cloud, Beginner friendly" />
        </fieldset>

        <fieldset className="card form-section">
          <legend>Event Image</legend>
          <div className="image-picker">
            <div className="image-picker__preview">
              {form.image ? <img src={form.image} alt="Selected event cover" /> : <Icon name="image" size={32} />}
            </div>
            <div className="image-picker__controls">
              <p className="small muted">Pick a photo or upload your own (JPG, PNG or WebP). Uploads are stored in Supabase Storage.</p>
              <div className="gallery" role="radiogroup" aria-label="Gallery images">
                {GALLERY.map((src, i) => (
                  <button
                    key={src}
                    type="button"
                    role="radio"
                    aria-checked={form.image === src}
                    aria-label={`Gallery image ${i + 1}`}
                    className={cx('gallery__item', form.image === src && 'is-active')}
                    onClick={() => setForm((f) => ({ ...f, image: src }))}
                  >
                    <img src={src.replace('w=800', 'w=160').replace('h=480', 'h=100')} alt="" />
                  </button>
                ))}
              </div>
              <label className={cx('btn btn--secondary btn--sm upload-btn', uploading && 'is-loading')} aria-busy={uploading || undefined}>
                {uploading ? <span className="spinner" aria-hidden="true" /> : <Icon name="image" size={16} />}
                <span>{uploading ? 'Uploading…' : 'Upload image'}</span>
                <input type="file" accept="image/png,image/jpeg,image/webp" onChange={onUpload} className="sr-only" disabled={uploading} />
              </label>
              {errors.image && (
                <p className="field__error" role="alert">
                  <Icon name="alert" size={14} /> {errors.image}
                </p>
              )}
            </div>
          </div>
        </fieldset>

        <div className="form-actions form-actions--sticky">
          <Button type="button" variant="ghost" onClick={() => navigate('/admin/events')}>
            Cancel
          </Button>
          <Button type="submit" loading={busy} disabled={uploading} icon={isEdit ? 'check' : 'plus'}>
            {isEdit ? 'Save Changes' : 'Create Event'}
          </Button>
        </div>
      </form>
    </>
  )
}
