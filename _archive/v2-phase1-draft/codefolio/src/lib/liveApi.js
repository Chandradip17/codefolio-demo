// "Around India": live GDG Community + Devfolio listings, fetched, filtered to
// India and cached by the thin Node service (server/). These are external,
// read-only listings that link out; they are not Codefolio-hosted events.
const BASE = (import.meta.env.VITE_LIVE_API_URL || '/api').replace(/\/$/, '')

async function get(path) {
  let res
  try {
    res = await fetch(BASE + path)
  } catch {
    throw new Error("Can't reach the listings service.")
  }
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new Error(data?.error?.message || `Listings unavailable (${res.status})`)
  return data
}

export async function fetchAroundIndia() {
  const [g, d] = await Promise.allSettled([get('/live/gdg'), get('/live/devfolio')])
  if (g.status === 'rejected' && d.status === 'rejected') throw g.reason
  const events = [...(g.status === 'fulfilled' ? g.value.events : []), ...(d.status === 'fulfilled' ? d.value.events : [])]
  return events.sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')))
}
