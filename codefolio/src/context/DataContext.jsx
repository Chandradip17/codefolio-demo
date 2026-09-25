import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import * as api from '../services/api'
import { applyGdgDetail, fetchDevfolioHackathons, fetchGdgDetail, fetchGdgIndiaEvents } from '../services/liveApi'
import { connectStream } from '../services/realtime'
import { isPast, todayISO } from '../utils/format'
import { useAuth } from './AuthContext'
import { useToast } from './ToastContext'
import { diffBooking, diffEvent, seedActivity } from './liveDiff'

const DataContext = createContext(null)
const REFRESH_MS = 5 * 60 * 1000
// The API warms GDG event details in the background; while some are missing,
// re-poll the (cheap, cached) list instead of fetching ~60 details per browser.
const ENRICH_POLL_MS = 15_000
const ENRICH_POLLS = 4
const RETRY_MS = 15_000

const idle = { loading: true, error: null, updatedAt: null }
const MAX_ACTIVITY = 40

const upsert = (list, item) => {
  const i = list.findIndex((x) => x.id === item.id)
  if (i === -1) return [...list, item]
  const next = list.slice()
  next[i] = item
  return next
}

export function DataProvider({ children }) {
  const { user, ready, refreshUser } = useAuth()
  const toast = useToast()

  // ---- Codefolio-hosted events & bookings (Express + Supabase) ----
  const [events, setEvents] = useState([])
  const [bookings, setBookings] = useState([]) // the signed-in member's own requests/tickets
  const [hostBookings, setHostBookings] = useState([]) // applications to events this host runs
  const [localStatus, setLocalStatus] = useState({ loading: true, error: null })

  const loadLocal = useCallback(
    async ({ silent = false } = {}) => {
      if (!silent) setLocalStatus({ loading: true, error: null })
      try {
        const host = user && (user.role === 'organizer' || user.isAdmin)
        const [ev, bk, hbk] = await Promise.all([api.listEvents(), user ? api.myBookings() : [], host ? api.organizerBookings() : []])
        setEvents(ev)
        setBookings(bk)
        setHostBookings(hbk)
        setLocalStatus({ loading: false, error: null })
        return [...bk, ...hbk.filter((b) => b.userId !== user?.id)]
      } catch (e) {
        if (!silent) setLocalStatus({ loading: false, error: e.message || 'Something went wrong' })
        return null
      }
    },
    [user],
  )

  // ---- Realtime (SSE from the API) + activity feed ----
  const [live, setLive] = useState({ status: 'connecting', lastEventAt: null, connectedAt: null })
  const [activity, setActivity] = useState([])
  const seenKeys = useRef(new Set())
  const seededFor = useRef(null)
  const stateRef = useRef({})
  stateRef.current = { events, bookings, hostBookings, user }

  const pushActivity = useCallback(
    (items, { notify = true } = {}) => {
      const fresh = items.filter((it) => !seenKeys.current.has(it.key))
      if (!fresh.length) return
      fresh.forEach((it) => seenKeys.current.add(it.key))
      const now = Date.now()
      setActivity((cur) => [...fresh.map((it) => ({ at: now, ...it, id: `${it.key}:${now}` })), ...cur].slice(0, MAX_ACTIVITY))
      if (notify && document.visibilityState === 'visible') {
        for (const it of fresh.filter((x) => x.toast)) {
          toast({ title: it.title, message: it.text, tone: it.tone === 'danger' ? 'error' : it.tone === 'success' ? 'success' : 'info' })
        }
      }
    },
    [toast],
  )

  useEffect(() => {
    if (!ready) return
    loadLocal().then((bk) => {
      if (!user) {
        seededFor.current = null
        setActivity([])
        return
      }
      // Seed the feed once per signed-in user with their recent history.
      if (bk && seededFor.current !== user.id) {
        seededFor.current = user.id
        seenKeys.current = new Set()
        const seed = seedActivity(bk, user)
        seed.forEach((it) => seenKeys.current.add(it.key))
        setActivity(seed.map((it) => ({ ...it, id: it.key })))
      }
    })
  }, [ready, loadLocal, user])

  const handleMessage = useCallback(
    (type, data) => {
      if (type === 'hello') return
      const { events: evs, bookings: bks, hostBookings: hbks, user: me } = stateRef.current
      setLive((l) => ({ ...l, lastEventAt: Date.now() }))
      const myEventIds = new Set(bks.filter((b) => ['Pending', 'Confirmed'].includes(b.status)).map((b) => b.eventId))

      if (type === 'event.updated') {
        const ev = data.event
        const prev = evs.find((e) => e.id === ev.id)
        setEvents((list) => upsert(list, ev))
        pushActivity(diffEvent(prev, ev, { me, myEventIds, myCity: me?.city }))
      } else if (type === 'event.deleted') {
        const prev = evs.find((e) => e.id === data.id)
        setEvents((list) => list.filter((e) => e.id !== data.id))
        if (prev && myEventIds.has(data.id) && prev.createdBy !== me?.id) {
          pushActivity([{ key: `del:${data.id}`, tone: 'danger', icon: 'trash', title: `${prev.title} was removed`, text: 'The organizer deleted this event.', toast: true }])
        }
      } else if (type === 'booking.updated') {
        const b = data.booking
        if (me && b.userId === me.id) {
          const prev = bks.find((x) => x.id === b.id)
          setBookings((list) => upsert(list, b))
          pushActivity(diffBooking(prev, b, { me }))
        }
        const hosted = hbks.some((x) => x.id === b.id) || evs.some((e) => e.id === b.eventId && e.createdBy === me?.id)
        if (hosted) {
          const prev = hbks.find((x) => x.id === b.id)
          setHostBookings((list) => upsert(list, b))
          if (b.userId !== me?.id) pushActivity(diffBooking(prev, b, { me }))
        }
      } else if (type === 'host.request.updated') {
        const r = data.request
        const ok = r.status === 'approved'
        pushActivity([
          {
            key: `host:${r.id}:${r.status}`,
            tone: ok ? 'success' : 'danger',
            icon: ok ? 'checkCircle' : 'ban',
            title: ok ? 'You’re now a Codefolio host 🎉' : 'Host request not approved',
            text: ok ? 'You can create events from the Admin Panel.' : r.reviewNote || 'You can update your details and apply again.',
            toast: true,
          },
        ])
        refreshUser()
      }
    },
    [pushActivity, refreshUser],
  )

  useEffect(() => {
    if (!ready) return
    const conn = connectStream({
      authed: Boolean(user),
      onMessage: handleMessage,
      onStatus: (status, extra) => {
        setLive((l) => ({ ...l, status, connectedAt: status === 'live' ? Date.now() : l.connectedAt }))
        // Anything that happened while disconnected: catch up quietly.
        if (status === 'live' && extra?.reconnected) loadLocal({ silent: true })
      },
    })
    return () => conn.close()
    // Reconnect only when the signed-in identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, user?.id])

  // ---- Live feeds (via the API) ----
  const [gdg, setGdg] = useState([])
  const [devfolio, setDevfolio] = useState([])
  const [gdgStatus, setGdgStatus] = useState(idle)
  const [dfStatus, setDfStatus] = useState(idle)
  const pollTimer = useRef(null)

  const loadGdg = useCallback(async (force, pollsLeft = ENRICH_POLLS) => {
    clearTimeout(pollTimer.current)
    try {
      const { events: list, updatedAt } = await fetchGdgIndiaEvents(force)
      // Keep details already fetched on demand (modal) if the new list lacks them.
      setGdg((cur) => {
        const prev = new Map(cur.filter((e) => e.enriched).map((e) => [e.id, e]))
        return list.map((e) => (!e.enriched && prev.has(e.id) ? prev.get(e.id) : e))
      })
      setGdgStatus({ loading: false, error: null, updatedAt })
      if (pollsLeft > 0 && list.some((e) => !e.enriched)) {
        pollTimer.current = setTimeout(() => loadGdg(false, pollsLeft - 1), ENRICH_POLL_MS)
      }
    } catch (e) {
      setGdgStatus((s) => ({ ...s, loading: false, error: e.message }))
      // Transient failures (e.g. the API restarting): try again soon, not in 5 minutes.
      if (pollsLeft > 0) pollTimer.current = setTimeout(() => loadGdg(false, pollsLeft - 1), RETRY_MS)
    }
  }, [])

  const dfRetry = useRef(null)
  const loadDevfolio = useCallback(async (force, retriesLeft = ENRICH_POLLS) => {
    clearTimeout(dfRetry.current)
    try {
      const { events: list, updatedAt } = await fetchDevfolioHackathons(force)
      setDevfolio(list)
      setDfStatus({ loading: false, error: null, updatedAt })
    } catch (e) {
      setDfStatus((s) => ({ ...s, loading: false, error: e.message }))
      if (retriesLeft > 0) dfRetry.current = setTimeout(() => loadDevfolio(false, retriesLeft - 1), RETRY_MS)
    }
  }, [])

  const refreshLive = useCallback(
    async ({ force = false } = {}) => {
      setGdgStatus((s) => ({ ...s, loading: true, error: null }))
      setDfStatus((s) => ({ ...s, loading: true, error: null }))
      await Promise.all([loadGdg(force), loadDevfolio(force)])
    },
    [loadGdg, loadDevfolio],
  )

  useEffect(() => {
    refreshLive()
    const t = setInterval(() => refreshLive(), REFRESH_MS)
    return () => {
      clearInterval(t)
      clearTimeout(pollTimer.current)
      clearTimeout(dfRetry.current)
    }
  }, [refreshLive])

  // Fetch one GDG event's detail right away (e.g. when its modal opens).
  const ensureDetail = useCallback(async (ev) => {
    if (!ev || ev.source !== 'gdg' || ev.enriched) return
    try {
      const patch = await fetchGdgDetail(ev.remoteId)
      setGdg((cur) => cur.map((x) => (x.id === ev.id ? applyGdgDetail(x, patch) : x)))
    } catch {
      /* modal falls back to list-level data */
    }
  }, [])

  // ---- actions ----
  const replaceEvent = (ev) => setEvents((list) => list.map((e) => (e.id === ev.id ? ev : e)))

  // Sends an application; the host approves it before any seat is taken.
  const bookEvent = useCallback(async (eventId, seats, answers) => {
    const { booking, event } = await api.createBooking(eventId, seats, answers)
    if (event) replaceEvent(event)
    setBookings((b) => [booking, ...b.filter((x) => x.id !== booking.id)])
    pushActivity(
      [{ key: `bk:${booking.id}:p`, tone: 'info', icon: 'ticket', title: `You applied to ${booking.event.title}`, text: `${booking.bookingId} · waiting for the organizer`, eventId }],
      { notify: false },
    )
    return booking
  }, [pushActivity])

  const cancelBooking = useCallback(async (bookingDbId) => {
    const wasPending = stateRef.current.bookings.find((b) => b.id === bookingDbId)?.status === 'Pending'
    const { booking, event } = await api.cancelBooking(bookingDbId)
    if (event) replaceEvent(event)
    setBookings((list) => list.map((b) => (b.id === booking.id ? booking : b)))
    pushActivity(
      [
        {
          key: `bk:${booking.id}:x`,
          tone: 'muted',
          icon: 'ban',
          title: wasPending ? `You withdrew your request for ${booking.event.title}` : `You cancelled ${booking.event.title}`,
          text: wasPending ? booking.bookingId : `${booking.bookingId} · seats released`,
          eventId: booking.eventId,
        },
      ],
      { notify: false },
    )
    return booking
  }, [pushActivity])

  // Host side: approve / reject / remove an application.
  const reviewBooking = useCallback(async (bookingDbId, action, note) => {
    const { booking, event } = await api.reviewBooking(bookingDbId, action, note)
    if (event) replaceEvent(event)
    setHostBookings((list) => upsert(list, booking))
    return booking
  }, [])

  // Host side: a successful check-in marks the booking Attended right away.
  const markAttended = useCallback((bookingDbId) => {
    setHostBookings((list) => list.map((b) => (b.id === bookingDbId ? { ...b, status: 'Attended' } : b)))
  }, [])

  const createEvent = useCallback(async (input) => {
    const ev = await api.createEvent(input)
    setEvents((list) => [...list, ev])
    return ev
  }, [])

  const updateEvent = useCallback(async (id, input) => {
    const ev = await api.updateEvent(id, input)
    replaceEvent(ev)
    // Booking snapshots are refreshed server-side; pull them so the lists match.
    setHostBookings((list) =>
      list.map((b) =>
        b.eventId === id
          ? { ...b, event: { ...b.event, title: ev.title, date: ev.date, time: ev.time, venue: ev.venue, city: ev.city, mode: ev.mode, category: ev.category, organizerChapter: ev.organizerChapter, image: ev.image } }
          : b,
      ),
    )
    return ev
  }, [])

  const cancelEvent = useCallback(async (id) => {
    const ev = await api.cancelEvent(id)
    replaceEvent(ev)
    return ev
  }, [])

  const deleteEvent = useCallback(async (id) => {
    await api.deleteEvent(id)
    setEvents((list) => list.filter((e) => e.id !== id))
    setHostBookings((list) =>
      list.map((b) => (b.eventId === id ? { ...b, eventId: null, status: ['Confirmed', 'Pending'].includes(b.status) ? 'Cancelled' : b.status } : b)),
    )
  }, [])

  // Events this organizer owns (the Admin Panel only manages these).
  const myEvents = useMemo(() => (user ? events.filter((e) => e.createdBy === user.id) : []), [events, user])

  // Public catalogue: upcoming Codefolio events + both live feeds.
  const catalogue = useMemo(() => {
    const local = events.filter((e) => !isPast(e.date))
    const today = todayISO()
    // Upcoming events by start time; already-running ones go after them.
    const key = (e) => `${e.date < today ? '1' : '0'}${e.date}${e.time || ''}`
    return [...local, ...gdg, ...devfolio].sort((a, b) => key(a).localeCompare(key(b)))
  }, [events, gdg, devfolio])

  const getEvent = useCallback((id) => catalogue.find((e) => e.id === id) || events.find((e) => e.id === id), [catalogue, events])

  // The member's live application/ticket for an event (Pending, Confirmed or Attended).
  const myActiveBooking = useCallback(
    (eventId) => user && bookings.find((b) => b.userId === user.id && b.eventId === eventId && ['Pending', 'Confirmed', 'Attended'].includes(b.status)),
    [bookings, user],
  )
  // Their most recent one of any status (so the modal can say "not approved last time").
  const myLastBooking = useCallback((eventId) => user && bookings.find((b) => b.userId === user.id && b.eventId === eventId), [bookings, user])

  const value = {
    live,
    activity,
    events,
    myEvents,
    bookings,
    hostBookings,
    catalogue,
    gdg,
    devfolio,
    localStatus,
    gdgStatus,
    dfStatus,
    loadLocal,
    refreshLive,
    ensureDetail,
    getEvent,
    myActiveBooking,
    myLastBooking,
    bookEvent,
    cancelBooking,
    reviewBooking,
    markAttended,
    createEvent,
    updateEvent,
    cancelEvent,
    deleteEvent,
  }
  return <DataContext.Provider value={value}>{children}</DataContext.Provider>
}

export const useData = () => useContext(DataContext)
