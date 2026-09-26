export const addDays = (d, n) => {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}

// Local-date ISO (YYYY-MM-DD), not UTC — avoids off-by-one for IST evenings.
export const toISODate = (d) => {
  const x = new Date(d)
  const m = String(x.getMonth() + 1).padStart(2, '0')
  const day = String(x.getDate()).padStart(2, '0')
  return `${x.getFullYear()}-${m}-${day}`
}

export const parseDate = (iso) => {
  const [y, m, d] = String(iso).split('-').map(Number)
  return new Date(y, (m || 1) - 1, d || 1)
}

export const todayISO = () => toISODate(new Date())

export function formatDate(iso, opts = {}) {
  if (!iso) return 'TBA'
  return parseDate(iso).toLocaleDateString('en-IN', {
    weekday: opts.weekday ? 'short' : undefined,
    day: 'numeric',
    month: 'short',
    year: opts.year === false ? undefined : 'numeric',
  })
}

export function dateParts(iso) {
  const d = parseDate(iso)
  return {
    day: d.getDate(),
    month: d.toLocaleDateString('en-IN', { month: 'short' }).toUpperCase(),
    weekday: d.toLocaleDateString('en-IN', { weekday: 'short' }),
  }
}

export function formatTime(hhmm) {
  if (!hhmm) return 'TBA'
  const [h, m] = hhmm.split(':').map(Number)
  const suffix = h >= 12 ? 'PM' : 'AM'
  const hr = h % 12 || 12
  return `${hr}:${String(m).padStart(2, '0')} ${suffix}`
}

export function formatDateTime(isoString) {
  return new Date(isoString).toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function timeAgo(ts) {
  const s = Math.round((Date.now() - ts) / 1000)
  if (s < 45) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  return `${Math.round(m / 60)} h ago`
}

export function dateBucketMatch(iso, bucket) {
  if (!bucket || bucket === 'All') return true
  const d = parseDate(iso)
  const today = parseDate(todayISO())
  if (d < today) return false
  if (bucket === 'Upcoming') return true
  if (bucket === 'This Week') return d <= addDays(today, 7)
  if (bucket === 'This Month') return d.getMonth() === today.getMonth() && d.getFullYear() === today.getFullYear()
  return true
}

export const isPast = (iso) => parseDate(iso) < parseDate(todayISO())

export const compactNumber = (n) =>
  n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, '')}K` : String(n)

export const cx = (...args) => args.filter(Boolean).join(' ')

// Date + time in the hackathons' timezone (IST), whatever the viewer's device is set to.
export function formatIST(isoString) {
  return `${new Date(isoString).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })} IST`
}
// "YYYY-MM-DDTHH:mm" typed as IST → ISO string.
export const istInputToISO = (v) => (v ? new Date(`${v}:00+05:30`).toISOString() : null)
// ISO → "YYYY-MM-DDTHH:mm" in IST (for datetime-local inputs).
export const isoToISTInput = (iso) => (iso ? new Date(Date.parse(iso) + 5.5 * 3600000).toISOString().slice(0, 16) : '')
