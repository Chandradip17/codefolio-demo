import { useCallback, useEffect, useState } from 'react'
import AnnouncementItem from '../../components/AnnouncementItem'
import Icon from '../../components/Icon'
import { ConfirmDialog } from '../../components/Modal'
import { Button, EmptyState, ErrorState, Input, Segmented, Select, Textarea } from '../../components/ui'
import { useData } from '../../context/DataContext'
import { useToast } from '../../context/ToastContext'
import * as api from '../../services/api'
import { formatDate, istInputToISO, isoToISTInput } from '../../utils/format'
import { useHackathonPicker } from './OrganizerJudging'

const AUDIENCES = [
  { value: 'all', label: 'Everyone' },
  { value: 'participants', label: 'Participants' },
  { value: 'judges', label: 'Judges' },
  { value: 'team', label: 'Specific team' },
]
const blank = { title: '', message: '', audience: 'all', teamId: '', important: false, pinned: false, schedule: false, publishAt: '' }

function Board({ eventId }) {
  const toast = useToast()
  const { subscribe } = useData()
  const [feed, setFeed] = useState(null)
  const [error, setError] = useState('')
  const [form, setForm] = useState(blank)
  const [editing, setEditing] = useState(null)
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(false)
  const [archiving, setArchiving] = useState(null)

  const load = useCallback(async () => {
    setError('')
    try {
      setFeed(await api.announcements(eventId, undefined))
    } catch (e) {
      setError(e.message)
    }
  }, [eventId])
  useEffect(() => {
    load()
  }, [load])
  useEffect(() => subscribe((type, d) => type === 'announcement.updated' && d.eventId === eventId && load()), [subscribe, eventId, load])

  const set = (k) => (v) => {
    setForm((f) => ({ ...f, [k]: v }))
    setErrors((x) => ({ ...x, [k]: undefined }))
  }

  function edit(a) {
    setEditing(a)
    setForm({ title: a.title, message: a.message, audience: a.audience, teamId: a.teamId || '', important: a.important, pinned: a.pinned, schedule: a.scheduled, publishAt: a.scheduled ? isoToISTInput(a.publishAt) : '' })
    setErrors({})
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  const reset = () => {
    setEditing(null)
    setForm(blank)
    setErrors({})
  }

  async function submit(e) {
    e.preventDefault()
    const x = {}
    if (form.title.trim().length < 3) x.title = 'Give it a title (3+ characters).'
    if (!form.message.trim()) x.message = 'Write the message.'
    if (form.audience === 'team' && !form.teamId) x.teamId = 'Choose the team.'
    const publishAt = form.schedule ? istInputToISO(form.publishAt) : null
    if (form.schedule && (!publishAt || Date.parse(publishAt) <= Date.now())) x.publishAt = 'Pick a time in the future (IST).'
    setErrors(x)
    if (Object.keys(x).length) return
    setBusy(true)
    const body = { eventId, title: form.title.trim(), message: form.message.trim(), audience: form.audience, teamId: form.audience === 'team' ? form.teamId : null, important: form.important, pinned: form.pinned, publishAt }
    try {
      if (editing) {
        await api.updateAnnouncement(editing.id, body)
        toast({ title: 'Announcement updated' })
      } else {
        const a = await api.createAnnouncement(body)
        toast(a.scheduled ? { title: 'Announcement scheduled', message: 'It will be published and delivered at the chosen time.' } : { title: 'Announcement published', message: 'Everyone in the audience gets it right away.' })
      }
      reset()
      load()
    } catch (err) {
      if (err.fields) setErrors(err.fields)
      toast({ title: 'Couldn’t save the announcement', message: err.message, tone: 'error' })
    } finally {
      setBusy(false)
    }
  }

  async function confirmArchive() {
    setBusy(true)
    try {
      await api.archiveAnnouncement(archiving.id)
      toast({ title: 'Announcement archived', message: 'Members no longer see it.', tone: 'info' })
      if (editing?.id === archiving.id) reset()
      setArchiving(null)
      load()
    } catch (e) {
      toast({ title: 'Couldn’t archive', message: e.message, tone: 'error' })
    } finally {
      setBusy(false)
    }
  }

  if (error) return <ErrorState message={error} onRetry={load} />
  if (!feed) return <div className="skeleton" style={{ height: 320, borderRadius: 20 }} />
  const teams = feed.teams || []
  const live = feed.announcements.filter((a) => !a.archivedAt)
  const archived = feed.announcements.filter((a) => a.archivedAt)

  return (
    <>
      <div className="chart-grid comm-grid">
        <form className="card form-stack" onSubmit={submit} noValidate aria-labelledby="compose-h">
          <div className="card__head">
            <h3 id="compose-h">
              <Icon name={editing ? 'edit' : 'plus'} size={17} /> {editing ? 'Edit announcement' : 'Create announcement'}
            </h3>
            {editing && (
              <Button size="sm" variant="ghost" type="button" onClick={reset}>
                Cancel edit
              </Button>
            )}
          </div>
          <div className="field">
            <span className="field__label">Audience</span>
            <Segmented label="Audience" value={form.audience} onChange={set('audience')} options={AUDIENCES.map((a) => (a.value === 'team' && !teams.length ? { ...a, disabled: true, title: 'No teams yet' } : a))} />
          </div>
          {form.audience === 'team' && (
            <Select
              label="Team"
              value={form.teamId}
              error={errors.teamId}
              onChange={(e) => set('teamId')(e.target.value)}
              options={[{ value: '', label: 'Choose a team…' }, ...teams.map((t) => ({ value: t.id, label: `${t.name} · ${t.size} member${t.size === 1 ? '' : 's'}` }))]}
            />
          )}
          <Input label="Title" value={form.title} error={errors.title} maxLength={140} onChange={(e) => set('title')(e.target.value)} placeholder="Submission deadline" required />
          <Textarea label="Message" rows={5} value={form.message} error={errors.message} maxLength={5000} onChange={(e) => set('message')(e.target.value)} placeholder="Final submissions close at 8:00 PM IST." required />
          <div className="chip-row">
            <label className="check-row">
              <input type="checkbox" checked={form.important} onChange={(e) => set('important')(e.target.checked)} /> Mark as important
            </label>
            <label className="check-row">
              <input type="checkbox" checked={form.pinned} onChange={(e) => set('pinned')(e.target.checked)} /> Pin to the top
            </label>
            {(!editing || editing.scheduled) && (
              <label className="check-row">
                <input type="checkbox" checked={form.schedule} onChange={(e) => set('schedule')(e.target.checked)} /> Schedule for later
              </label>
            )}
          </div>
          {form.schedule && <Input label="Publish at (IST)" type="datetime-local" value={form.publishAt} error={errors.publishAt} onChange={(e) => set('publishAt')(e.target.value)} hint="Delivered automatically at this time (India Standard Time)." />}
          <Button type="submit" icon={form.schedule ? 'clock' : 'radio'} loading={busy}>
            {editing ? 'Save changes' : form.schedule ? 'Schedule' : 'Publish'}
          </Button>
        </form>

        <section className="card" aria-labelledby="aud-h">
          <div className="card__head">
            <h3 id="aud-h">Who sees what</h3>
          </div>
          <ul className="mini-list">
            <li>
              <div>
                <strong>Everyone</strong>
                <small>Applicants, approved participants and assigned judges</small>
              </div>
            </li>
            <li>
              <div>
                <strong>Participants</strong>
                <small>Everyone who applied (pending or approved)</small>
              </div>
            </li>
            <li>
              <div>
                <strong>Judges</strong>
                <small>Judges assigned to this hackathon</small>
              </div>
            </li>
            <li>
              <div>
                <strong>Specific team</strong>
                <small>Only that team’s members · {teams.length} team{teams.length === 1 ? '' : 's'}</small>
              </div>
            </li>
          </ul>
          <p className="small muted">New announcements reach people instantly (a notification on their screen) and wait in their Hackathon updates.</p>
        </section>
      </div>

      <section className="dash-section">
        <div className="section-head section-head--tight">
          <h2>Announcements</h2>
          <Button size="sm" variant="ghost" icon="refresh" onClick={load}>
            Refresh
          </Button>
        </div>
        {!live.length ? (
          <EmptyState icon="radio" title="No announcements yet" message="Create the first one above. Participants and judges see it immediately." />
        ) : (
          <div className="announce-list">
            {live.map((a) => (
              <AnnouncementItem
                key={a.id}
                a={a}
                showAudience
                actions={
                  <>
                    <Button size="sm" variant="ghost" icon="edit" onClick={() => edit(a)}>
                      Edit
                    </Button>
                    <Button size="sm" variant="danger-ghost" icon="ban" onClick={() => setArchiving(a)}>
                      Archive
                    </Button>
                  </>
                }
              />
            ))}
          </div>
        )}
        {archived.length > 0 && (
          <details className="comm-archived">
            <summary className="small muted">Archived ({archived.length})</summary>
            <div className="announce-list">
              {archived.map((a) => (
                <AnnouncementItem key={a.id} a={a} showAudience />
              ))}
            </div>
          </details>
        )}
      </section>

      <ConfirmDialog
        open={Boolean(archiving)}
        onClose={() => setArchiving(null)}
        onConfirm={confirmArchive}
        busy={busy}
        title="Archive this announcement?"
        confirmLabel="Archive"
        message={archiving && <p>“{archiving.title}” will disappear from members’ updates. It stays in your archived list.</p>}
      />
    </>
  )
}

export default function OrganizerCommunication() {
  const { list, error, id, choose } = useHackathonPicker()
  if (error) return <ErrorState message={error} />
  return (
    <>
      <header className="dash-head">
        <div>
          <p className="eyebrow">Communication</p>
          <h1>Communication Center</h1>
          <p className="muted">Announcements for your hackathon’s participants, judges and teams, delivered in real time.</p>
        </div>
        {id && (
          <Button variant="secondary" icon="eye" to={`/hackathons/${encodeURIComponent(id)}/communication`}>
            Member view
          </Button>
        )}
      </header>
      {list && !list.length ? (
        <EmptyState icon="trophy" title="No hackathons yet" message="Create a hackathon first." action={<Button to="/admin/events/new" icon="plus">Add Event</Button>} />
      ) : (
        <>
          <div className="table-tools">
            <Select
              label="Hackathon"
              value={id}
              onChange={(e) => choose(e.target.value)}
              options={(list || []).map((h) => ({ value: h.id, label: `${h.title} · ${formatDate(h.date, { year: false })}` }))}
            />
          </div>
          {id ? <Board key={id} eventId={id} /> : <div className="skeleton" style={{ height: 320, borderRadius: 20 }} />}
        </>
      )}
    </>
  )
}
