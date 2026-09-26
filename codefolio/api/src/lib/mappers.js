// DB rows (snake_case) ⇄ API objects (the camelCase shapes the React app uses).

const hhmm = (t) => (t ? String(t).slice(0, 5) : null)

// withPayment: include UPI details (the host's own events, and the application form).
export function toEvent(r, { withPayment = false } = {}) {
  const fee = r.application_fee || 0
  return {
    applicationFee: fee,
    ...(withPayment && fee > 0 ? { payment: { upiId: r.upi_id, upiNumber: r.upi_number, qrUrl: r.upi_qr_url } } : {}),
    id: r.id,
    source: 'codefolio',
    title: r.title,
    type: r.type,
    category: r.category,
    mode: r.mode,
    city: r.city,
    venue: r.venue,
    date: r.date,
    time: hhmm(r.start_time),
    endTime: hhmm(r.end_time),
    endDate: r.end_date || null,
    hybrid: Boolean(r.hybrid),
    applicationsOpenAt: r.applications_open_at || null,
    applicationsCloseAt: r.applications_close_at || null,
    theme: r.theme || null,
    teamMin: r.team_min ?? null,
    teamMax: r.team_max ?? null,
    resultsPublishedAt: r.results_published_at || null,
    teamSize: r.team_min && r.team_max ? (r.team_min === r.team_max ? `${r.team_min}` : `${r.team_min}–${r.team_max}`) : null,
    organizerChapter: r.organizer_chapter,
    capacity: r.capacity,
    availableSeats: r.available_seats,
    description: r.description,
    image: r.image,
    status: r.status,
    registrationDeadline: r.registration_deadline,
    requirements: r.requirements || [],
    learn: r.learn || [],
    tags: r.tags || [],
    isSample: r.is_sample,
    organizer: { name: r.organizer_name, email: r.organizer_email },
    createdBy: r.created_by,
    createdAt: r.created_at,
  }
}

// Validated input → writable columns (capacity/seats are handled separately).
export function eventColumns(input) {
  return {
    title: input.title,
    type: input.category === 'hackathon' ? 'Hackathon' : 'Event',
    category: input.category,
    // Hybrid is stored as In-person + hybrid flag, so existing mode filters keep working.
    mode: input.mode === 'Hybrid' ? 'In-person' : input.mode,
    hybrid: input.mode === 'Hybrid',
    status: input.status,
    city: input.city,
    venue: input.venue || (input.mode === 'Online' ? 'Online' : ''),
    date: input.date,
    start_time: input.time,
    end_time: input.endTime || null,
    end_date: input.endDate || null,
    applications_open_at: input.applicationsOpenAt || null,
    applications_close_at: input.applicationsCloseAt || null,
    theme: input.theme || null,
    team_min: input.teamMin ?? null,
    team_max: input.teamMax ?? null,
    application_fee: input.applicationFee || 0,
    upi_id: input.applicationFee > 0 ? input.upiId : null,
    upi_number: input.applicationFee > 0 ? input.upiNumber : null,
    upi_qr_url: input.applicationFee > 0 ? input.upiQrUrl : null,
    organizer_chapter: input.organizerChapter,
    description: input.description,
    image: input.image || null,
    // The application deadline (IST date) doubles as the v1 "Registration closes" date.
    registration_deadline: input.applicationsCloseAt
      ? new Date(input.applicationsCloseAt).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })
      : input.registrationDeadline || null,
    requirements: input.requirements,
    learn: input.learn,
    tags: input.tags,
  }
}

export function toBooking(r) {
  return {
    id: r.id,
    bookingId: r.booking_id,
    userId: r.user_id,
    eventId: r.event_id,
    seats: r.seats,
    status: r.status,
    attendeeName: r.attendee_name,
    attendeeEmail: r.attendee_email,
    event: r.event_snapshot,
    bookedAt: r.booked_at,
    reviewedAt: r.reviewed_at || null,
    reviewNote: r.review_note || null,
    participation: r.participation || null,
    feeAmount: r.fee_amount ?? null,
    paymentRef: r.payment_ref || null,
    paymentProof: r.payment_proof ? { name: r.payment_proof.name, size: r.payment_proof.size, type: r.payment_proof.type } : null,
    team: r.team ? toTeam(r.team) : null,
  }
}

// Embedded select for a booking's team (members with names, oldest first).
export const TEAM_SELECT =
  'team:teams!bookings_team_id_fkey(id, name, code, leader_id, event_id, members:team_members(user_id, joined_at, profile:profiles!team_members_user_id_fkey(name, username)))'

export function toTeam(t) {
  const members = [...(t.members || [])]
    .sort((a, b) => String(a.joined_at).localeCompare(String(b.joined_at)))
    .map((m) => ({ userId: m.user_id, name: m.profile?.name || 'Member', username: m.profile?.username || null, leader: m.user_id === t.leader_id }))
  return { id: t.id, name: t.name, code: t.code, eventId: t.event_id, leaderId: t.leader_id, members, size: members.length }
}

export function toUser(r) {
  return {
    id: r.id,
    name: r.name,
    email: r.email,
    role: r.role,
    city: r.city,
    chapter: r.chapter,
    bio: r.bio,
    createdAt: r.created_at,
    username: r.username || null,
    avatarUrl: r.avatar_url || null,
    isAdmin: r.platform_role === 'admin',
    isJudge: Boolean(r.is_judge),
  }
}

export function toSession(s) {
  return { accessToken: s.access_token, refreshToken: s.refresh_token, expiresAt: s.expires_at }
}
