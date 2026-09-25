import { isPast } from '../../utils/format'

export function eventStatus(e) {
  if (e.status === 'Cancelled') return 'Cancelled'
  if (isPast(e.date)) return 'Completed'
  if (e.availableSeats <= 0) return 'Sold Out'
  return 'Published'
}
