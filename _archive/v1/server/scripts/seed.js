// Seeds Supabase with demo accounts, sample events and sample bookings.
// Idempotent: re-running won't duplicate anything or overwrite your edits.
//   npm run seed            → create what's missing
//   npm run seed -- --reset → delete sample events/bookings and recreate them (fresh dates)
import { randomBytes } from 'node:crypto'
import { admin } from '../src/lib/supabase.js'
import { config, missingSupabaseVars } from '../src/lib/config.js'
import { DEMO_EVENTS, SAMPLE_ATTENDEES, unsplash } from './demo-data.js'

if (!admin) {
  console.error(`Missing ${missingSupabaseVars().join(', ')}. Copy server/.env.example to server/.env first.`)
  process.exit(1)
}
const RESET = process.argv.includes('--reset')

const day = (offset) => {
  const d = new Date(Date.now() + offset * 86400000)
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
}
const code = () => {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  return 'CF-' + [...randomBytes(6)].map((b) => A[b % A.length]).join('')
}
const fail = (what, error) => {
  console.error(`✗ ${what}: ${error.message}`)
  if (/relation .* does not exist|schema cache|Could not find/i.test(error.message)) {
    console.error('  → Run server/supabase/schema.sql in the Supabase SQL editor first.')
  }
  process.exit(1)
}

// ---------- users ----------
const allUsers = []
for (let page = 1; ; page++) {
  const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 })
  if (error) fail('list users', error)
  allUsers.push(...data.users)
  if (data.users.length < 1000) break
}
const byEmail = new Map(allUsers.map((u) => [u.email?.toLowerCase(), u]))

async function ensureUser({ email, password, meta, resetPassword }) {
  let u = byEmail.get(email)
  if (!u) {
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: meta })
    if (error) fail(`create ${email}`, error)
    u = data.user
  } else if (resetPassword) {
    const { error } = await admin.auth.admin.updateUserById(u.id, { password, user_metadata: meta })
    if (error) fail(`update ${email}`, error)
  }
  // The signup trigger creates the profile; make sure fields match (covers pre-existing users).
  const { error } = await admin.from('profiles').upsert({
    id: u.id, email, name: meta.name, role: meta.role, city: meta.city || '', chapter: meta.chapter || '', bio: meta.bio || '',
  })
  if (error) fail(`profile ${email}`, error)
  return u.id
}

const attendeeId = await ensureUser({
  email: 'demo@codefolio.dev',
  password: 'demo1234',
  resetPassword: true,
  meta: { name: 'Aditi Rao', role: 'attendee', city: 'Bengaluru', bio: 'Frontend dev, hackathon regular, chai enthusiast.' },
})
const organizerId = await ensureUser({
  email: 'organizer@codefolio.dev',
  password: 'organizer1234',
  resetPassword: true,
  meta: {
    name: 'Rahul Verma', role: 'organizer', city: 'Bengaluru', chapter: 'GDG Bengaluru',
    bio: 'Community organizer. I help run meetups, study jams and hack nights.',
  },
})
const sampleIds = []
for (const [name, email] of SAMPLE_ATTENDEES) {
  // Random unusable password: these accounts only exist to own sample bookings.
  sampleIds.push(await ensureUser({ email, password: randomBytes(24).toString('base64url'), meta: { name, role: 'attendee' } }))
}
console.log(`✓ users: demo attendee, demo organizer, ${sampleIds.length} sample attendees`)

// ---------- events ----------
const sampleEventIds = DEMO_EVENTS.map((e) => e.id)
if (RESET) {
  await admin.from('bookings').delete().in('event_id', sampleEventIds)
  await admin.from('events').delete().in('id', sampleEventIds)
  console.log('✓ reset: removed sample events and their bookings')
}

const rows = DEMO_EVENTS.map((e) => ({
  id: e.id,
  title: e.title,
  type: e.type,
  category: e.category,
  mode: e.mode,
  city: e.city,
  venue: e.venue,
  date: day(e.offset),
  start_time: e.time,
  end_time: e.endTime || null,
  organizer_chapter: e.organizerChapter,
  capacity: e.capacity,
  available_seats: e.capacity - e.booked,
  description: e.description,
  image: unsplash(e.image),
  status: 'Published',
  registration_deadline: e.offset > 0 ? day(e.offset - 1) : null,
  requirements: e.requirements,
  learn: e.learn,
  tags: e.tags,
  is_sample: true,
  organizer_name: `${e.organizerChapter} organizing team`,
  organizer_email: 'organizer@codefolio.dev',
  created_by: organizerId,
}))
{
  const { error } = await admin.from('events').upsert(rows, { onConflict: 'id', ignoreDuplicates: true })
  if (error) fail('events', error)
}
console.log(`✓ events: ${rows.length} sample events`)

// ---------- bookings (only if the sample events have none yet) ----------
const { count, error: countErr } = await admin.from('bookings').select('id', { head: true, count: 'exact' }).in('event_id', sampleEventIds)
if (countErr) fail('count bookings', countErr)

if (count === 0) {
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]))
  const snapshot = (r) => ({
    title: r.title, type: r.type, category: r.category, date: r.date, time: r.start_time, venue: r.venue,
    city: r.city, mode: r.mode, organizerChapter: r.organizer_chapter, image: r.image,
  })
  const bookings = []
  const add = (userId, name, email, eventId, seats, status, daysAgo) =>
    bookings.push({
      booking_id: code(), user_id: userId, event_id: eventId, seats, status,
      attendee_name: name, attendee_email: email, event_snapshot: snapshot(byId[eventId]),
      booked_at: new Date(Date.now() - daysAgo * 86400000).toISOString(),
    })

  // The demo attendee's history (these seats are part of each event's pre-booked count).
  add(attendeeId, 'Aditi Rao', 'demo@codefolio.dev', 'cf-101', 1, 'Confirmed', 4)
  add(attendeeId, 'Aditi Rao', 'demo@codefolio.dev', 'cf-103', 1, 'Confirmed', 9)
  add(attendeeId, 'Aditi Rao', 'demo@codefolio.dev', 'cf-107', 2, 'Confirmed', 2)
  add(attendeeId, 'Aditi Rao', 'demo@codefolio.dev', 'cf-090', 1, 'Attended', 55)
  add(attendeeId, 'Aditi Rao', 'demo@codefolio.dev', 'cf-091', 1, 'Attended', 90)

  // Sample attendees spread over ~8 weeks so the admin charts have shape.
  let n = 0
  DEMO_EVENTS.filter((e) => e.offset >= 0).forEach((ev, i) => {
    const k = 2 + ((i * 7) % 4)
    for (let j = 0; j < k; j++) {
      const idx = (n + j) % SAMPLE_ATTENDEES.length
      const [name, email] = SAMPLE_ATTENDEES[idx]
      const status = (n + j) % 11 === 5 ? 'Cancelled' : 'Confirmed'
      add(sampleIds[idx], name, email, ev.id, (n + j) % 3 === 0 ? 2 : 1, status, 1 + ((n * 5 + j * 3) % 52))
    }
    n += k
  })
  // A sample attendee can hold only one active booking per event.
  const seen = new Set()
  const unique = bookings.filter((b) => {
    const key = `${b.user_id}:${b.event_id}:${b.status}`
    if (b.status === 'Confirmed' && seen.has(key)) return false
    seen.add(key)
    return true
  })
  const { error } = await admin.from('bookings').insert(unique)
  if (error) fail('bookings', error)
  console.log(`✓ bookings: ${unique.length} sample bookings`)
} else {
  console.log(`• bookings: ${count} already present, skipped (use --reset to recreate)`)
}

// ---------- storage bucket for event images ----------
{
  const { data } = await admin.storage.getBucket(config.imageBucket)
  if (!data) {
    const { error } = await admin.storage.createBucket(config.imageBucket, { public: true, fileSizeLimit: 2 * 1024 * 1024 })
    if (error) console.warn(`! storage bucket: ${error.message} (uploads will retry creating it)`)
    else console.log(`✓ storage: created public bucket "${config.imageBucket}"`)
  } else {
    console.log(`• storage: bucket "${config.imageBucket}" exists`)
  }
}

console.log('\nDone. Log in with demo@codefolio.dev / demo1234 or organizer@codefolio.dev / organizer1234')
