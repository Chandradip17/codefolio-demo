import { z } from 'zod'

const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.')
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM (24h).')
const lines = z
  .array(z.string().trim().min(1).max(200))
  .max(20)
  .default([])

export const signupSchema = z
  .object({
    name: z.string().trim().min(2, 'Enter your full name.').max(80),
    email: z.email('Enter a valid email address.').transform((s) => s.toLowerCase()),
    password: z.string().min(8, 'Use at least 8 characters.').max(72),
    role: z.enum(['attendee', 'organizer']).default('attendee'),
    city: z.string().trim().max(60).default(''),
    chapter: z.string().trim().max(80).default(''),
    bio: z.string().trim().max(600).default(''),
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
    mode: z.enum(['Online', 'In-person']),
    city: z.string().trim().min(2, 'Choose a city.').max(60),
    venue: z.string().trim().max(200).default(''),
    date: isoDate,
    time,
    endTime: time.nullish(),
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
    if (v.mode === 'In-person' && v.venue.length < 3) ctx.addIssue({ code: 'custom', path: ['venue'], message: 'Add a venue for in-person events.' })
    if (v.registrationDeadline && v.registrationDeadline > v.date) {
      ctx.addIssue({ code: 'custom', path: ['registrationDeadline'], message: 'Deadline must be on or before the event date.' })
    }
  })

export const newEventSchema = eventSchema.superRefine((v, ctx) => {
  if (v.date < today()) ctx.addIssue({ code: 'custom', path: ['date'], message: 'The date must be today or later.' })
})

export const bookingSchema = z.object({
  eventId: z.string().trim().min(1).max(64),
  seats: z.coerce.number().int().min(1).max(4).default(1),
})

export const uploadSchema = z.object({
  dataUrl: z.string().regex(/^data:image\/(png|jpe?g|webp);base64,[A-Za-z0-9+/=]+$/, 'Upload a PNG, JPG or WebP image.'),
})
