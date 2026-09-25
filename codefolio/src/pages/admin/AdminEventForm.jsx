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
  endDate: '',
  organizerChapter: '',
  capacity: '100',
  description: '',
  image: GALLERY[0],
  registrationDeadline: '',
  applicationsOpenAt: '',
  applicationsCloseAt: '',
  status: 'Published',
  theme: '',
  teamMin: '1',
  teamMax: '4',
  applicationFee: '0',
  upiId: '',
  upiNumber: '',
  upiQrUrl: '',
  requirements: '',
  learn: '',
  tags: '',
}

// <input type="datetime-local"> works in wall-clock time; Codefolio times are IST.
const toLocalInput = (iso) => (iso ? new Date(iso).toLocaleString('sv-SE', { timeZone: 'Asia/Kolkata' }).slice(0, 16).replace(' ', 'T') : '')
const fromLocalInput = (v) => (v ? `${v}:00+05:30` : null)
const nowLocal = () => toLocalInput(new Date().toISOString())

const lines = (s) =>
  s
    .split('\n')
    .map((x) => x.trim())
    .filter(Boolean)

// UPI QR codes stay PNG (sharp edges scan better) and at most 800px.
function readQr(file) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) return reject(new Error('Please choose an image of your UPI QR code.'))
    if (file.size > 8 * 1024 * 1024) return reject(new Error('Image must be under 8 MB.'))
    const img = new Image()
    img.onload = () => {
      const scale = Math.min(1, 800 / Math.max(img.width, img.height))
      const c = document.createElement('canvas')
      c.width = Math.round(img.width * scale)
      c.height = Math.round(img.height * scale)
      const ctx = c.getContext('2d')
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, c.width, c.height)
      ctx.drawImage(img, 0, 0, c.width, c.height)
      resolve(c.toDataURL('image/png'))
      URL.revokeObjectURL(img.src)
    }
    img.onerror = () => reject(new Error("Couldn't read that image."))
    img.src = URL.createObjectURL(file)
  })
}

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
  const [qrUploading, setQrUploading] = useState(false)

  useEffect(() => {
    if (existing && loadedFor !== existing.id) {
      // Older events only have a date-only deadline: carry it over as the application deadline.
      const legacyClose = existing.registrationDeadline
        ? `${existing.registrationDeadline}T${existing.registrationDeadline === existing.date ? existing.time : '23:59'}`
        : ''
      setForm({
        ...EMPTY,
        ...existing,
        mode: existing.hybrid ? 'Hybrid' : existing.mode,
        status: existing.status === 'Draft' ? 'Draft' : 'Published',
        capacity: String(existing.capacity),
        endTime: existing.endTime || '',
        endDate: existing.endDate || '',
        registrationDeadline: existing.registrationDeadline || '',
        applicationsOpenAt: toLocalInput(existing.applicationsOpenAt),
        applicationsCloseAt: existing.applicationsCloseAt ? toLocalInput(existing.applicationsCloseAt) : legacyClose,
        theme: existing.theme || '',
        teamMin: existing.teamMin != null ? String(existing.teamMin) : EMPTY.teamMin,
        teamMax: existing.teamMax != null ? String(existing.teamMax) : EMPTY.teamMax,
        applicationFee: String(existing.applicationFee || 0),
        upiId: existing.payment?.upiId || '',
        upiNumber: existing.payment?.upiNumber || '',
        upiQrUrl: existing.payment?.qrUrl || '',
        requirements: (existing.requirements || []).join('\n'),
        learn: (existing.learn || []).join('\n'),
        tags: (existing.tags || []).join(', '),
      })
      setLoadedFor(existing.id)
    }
  }, [existing, loadedFor])

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const isHack = form.category === 'hackathon'

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
    if (form.mode !== 'Online' && form.venue.trim().length < 3) e.venue = 'Add a venue for in-person and hybrid events.'
    if (!form.date) e.date = 'Pick a date.'
    else if (!isEdit && form.date < todayISO()) e.date = 'The date must be today or later.'
    if (!form.time) e.time = 'Pick a start time.'
    if (form.organizerChapter.trim().length < 2) e.organizerChapter = 'Which chapter is organizing?'
    const cap = Number(form.capacity)
    if (!Number.isInteger(cap) || cap < 1 || cap > 100000) e.capacity = 'Capacity must be a whole number between 1 and 100,000.'
    else if (cap < booked) e.capacity = `Already ${booked} seats booked. Capacity can't go below that.`
    if (form.description.trim().length < 30) e.description = 'Describe the event in at least 30 characters.'
    // Timeline: applications open → deadline → event starts → event ends.
    const start = form.date && form.time ? `${form.date}T${form.time}` : ''
    if (form.endDate && form.date && form.endDate < form.date) e.endDate = 'The end date can’t be before the start date.'
    if (form.endTime && form.time && (!form.endDate || form.endDate === form.date) && form.endTime <= form.time) e.endTime = 'The end must be after the start.'
    if (form.applicationsOpenAt && form.applicationsCloseAt && form.applicationsOpenAt >= form.applicationsCloseAt)
      e.applicationsCloseAt = 'The deadline must be after applications open.'
    else if (form.applicationsCloseAt && start && form.applicationsCloseAt > start) e.applicationsCloseAt = 'Applications must close before the event starts.'
    else if (!isEdit && form.applicationsCloseAt && form.applicationsCloseAt <= nowLocal()) e.applicationsCloseAt = 'The application deadline must be in the future.'
    // Application fee: UPI details only when there is a fee.
    const fee = form.applicationFee === '' ? 0 : Number(form.applicationFee)
    if (!Number.isInteger(fee) || fee < 0 || fee > 100000) e.applicationFee = 'Enter whole rupees from 0 to 1,00,000 (0 = free).'
    else if (fee > 0) {
      if (!/^[A-Za-z0-9._-]{2,255}@[A-Za-z]{2,64}$/.test(form.upiId.trim())) e.upiId = 'Enter a valid UPI ID, e.g. yourclub@okaxis.'
      if (!/^[6-9]\d{9}$/.test(form.upiNumber.replace(/[\s-]/g, '').replace(/^(\+?91|0)(?=\d{10}$)/, ''))) e.upiNumber = 'Enter the 10-digit mobile number linked to UPI.'
      if (!form.upiQrUrl) e.upiQrUrl = 'Upload your UPI QR code image.'
    }
    if (isHack) {
      if (!form.applicationsOpenAt) e.applicationsOpenAt = 'When do applications open?'
      if (!form.applicationsCloseAt) e.applicationsCloseAt ??= 'When is the application deadline?'
      if (!form.endDate) e.endDate ??= 'When does hacking end?'
      const min = Number(form.teamMin)
      const max = Number(form.teamMax)
      if (!Number.isInteger(min) || min < 1 || min > 10) e.teamMin = 'Use a whole number from 1 to 10.'
      if (!Number.isInteger(max) || max < 1 || max > 10) e.teamMax = 'Use a whole number from 1 to 10.'
      else if (!e.teamMin && min > max) e.teamMax = 'Max team size must be at least the minimum.'
      if (form.theme.trim().length > 120) e.theme = 'Keep the theme under 120 characters.'
    }
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
      endDate: form.endDate || null,
      status: form.status,
      applicationsOpenAt: fromLocalInput(form.applicationsOpenAt),
      applicationsCloseAt: fromLocalInput(form.applicationsCloseAt),
      theme: isHack ? form.theme.trim() || null : null,
      teamMin: isHack ? Number(form.teamMin) : null,
      teamMax: isHack ? Number(form.teamMax) : null,
      applicationFee: Number(form.applicationFee) || 0,
      upiId: Number(form.applicationFee) > 0 ? form.upiId.trim() : null,
      upiNumber: Number(form.applicationFee) > 0 ? form.upiNumber.trim() : null,
      upiQrUrl: Number(form.applicationFee) > 0 ? form.upiQrUrl : null,
      organizerChapter: form.organizerChapter.trim(),
      capacity: Number(form.capacity),
      description: form.description.trim(),
      image: form.image || GALLERY[0],
      registrationDeadline: form.applicationsCloseAt ? null : form.registrationDeadline || null,
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
        navigate('/admin/events')
      } else {
        const created = await createEvent(payload)
        toast(
          created.status === 'Draft'
            ? { title: 'Draft saved', message: `${created.title} is visible only to you until you publish it.` }
            : { title: 'Event published 🎉', message: `${created.title} is now live on Codefolio.` },
        )
        // Hackathons continue to their application form.
        navigate(created.category === 'hackathon' ? `/admin/events/${created.id}/application` : '/admin/events')
      }
    } catch (e) {
      // Server-side validation errors come back per field.
      if (e.fields) setErrors((x) => ({ ...x, ...e.fields }))
      setFormError(e.message)
    } finally {
      setBusy(false)
    }
  }

  async function onQrUpload(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setQrUploading(true)
    try {
      const url = await uploadImage(await readQr(file))
      setForm((f) => ({ ...f, upiQrUrl: url }))
      setErrors((x) => ({ ...x, upiQrUrl: undefined }))
    } catch (err) {
      setErrors((x) => ({ ...x, upiQrUrl: err.message }))
    } finally {
      setQrUploading(false)
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
                  { value: 'Hybrid', label: 'Hybrid', icon: 'globe' },
                ]}
              />
            </div>
          </div>
          <div className="grid-2">
            <Input label="Organizer Chapter" value={form.organizerChapter} onChange={set('organizerChapter')} error={errors.organizerChapter} required />
            <Select
              label="Publish Status"
              value={existing?.status === 'Cancelled' ? 'Published' : form.status}
              onChange={set('status')}
              disabled={existing?.status === 'Cancelled'}
              hint={existing?.status === 'Cancelled' ? 'This event is cancelled.' : undefined}
              options={[
                { value: 'Published', label: 'Published (Active in discovery)' },
                { value: 'Draft', label: 'Draft (Visible only to organizers)' },
              ]}
            />
          </div>
          {isHack && (
            <div className="grid-3">
              <Input
                label="Hackathon Theme / Track"
                value={form.theme}
                onChange={set('theme')}
                error={errors.theme}
                maxLength={120}
                placeholder="e.g. Generative AI, Decentralized Systems, Climate Tech"
              />
              <Input label="Min Team Size" type="number" min="1" max="10" inputMode="numeric" value={form.teamMin} onChange={set('teamMin')} error={errors.teamMin} required />
              <Input label="Max Team Size" type="number" min="1" max="10" inputMode="numeric" value={form.teamMax} onChange={set('teamMax')} error={errors.teamMax} required />
            </div>
          )}
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
              required={form.mode !== 'Online'}
            />
          </div>
          <div className="grid-3">
            <Input
              label={isHack ? 'Hacking Starts' : 'Date'}
              type="date"
              value={form.date}
              onChange={set('date')}
              error={errors.date}
              min={isEdit ? undefined : todayISO()}
              required
            />
            <Input label="Start time" type="time" value={form.time} onChange={set('time')} error={errors.time} required />
            <Input label="End time" type="time" value={form.endTime} onChange={set('endTime')} error={errors.endTime} hint="Optional" />
          </div>
          <div className="grid-2">
            <Input
              label={isHack ? 'Hacking Ends / Demos' : 'End date'}
              type="date"
              value={form.endDate}
              onChange={set('endDate')}
              error={errors.endDate}
              min={form.date || undefined}
              hint={isHack ? 'Last day of hacking and demos' : 'Optional, for multi-day events'}
              required={isHack}
            />
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
          </div>
          <div className="grid-2">
            <Input
              label="Application Opening Date & Time"
              type="datetime-local"
              value={form.applicationsOpenAt}
              onChange={set('applicationsOpenAt')}
              error={errors.applicationsOpenAt}
              hint={isHack ? 'IST' : 'Optional · IST'}
              required={isHack}
            />
            <Input
              label="Application Deadline"
              type="datetime-local"
              value={form.applicationsCloseAt}
              onChange={set('applicationsCloseAt')}
              error={errors.applicationsCloseAt || errors.registrationDeadline}
              min={form.applicationsOpenAt || undefined}
              hint={isHack ? 'IST · must be before hacking starts' : 'Optional · IST'}
              required={isHack}
            />
          </div>
        </fieldset>

        <fieldset className="card form-section">
          <legend>Application Fee</legend>
          <Input
            label="Application fee (₹)"
            type="number"
            min="0"
            step="1"
            inputMode="numeric"
            value={form.applicationFee}
            onChange={set('applicationFee')}
            error={errors.applicationFee}
            hint={Number(form.applicationFee) > 0 ? 'Applicants pay by UPI and enter their transaction ID. You verify it before approving.' : '0 = free, no payment step.'}
          />
          {Number(form.applicationFee) > 0 && (
            <>
              <div className="grid-2">
                <Input label="UPI ID" value={form.upiId} onChange={set('upiId')} error={errors.upiId} placeholder="e.g. gdgpune@okaxis" autoComplete="off" required />
                <Input
                  label="UPI Number"
                  type="tel"
                  inputMode="tel"
                  value={form.upiNumber}
                  onChange={set('upiNumber')}
                  error={errors.upiNumber}
                  placeholder="e.g. 98765 43210"
                  hint="Mobile number linked to UPI"
                  required
                />
              </div>
              <div className="field">
                <span className="field__label">
                  UPI QR Code<span aria-hidden="true" className="field__req"> *</span>
                </span>
                <div className="fee-qr-picker">
                  <div className="fee-qr-picker__preview">{form.upiQrUrl ? <img src={form.upiQrUrl} alt="Your UPI QR code" /> : <Icon name="qr" size={32} />}</div>
                  <div className="fee-qr-picker__controls">
                    <p className="small muted">Upload the QR from your UPI app (PNG or JPG). Applicants scan it to pay.</p>
                    <label className={cx('btn btn--secondary btn--sm upload-btn', qrUploading && 'is-loading')} aria-busy={qrUploading || undefined}>
                      {qrUploading ? <span className="spinner" aria-hidden="true" /> : <Icon name="image" size={16} />}
                      <span>{qrUploading ? 'Uploading…' : form.upiQrUrl ? 'Replace QR image' : 'Upload QR image'}</span>
                      <input type="file" accept="image/png,image/jpeg,image/webp" onChange={onQrUpload} className="sr-only" disabled={qrUploading} />
                    </label>
                  </div>
                </div>
                {errors.upiQrUrl && (
                  <p className="field__error" role="alert">
                    <Icon name="alert" size={14} /> {errors.upiQrUrl}
                  </p>
                )}
              </div>
            </>
          )}
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
          <Button type="submit" loading={busy} disabled={uploading || qrUploading} icon={isEdit ? 'check' : 'plus'}>
            {isEdit ? 'Save Changes' : form.status === 'Draft' ? 'Save Draft' : 'Create Event'}
          </Button>
        </div>
      </form>
    </>
  )
}
