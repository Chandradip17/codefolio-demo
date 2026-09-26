// Application forms: default templates, schema validation (for the builder)
// and answer validation (for applicants). Forms are stored as JSON in
// event_forms.schema; answers go to booking_answers, one row per question.
import { HttpError } from './errors.js'

export const QUESTION_TYPES = ['text', 'long_text', 'url', 'number', 'single_choice', 'multiple_choice', 'file']

// Profile-backed questions are prefilled for the applicant (still editable).
export const HACKATHON_DEFAULT = [
  { id: 'full_name', type: 'text', label: 'Full name', required: true, prefill: 'name' },
  { id: 'email', type: 'text', label: 'Email', required: true, prefill: 'email' },
  { id: 'college_company', type: 'text', label: 'College / company', required: true, prefill: 'college_company' },
  { id: 'skills', type: 'text', label: 'Skills', required: false, prefill: 'skills' },
  { id: 'github', type: 'url', label: 'GitHub', required: false, prefill: 'github' },
  { id: 'linkedin', type: 'url', label: 'LinkedIn', required: false, prefill: 'linkedin' },
  { id: 'portfolio', type: 'url', label: 'Portfolio', required: false, prefill: 'portfolio' },
  {
    id: 'experience',
    type: 'single_choice',
    label: 'Hackathon experience',
    required: true,
    options: ['First hackathon', '1–3 hackathons', '4+ hackathons'],
  },
  { id: 'why', type: 'long_text', label: 'Why do you want to participate?', required: true },
]
export const EVENT_DEFAULT = [{ id: 'why', type: 'long_text', label: 'Why do you want to attend?', required: false }]

export const defaultForm = (event) => ({
  version: 0,
  isDefault: true,
  questions: event?.category === 'hackathon' ? HACKATHON_DEFAULT : EVENT_DEFAULT,
})

const ID_RE = /^[a-z0-9_]{1,40}$/

// Validate a form submitted from the builder.
export function cleanFormSchema(input) {
  const qs = input?.questions
  if (!Array.isArray(qs)) throw new HttpError(422, 'validation', 'The form needs a list of questions.')
  if (qs.length > 30) throw new HttpError(422, 'validation', 'A form can have at most 30 questions.')
  const seen = new Set()
  const questions = qs.map((q, i) => {
    const n = `Question ${i + 1}`
    const id = String(q.id || '').trim()
    if (!ID_RE.test(id)) throw new HttpError(422, 'validation', `${n}: invalid id.`)
    if (seen.has(id)) throw new HttpError(422, 'validation', `${n}: duplicate question.`)
    seen.add(id)
    if (!QUESTION_TYPES.includes(q.type)) throw new HttpError(422, 'validation', `${n}: unknown question type.`)
    const label = String(q.label || '').trim()
    if (label.length < 2 || label.length > 200) throw new HttpError(422, 'validation', `${n}: the question text must be 2–200 characters.`)
    const out = { id, type: q.type, label, required: Boolean(q.required) }
    if (q.help) out.help = String(q.help).trim().slice(0, 300)
    if (q.prefill && ['name', 'email', 'college_company', 'skills', 'github', 'linkedin', 'portfolio'].includes(q.prefill)) out.prefill = q.prefill
    if (q.type === 'single_choice' || q.type === 'multiple_choice') {
      const opts = [...new Set((q.options || []).map((o) => String(o).trim()).filter(Boolean))]
      if (opts.length < 2 || opts.length > 20) throw new HttpError(422, 'validation', `${n}: add between 2 and 20 options.`)
      if (opts.some((o) => o.length > 100)) throw new HttpError(422, 'validation', `${n}: options can be at most 100 characters.`)
      out.options = opts
    }
    return out
  })
  return { questions }
}

// Validate an applicant's answers against the form. Returns the cleaned answers.
export function cleanAnswers(questions, answers, userId) {
  const a = answers && typeof answers === 'object' ? answers : {}
  const out = {}
  const fields = {}
  for (const q of questions) {
    let v = a[q.id]
    const empty = v == null || v === '' || (Array.isArray(v) && v.length === 0)
    if (empty) {
      if (q.required) fields[q.id] = 'This question is required.'
      continue
    }
    switch (q.type) {
      case 'text':
      case 'long_text': {
        v = String(v).trim()
        const max = q.type === 'text' ? 300 : 3000
        if (!v && q.required) fields[q.id] = 'This question is required.'
        else if (v.length > max) fields[q.id] = `Keep this under ${max} characters.`
        else if (v) out[q.id] = v
        break
      }
      case 'url':
        v = String(v).trim()
        if (!/^https?:\/\/[^\s]+\.[^\s]+$/i.test(v)) fields[q.id] = 'Enter a full link starting with https://'
        else out[q.id] = v.slice(0, 500)
        break
      case 'number': {
        const num = Number(v)
        if (!Number.isFinite(num)) fields[q.id] = 'Enter a number.'
        else out[q.id] = num
        break
      }
      case 'single_choice':
        if (!q.options.includes(v)) fields[q.id] = 'Choose one of the options.'
        else out[q.id] = v
        break
      case 'multiple_choice': {
        const arr = Array.isArray(v) ? v : [v]
        if (!arr.every((x) => q.options.includes(x))) fields[q.id] = 'Choose from the listed options.'
        else out[q.id] = [...new Set(arr)]
        break
      }
      case 'file':
        // Files are uploaded first (private bucket); the answer references the stored object.
        if (!v || typeof v !== 'object' || typeof v.path !== 'string' || !v.path.startsWith(`${userId}/`)) {
          fields[q.id] = 'Upload the file again.'
        } else {
          out[q.id] = { path: v.path, name: String(v.name || 'file').slice(0, 200), size: Number(v.size) || 0, type: String(v.type || '') }
        }
        break
    }
  }
  if (Object.keys(fields).length) {
    const err = new HttpError(422, 'validation', 'Some answers need attention.')
    err.fields = fields
    throw err
  }
  return out
}
