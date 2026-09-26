import { Input, Textarea } from './ui'

// Judge application fields, shared by Sign up ("Apply to become a Judge") and
// /judge/apply. Skills, links and bio are saved to the member's profile; the
// rest belongs to the application.
export const emptyJudge = (user) => ({
  jobTitle: '',
  organization: user?.company || user?.college || '',
  experienceYears: '',
  skills: (user?.skills || []).join(', '),
  expertise: '',
  judgingExperience: '',
  linkedinUrl: user?.linkedinUrl || '',
  githubUrl: user?.githubUrl || '',
  portfolioUrl: user?.portfolioUrl || '',
  bio: user?.bio || '',
  reason: '',
})

// Accept "you", "github.com/you" etc. and store the full profile link.
const normGithub = (v) => {
  const s = v.trim()
  if (!s) return ''
  const h = s.replace(/^https?:\/\//i, '').replace(/^(www\.)?github\.com\//i, '').replace(/\/+$/, '')
  return /^[A-Za-z0-9_.-]+$/.test(h) ? `https://github.com/${h}` : s
}
const normLinkedin = (v) => {
  const s = v.trim()
  if (!s) return ''
  if (/^(www\.)?linkedin\.com\//i.test(s)) return `https://${s.startsWith('www.') ? s : `www.${s}`}`
  return s
}
const normUrl = (v) => {
  const s = v.trim()
  if (!s) return ''
  return /^https?:\/\//i.test(s) ? s : `https://${s}`
}
const list = (s) => [...new Set(s.split(',').map((x) => x.trim()).filter(Boolean))]

export function toJudgePayload(v) {
  return {
    jobTitle: v.jobTitle.trim(),
    organization: v.organization.trim(),
    experienceYears: v.experienceYears === '' ? null : Number(v.experienceYears),
    skills: list(v.skills),
    expertise: list(v.expertise),
    judgingExperience: v.judgingExperience.trim(),
    linkedinUrl: normLinkedin(v.linkedinUrl) || null,
    githubUrl: normGithub(v.githubUrl) || null,
    portfolioUrl: normUrl(v.portfolioUrl) || null,
    bio: v.bio.trim(),
    reason: v.reason.trim(),
  }
}

export function validateJudge(v) {
  const e = {}
  const p = toJudgePayload(v)
  if (p.jobTitle.length < 2) e.jobTitle = 'Enter your current role or profession.'
  if (p.organization.length < 2) e.organization = 'Enter your organization, company or university.'
  if (p.experienceYears == null || !Number.isInteger(p.experienceYears) || p.experienceYears < 0 || p.experienceYears > 60) e.experienceYears = 'Enter whole years (0–60).'
  if (p.githubUrl && !/^https:\/\/(www\.)?github\.com\/[A-Za-z0-9_.-]+\/?$/i.test(p.githubUrl)) e.githubUrl = 'Use your GitHub profile link, e.g. https://github.com/you'
  if (p.linkedinUrl && !/^https:\/\/([a-z]{2,3}\.)?linkedin\.com\/(in|company)\/[^\s/]+\/?$/i.test(p.linkedinUrl)) e.linkedinUrl = 'Use your LinkedIn profile link, e.g. https://www.linkedin.com/in/you'
  if (p.skills.length > 30) e.skills = 'At most 30 skills.'
  if (p.expertise.length > 20) e.expertise = 'At most 20 areas.'
  if (p.reason.length < 20) e.reason = 'Tell us why (at least 20 characters).'
  return e
}

// Server field errors arrive as "jobTitle" or "judge.jobTitle" (sign-up).
export const judgeFieldErrors = (fields = {}) =>
  Object.fromEntries(Object.entries(fields).map(([k, msg]) => [k.replace(/^judge\./, ''), msg]))

export default function JudgeFields({ value, onChange, errors = {} }) {
  const set = (k) => (e) => onChange({ ...value, [k]: e.target.value })
  return (
    <>
      <div className="grid-2">
        <Input label="Current role / profession" value={value.jobTitle} onChange={set('jobTitle')} error={errors.jobTitle} placeholder="e.g. Senior Software Engineer" maxLength={120} required />
        <Input label="Organization / company / university" value={value.organization} onChange={set('organization')} error={errors.organization} maxLength={120} required />
      </div>
      <div className="grid-2">
        <Input label="Years of experience" type="number" min="0" max="60" inputMode="numeric" value={value.experienceYears} onChange={set('experienceYears')} error={errors.experienceYears} required />
        <Input
          label="Hackathon judging experience"
          value={value.judgingExperience}
          onChange={set('judgingExperience')}
          error={errors.judgingExperience}
          placeholder="e.g. Judged 4 college hackathons"
          maxLength={1000}
          hint="Optional"
        />
      </div>
      <div className="grid-2">
        <Input label="Technical skills" value={value.skills} onChange={set('skills')} error={errors.skills} placeholder="React, Node.js, Cloud" hint="Comma-separated" />
        <Input label="Areas of expertise" value={value.expertise} onChange={set('expertise')} error={errors.expertise} placeholder="AI/ML, Web, Fintech" hint="Comma-separated" />
      </div>
      <div className="grid-2">
        <Input label="LinkedIn" value={value.linkedinUrl} onChange={set('linkedinUrl')} error={errors.linkedinUrl} placeholder="linkedin.com/in/you" hint="Optional" />
        <Input label="GitHub" value={value.githubUrl} onChange={set('githubUrl')} error={errors.githubUrl} placeholder="github.com/you" hint="Optional" />
      </div>
      <Input label="Portfolio / website" value={value.portfolioUrl} onChange={set('portfolioUrl')} error={errors.portfolioUrl} placeholder="you.dev" hint="Optional" />
      <Textarea label="Short bio" rows={2} value={value.bio} onChange={set('bio')} error={errors.bio} maxLength={600} hint="Optional · shown on your profile" />
      <Textarea
        label="Why do you want to become a judge?"
        rows={3}
        value={value.reason}
        onChange={set('reason')}
        error={errors.reason}
        maxLength={1500}
        hint={`${value.reason.trim().length}/1500 · at least 20 characters`}
        required
      />
    </>
  )
}
