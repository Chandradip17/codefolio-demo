import EventCard from './EventCard'
import { EmptyState, ErrorState, SkeletonCard } from './ui'

export default function EventGrid({ events, loading, error, onRetry, skeletons = 6, empty, compact }) {
  if (error && !events?.length) return <ErrorState message={error} onRetry={onRetry} />
  if (loading && !events?.length) {
    return (
      <div className="event-grid" aria-busy="true" aria-label="Loading events">
        {Array.from({ length: skeletons }, (_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    )
  }
  if (!events?.length) {
    return empty || <EmptyState title="No events found" message="Try changing your search or filters." />
  }
  return (
    <div className="event-grid">
      {events.map((e) => (
        <EventCard key={e.id} event={e} compact={compact} />
      ))}
    </div>
  )
}
