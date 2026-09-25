// DB rows (snake_case) ⇄ API objects (the camelCase shapes the React app uses).

const hhmm = (t) => (t ? String(t).slice(0, 5) : null)

export function toEvent(r) {
  return {
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
    mode: input.mode,
    city: input.city,
    venue: input.venue || (input.mode === 'Online' ? 'Online' : ''),
    date: input.date,
    start_time: input.time,
    end_time: input.endTime || null,
    organizer_chapter: input.organizerChapter,
    description: input.description,
    image: input.image || null,
    registration_deadline: input.registrationDeadline || null,
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
  }
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
  }
}

export function toSession(s) {
  return { accessToken: s.access_token, refreshToken: s.refresh_token, expiresAt: s.expires_at }
}
