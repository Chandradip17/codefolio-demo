import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import Modal from './Modal'
import Icon from './Icon'
import { Button, Input, Select, Textarea } from './ui'
import { useToast } from '../context/ToastContext'
import RepoPanel from './RepoPanel'
import * as api from '../services/api'

const normUrl = (v) => {
  const s = v.trim()
  if (!s) return ''
  return /^https?:\/\//i.test(s) ? s : `https://${s}`
}
const REPO_RE = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/?$/i

// Hackathon project submission (one per team, or per solo participant).
export default function ProjectModal({ booking, project, onClose, onSaved }) {
  const toast = useToast()
  const [form, setForm] = useState(() => ({
    title: project?.title || '',
    problemStatement: project?.problemStatement || '',
    description: project?.description || '',
    techStack: (project?.techStack || []).join(', '),
    githubUrl: project?.githubUrl || '',
    demoUrl: project?.demoUrl || '',
    videoUrl: project?.videoUrl || '',
  }))
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState('')
  const [busy, setBusy] = useState(false)
  const locked = Boolean(project?.locked)
  // New projects can start from one of the member's saved Idea Assistant ideas.
  const [ideas, setIdeas] = useState([])
  useEffect(() => {
    if (project) return
    api.myIdeas(booking.eventId).then(setIdeas, () => setIdeas([]))
  }, [project, booking.eventId])
  function importIdea(ideaId) {
    const i = ideas.find((x) => x.id === ideaId)
    if (!i) return
    const description = [i.solution, i.targetUsers && `Target users: ${i.targetUsers}`, i.features?.length && `Core features:\n${i.features.map((f) => `- ${f}`).join('\n')}`]
      .filter(Boolean)
      .join('\n\n')
      .slice(0, 6000)
    setForm((f) => ({ ...f, title: i.title.slice(0, 120), problemStatement: i.problemStatement.slice(0, 2000), description, techStack: (i.techStack || []).join(', ') }))
    setErrors({})
  }
  const set = (k) => (e) => {
    setForm((f) => ({ ...f, [k]: e.target.value }))
    setErrors((x) => ({ ...x, [k]: undefined }))
  }

  async function submit(ev) {
    ev.preventDefault()
    setFormError('')
    const payload = {
      eventId: booking.eventId,
      title: form.title.trim(),
      problemStatement: form.problemStatement.trim(),
      description: form.description.trim(),
      techStack: form.techStack.split(',').map((t) => t.trim()).filter(Boolean),
      githubUrl: normUrl(form.githubUrl).replace(/\.git$/, ''),
      demoUrl: normUrl(form.demoUrl) || null,
      videoUrl: normUrl(form.videoUrl) || null,
    }
    const e = {}
    if (payload.title.length < 3) e.title = 'Give your project a name (3+ characters).'
    if (payload.problemStatement.length < 10) e.problemStatement = 'Describe the problem (10+ characters).'
    if (payload.description.length < 30) e.description = 'Describe the project (30+ characters).'
    if (!REPO_RE.test(payload.githubUrl)) e.githubUrl = 'Use the repository link, e.g. https://github.com/team/project'
    if (payload.techStack.length > 20) e.techStack = 'At most 20 items.'
    setErrors(e)
    if (Object.keys(e).length) return
    setBusy(true)
    try {
      const saved = await api.submitProject(payload)
      toast({ title: project ? 'Project updated' : 'Project submitted 🎉', message: `${saved.title} is ready for the judges.` })
      onSaved(saved)
    } catch (x) {
      if (x.fields) setErrors(x.fields)
      setFormError(x.message)
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={project ? 'Your project' : 'Submit your project'}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {locked ? 'Close' : 'Cancel'}
          </Button>
          {!locked && (
            <Button type="submit" form="project-form" icon="check" loading={busy}>
              {project ? 'Save changes' : 'Submit project'}
            </Button>
          )}
        </>
      }
    >
      <form id="project-form" className="form-stack" onSubmit={submit} noValidate>
        <p className="small muted">
          {booking.event.title}
          {booking.team ? ` · Team ${booking.team.name} (one project per team; any member can edit it)` : ' · solo project'}
        </p>
        {locked && (
          <p className="form-error" role="status">
            <Icon name="lock" size={15} /> Judges have started reviewing this project, so it can’t be edited any more.
          </p>
        )}
        {formError && (
          <p className="form-error" role="alert">
            <Icon name="alert" size={15} /> {formError}
          </p>
        )}
        {!project && ideas.length > 0 && (
          <Select
            label="Import from a saved idea"
            value=""
            onChange={(e) => importIdea(e.target.value)}
            options={[{ value: '', label: 'Choose an idea to fill in the form…' }, ...ideas.map((i) => ({ value: i.id, label: i.title }))]}
            hint="From your Idea Assistant. You can edit everything before submitting."
          />
        )}
        {!project && !ideas.length && (
          <p className="small muted">
            Need an idea? Try the{' '}
            <Link className="link" to={`/idea-assistant?h=${encodeURIComponent(booking.eventId)}`} onClick={onClose}>
              Idea Assistant
            </Link>
            .
          </p>
        )}
        <Input label="Project name" value={form.title} onChange={set('title')} error={errors.title} maxLength={120} disabled={locked} required />
        <Textarea label="Problem statement" rows={2} value={form.problemStatement} onChange={set('problemStatement')} error={errors.problemStatement} maxLength={2000} disabled={locked} required />
        <Textarea label="Project description" rows={4} value={form.description} onChange={set('description')} error={errors.description} maxLength={6000} disabled={locked} required />
        <Input label="Tech stack" value={form.techStack} onChange={set('techStack')} error={errors.techStack} placeholder="React, Supabase, Gemini" hint="Comma-separated" disabled={locked} />
        <Input
          label="GitHub repository"
          value={form.githubUrl}
          onChange={set('githubUrl')}
          error={errors.githubUrl}
          placeholder="https://github.com/team/project"
          hint="Public repository. Judges may run an automated analysis of it."
          disabled={locked}
          required
        />
        <div className="grid-2">
          <Input label="Live demo" value={form.demoUrl} onChange={set('demoUrl')} error={errors.demoUrl} placeholder="https://…" hint="Optional" disabled={locked} />
          <Input label="Demo video" value={form.videoUrl} onChange={set('videoUrl')} error={errors.videoUrl} placeholder="https://youtu.be/…" hint="Optional" disabled={locked} />
        </div>
      </form>
      {project?.id && <RepoPanel projectId={project.id} editable compact />}
    </Modal>
  )
}
