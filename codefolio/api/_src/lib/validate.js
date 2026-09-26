import { z } from 'zod'

const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.')
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM (24h).')
const dateTime = z.iso.datetime({ offset: true, message: 'Pick a date and time.' })
// '' / null → null; otherwise a whole number 1–10 (team sizes).
const teamSize = z.preprocess(
  (v) => (v === '' || v == null ? null : Number(v)),
  z.number({ message: 'Enter a number.' }).int('Use a whole number.').min(1, 'At least 1.').max(10, 'At most 10.').nullable(),
)
// Codefolio times are IST.
const startOf = (date, t) => new Date(`${date}T${t}:00+05:30`)
// Indian mobile number: accept "+91 98765 43210", "098765-43210" etc.
const upiNumber = z.preprocess(
  (v) => (v == null || v === '' ? null : String(v).replace(/[\s-]/g, '').replace(/^(\+?91|0)(?=\d{10}$)/, '')),
  z.string().regex(/^[6-9]\d{9}$/, 'Enter a 10-digit mobile number linked to UPI.').nullable(),
)
const lines = z
  .array(z.string().trim().min(1).max(200))
  .max(20)
  .default([])

// ---------- judges ----------
// Profile links use the same formats the profile table enforces.
const optionalUrl = (re, message) =>
  z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? null : v), z.string().trim().regex(re, message).nullish())
const tagList = (max, each) =>
  z.preprocess(
    (v) => (typeof v === 'string' ? v.split(',') : v),
    z.array(z.string().trim().max(each)).max(max).transform((a) => [...new Set(a.filter(Boolean))]),
  )
export const judgeApplicationSchema = z.object({
  jobTitle: z.string().trim().min(2, 'Enter your current role or profession.').max(120),
  organization: z.string().trim().min(2, 'Enter your organization, company or university.').max(120),
  experienceYears: z.coerce.number({ message: 'Enter your years of experience.' }).int('Use whole years.').min(0).max(60, 'At most 60 years.'),
  skills: tagList(30, 40).default([]),
  expertise: tagList(20, 60).default([]),
  judgingExperience: z.string().trim().max(1000).default(''),
  linkedinUrl: optionalUrl(/^https:\/\/([a-z]{2,3}\.)?linkedin\.com\/(in|company)\/[^\s/]+\/?$/i, 'Use your LinkedIn profile link, e.g. https://www.linkedin.com/in/you'),
  githubUrl: optionalUrl(/^https:\/\/(www\.)?github\.com\/[A-Za-z0-9_.-]+\/?$/i, 'Use your GitHub profile link, e.g. https://github.com/you'),
  portfolioUrl: optionalUrl(/^https?:\/\/[^\s]+\.[^\s]+$/i, 'Enter a full link starting with https://'),
  bio: z.string().trim().max(600).default(''),
  reason: z.string().trim().min(20, 'Tell us why (at least 20 characters).').max(1500),
})

export const projectSchema = z.object({
  eventId: z.string().trim().min(1).max(64),
  title: z.string().trim().min(3, 'Give your project a name (3+ characters).').max(120),
  problemStatement: z.string().trim().min(10, 'Describe the problem (10+ characters).').max(2000),
  description: z.string().trim().min(30, 'Describe the project (30+ characters).').max(6000),
  techStack: tagList(20, 40).default([]),
  githubUrl: z.string().trim().regex(/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/?$/i, 'Use the repository link, e.g. https://github.com/team/project'),
  demoUrl: optionalUrl(/^https?:\/\/[^\s]+\.[^\s]+$/i, 'Enter a full link starting with https://'),
  videoUrl: optionalUrl(/^https?:\/\/[^\s]+\.[^\s]+$/i, 'Enter a full link starting with https://'),
})

const score = z.coerce
  .number({ message: 'Enter a score from 0 to 10.' })
  .min(0, 'Scores go from 0 to 10.')
  .max(10, 'Scores go from 0 to 10.')
  .refine((n) => Math.round(n * 10) === n * 10, 'Use at most one decimal place.')
export const judgeReviewSchema = z.object({
  innovation: score,
  technical: score,
  impact: score,
  uiux: score,
  presentation: score,
  feedback: z.string().trim().max(4000, 'Keep feedback under 4000 characters.').default(''),
})

export const signupSchema = z
  .object({
    name: z.string().trim().min(2, 'Enter your full name.').max(80),
    email: z.email('Enter a valid email address.').transform((s) => s.toLowerCase()),
    password: z.string().min(8, 'Use at least 8 characters.').max(72),
    role: z.enum(['attendee', 'organizer']).default('attendee'),
    city: z.string().trim().max(60).default(''),
    chapter: z.string().trim().max(80).default(''),
    bio: z.string().trim().max(600).default(''),
    // "Apply to become a Judge" at sign-up (an application, not the role itself).
    judge: judgeApplicationSchema.nullish(),
  })
  .superRefine((v, ctx) => {
    if (v.role !== 'organizer') return
    if (v.chapter.length < 2) ctx.addIssue({ code: 'custom', path: ['chapter'], message: 'Enter your organization or chapter name.' })
    if (!v.city) ctx.addIssue({ code: 'custom', path: ['city'], message: 'Choose a city.' })
    if (v.bio.length < 20) ctx.addIssue({ code: 'custom', path: ['bio'], message: 'Tell attendees a little more (at least 20 characters).' })
  })

export const loginSchema = z.object({
  email: z.email('Enter a valid email address.').transform((s) => s.toLowerCase()),
  password: z.string().min(1, 'Enter your password.'),
})

export const forgotSchema = z.object({ email: z.email('Enter a valid email address.').transform((s) => s.toLowerCase()) })

export const resetSchema = z.object({
  accessToken: z.string().min(10, 'This reset link is invalid.'),
  password: z.string().min(8, 'Use at least 8 characters.').max(72),
})

export const refreshSchema = z.object({ refreshToken: z.string().min(10) })

export const profileSchema = z.object({
  name: z.string().trim().min(2, 'Enter your full name.').max(80),
  city: z.string().trim().max(60).default(''),
  chapter: z.string().trim().max(80).default(''),
  bio: z.string().trim().max(600).default(''),
})

export const eventSchema = z
  .object({
    title: z.string().trim().min(5, 'Give the event a descriptive title (5+ characters).').max(140),
    category: z.enum(['hackathon', 'workshop', 'gdg']),
    mode: z.enum(['Online', 'In-person', 'Hybrid']),
    status: z.enum(['Published', 'Draft']).default('Published'),
    city: z.string().trim().min(2, 'Choose a city.').max(60),
    venue: z.string().trim().max(200).default(''),
    date: isoDate,
    time,
    endTime: time.nullish(),
    endDate: isoDate.nullish(),
    applicationsOpenAt: dateTime.nullish(),
    applicationsCloseAt: dateTime.nullish(),
    theme: z.string().trim().max(120, 'Keep the theme under 120 characters.').nullish(),
    teamMin: teamSize.optional(),
    teamMax: teamSize.optional(),
    applicationFee: z.preprocess(
      (v) => (v === '' || v == null ? 0 : Number(v)),
      z.number({ message: 'Enter an amount in rupees.' }).int('Use whole rupees.').min(0, 'The fee can’t be negative.').max(100000, 'The fee can be at most ₹1,00,000.'),
    ),
    upiId: z.string().trim().max(320).nullish(),
    upiNumber: upiNumber.optional(),
    upiQrUrl: z.string().trim().max(2000).nullish(),
    organizerChapter: z.string().trim().min(2, 'Which chapter is organizing?').max(80),
    capacity: z.coerce.number().int().min(1, 'Capacity must be at least 1.').max(100000),
    description: z.string().trim().min(30, 'Describe the event in at least 30 characters.').max(8000),
    image: z
      .string()
      .trim()
      .max(2000)
      .refine((s) => !s || /^https:\/\//.test(s), 'Image must be an https URL.')
      .nullish(),
    registrationDeadline: isoDate.nullish(),
    requirements: lines,
    learn: lines,
    tags: z.array(z.string().trim().min(1).max(40)).max(12).default([]),
  })
  .superRefine((v, ctx) => {
    const issue = (path, message) => ctx.addIssue({ code: 'custom', path: [path], message })
    if (v.mode !== 'Online' && v.venue.length < 3) issue('venue', 'Add a venue for in-person and hybrid events.')
    if (v.registrationDeadline && v.registrationDeadline > v.date) issue('registrationDeadline', 'Deadline must be on or before the event date.')
    if (v.endDate && v.endDate < v.date) issue('endDate', 'The end date can’t be before the start date.')
    if (v.endTime && (!v.endDate || v.endDate === v.date) && v.endTime <= v.time) issue('endTime', 'The end must be after the start.')
    const open = v.applicationsOpenAt ? new Date(v.applicationsOpenAt) : null
    const close = v.applicationsCloseAt ? new Date(v.applicationsCloseAt) : null
    if (open && close && open >= close) issue('applicationsCloseAt', 'The deadline must be after applications open.')
    if (close && close > startOf(v.date, v.time)) issue('applicationsCloseAt', 'Applications must close before the event starts.')
    if (v.category === 'hackathon') {
      if (!open) issue('applicationsOpenAt', 'When do applications open?')
      if (!close) issue('applicationsCloseAt', 'When is the application deadline?')
      if (!v.endDate) issue('endDate', 'When does hacking end?')
      if (v.teamMin == null) issue('teamMin', 'Set the minimum team size.')
      if (v.teamMax == null) issue('teamMax', 'Set the maximum team size.')
    }
    if (v.teamMin != null && v.teamMax != null && v.teamMin > v.teamMax) issue('teamMax', 'Max team size must be at least the minimum.')
    // Payment details are needed only when there is a fee.
    if (v.applicationFee > 0) {
      if (!/^[A-Za-z0-9._-]{2,255}@[A-Za-z]{2,64}$/.test(v.upiId || '')) issue('upiId', 'Enter a valid UPI ID, e.g. yourclub@okaxis.')
      if (!v.upiNumber) issue('upiNumber', 'Enter the mobile number linked to UPI.')
      if (!/^https:\/\//.test(v.upiQrUrl || '')) issue('upiQrUrl', 'Upload your UPI QR code image.')
    }
  })

export const newEventSchema = eventSchema.superRefine((v, ctx) => {
  if (v.date < today()) ctx.addIssue({ code: 'custom', path: ['date'], message: 'The date must be today or later.' })
  if (v.applicationsCloseAt && new Date(v.applicationsCloseAt) <= new Date()) {
    ctx.addIssue({ code: 'custom', path: ['applicationsCloseAt'], message: 'The application deadline must be in the future.' })
  }
})

export const bookingSchema = z.object({
  eventId: z.string().trim().min(1).max(64),
  seats: z.coerce.number().int().min(1).max(4).default(1),
  answers: z.record(z.string(), z.any()).optional().default({}),
  // Hackathons: how the applicant takes part (the SQL function enforces the rules).
  participation: z.enum(['solo', 'team_create', 'team_join']).nullish(),
  // Paid events: UPI transaction ID (UTR) + optional screenshot (uploaded first).
  paymentRef: z.string().trim().max(40).nullish(),
  paymentProof: z.object({ path: z.string().max(300), name: z.string().max(200), size: z.number().optional(), type: z.string().max(100).optional() }).nullish(),
  teamName: z.string().trim().max(60, 'Team name must be 2–60 characters.').nullish(),
  teamCode: z.string().trim().max(20).nullish(),
})

export const reviewSchema = z.object({ note: z.string().trim().max(500).optional().default('') })

export const checkInSchema = z.object({
  eventId: z.string().trim().min(1).max(64),
  code: z.string().trim().min(4, 'Enter the code.').max(200),
})

export const hostRequestSchema = z.object({
  type: z.enum(['event', 'hackathon', 'both']),
  organization: z.string().trim().min(2, 'Enter your community or organization name.').max(120),
  city: z.string().trim().max(60).default(''),
  reason: z.string().trim().min(20, 'Tell us a little more (at least 20 characters).').max(1000),
})

export const fileUploadSchema = z.object({
  name: z.string().trim().min(1).max(200),
  dataUrl: z
    .string()
    .regex(/^data:(application\/pdf|image\/(png|jpe?g|webp)|application\/zip|text\/plain);base64,[A-Za-z0-9+/=]+$/, 'Upload a PDF, image, ZIP or text file.'),
})

export const uploadSchema = z.object({
  dataUrl: z.string().regex(/^data:image\/(png|jpe?g|webp);base64,[A-Za-z0-9+/=]+$/, 'Upload a PNG, JPG or WebP image.'),
})
