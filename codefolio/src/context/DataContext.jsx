import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import * as api from '../services/api'
import { applyGdgDetail, fetchDevfolioHackathons, fetchGdgDetail, fetchGdgIndiaEvents } from '../services/liveApi'
import { isPast, todayISO } from '../utils/format'
import { useAuth } from './AuthContext'

const DataContext = createContext(null)
const REFRESH_MS = 5 * 60 * 1000
// The API warms GDG event details in the background; while some are missing,
// re-poll the (cheap, cached) list instead of fetching ~60 details per browser.
const ENRICH_POLL_MS = 15_000
const ENRICH_POLLS = 4

const idle = { loading: true, error: null, updatedAt: null }

export function DataProvider({ children }) {
  const { user, ready } = useAuth()

  // ---- Codefolio-hosted events & bookings (Express + Supabase) ----
  const [events, setEvents] = useState([])
  const [bookings, setBookings] = useState([])
  const [localStatus, setLocalStatus] = useState({ loading: true, error: null })

  const loadLocal = useCallback(async () => {
    setLocalStatus({ loading: true, error: null })
    try {
      const [ev, bk] = await Promise.all([
        api.listEvents(),
        !user ? [] : user.role === 'organizer' ? api.organizerBookings() : api.myBookings(),
      ])
      setEvents(ev)
      setBookings(bk)
      setLocalStatus({ loading: false, error: null })
    } catch (e) {
      setLocalStatus({ loading: false, error: e.message || 'Something went wrong' })
    }
  }, [user])

  useEffect(() => {
    if (ready) loadLocal()
  }, [ready, loadLocal])

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
    }
  }, [])

  const loadDevfolio = useCallback(async (force) => {
    try {
      const { events: list, updatedAt } = await fetchDevfolioHackathons(force)
      setDevfolio(list)
      setDfStatus({ loading: false, error: null, updatedAt })
    } catch (e) {
      setDfStatus((s) => ({ ...s, loading: false, error: e.message }))
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

  const bookEvent = useCallback(async (eventId, seats) => {
    const { booking, event } = await api.createBooking(eventId, seats)
    if (event) replaceEvent(event)
    setBookings((b) => [booking, ...b])
    return booking
  }, [])

  const cancelBooking = useCallback(async (bookingDbId) => {
    const { booking, event } = await api.cancelBooking(bookingDbId)
    if (event) replaceEvent(event)
    setBookings((list) => list.map((b) => (b.id === booking.id ? booking : b)))
    return booking
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
    setBookings((list) =>
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
    setBookings((list) => list.map((b) => (b.eventId === id ? { ...b, eventId: null, status: b.status === 'Confirmed' ? 'Cancelled' : b.status } : b)))
  }, [])

  // Events this organizer owns (the Admin Panel only manages these).
  const myEvents = useMemo(() => (user?.role === 'organizer' ? events.filter((e) => e.createdBy === user.id) : []), [events, user])

  // Public catalogue: upcoming Codefolio events + both live feeds.
  const catalogue = useMemo(() => {
    const local = events.filter((e) => !isPast(e.date))
    const today = todayISO()
    // Upcoming events by start time; already-running ones go after them.
    const key = (e) => `${e.date < today ? '1' : '0'}${e.date}${e.time || ''}`
    return [...local, ...gdg, ...devfolio].sort((a, b) => key(a).localeCompare(key(b)))
  }, [events, gdg, devfolio])

  const getEvent = useCallback((id) => catalogue.find((e) => e.id === id) || events.find((e) => e.id === id), [catalogue, events])

  const myActiveBooking = useCallback(
    (eventId) => user && bookings.find((b) => b.userId === user.id && b.eventId === eventId && b.status === 'Confirmed'),
    [bookings, user],
  )

  const value = {
    events,
    myEvents,
    bookings,
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
    bookEvent,
    cancelBooking,
    createEvent,
    updateEvent,
    cancelEvent,
    deleteEvent,
  }
  return <DataContext.Provider value={value}>{children}</DataContext.Provider>
}

export const useData = () => useContext(DataContext)
