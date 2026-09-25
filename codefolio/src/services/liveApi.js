// Live GDG Community + Devfolio listings. The API server fetches, filters to
// India, normalizes and caches them (server/src/lib/live.js); the client only
// adds fallback artwork for events without a cover image.
import { fallbackImage } from '../data/images'
import { liveDevfolio, liveGdg, liveGdgDetail } from './api'

const withArt = (e) => ({ ...e, hasRealImage: Boolean(e.image), image: e.image || fallbackImage(e.category, e.id) })

export async function fetchGdgIndiaEvents(force) {
  const res = await liveGdg(force)
  return { ...res, events: res.events.map(withArt) }
}

export async function fetchDevfolioHackathons(force) {
  const res = await liveDevfolio(force)
  return { ...res, events: res.events.map(withArt) }
}

export const fetchGdgDetail = (remoteId) => liveGdgDetail(remoteId)

export function applyGdgDetail(event, patch) {
  return withArt({
    ...event,
    ...patch,
    venue: patch.venue || event.venue,
    image: patch.image || (event.hasRealImage ? event.image : null),
    enriched: true,
  })
}
