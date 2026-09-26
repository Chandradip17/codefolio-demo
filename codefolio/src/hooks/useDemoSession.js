import { useCallback, useEffect, useState } from 'react'
import { useData } from '../context/DataContext'
import * as api from '../services/api'
import { useNow } from './useNow'

// Demo Day state for one hackathon. The server owns the clock: every state
// carries `serverNow`, and the countdown is derived from the phase's start
// timestamp, the paused time and the server/client clock offset — so every
// screen (organizer, judges, presentation) shows the same remaining time.
export function useDemoSession(eventId) {
  const { subscribe } = useData()
  const [state, setState] = useState(null)
  const [error, setError] = useState(null)
  const [offset, setOffset] = useState(0)

  const accept = useCallback((s) => {
    setOffset(Date.parse(s.serverNow) - Date.now())
    setState((prev) => ({ ...s, role: s.role || prev?.role, candidates: s.candidates || prev?.candidates }))
  }, [])

  const load = useCallback(async () => {
    try {
      accept(await api.demoState(eventId))
      setError(null)
    } catch (e) {
      setError(e)
    }
  }, [eventId, accept])

  useEffect(() => {
    load()
    // Realtime pushes are primary; a slow poll covers a dropped stream.
    const t = setInterval(load, 30000)
    return () => clearInterval(t)
  }, [load])

  useEffect(() => subscribe((type, data) => type === 'demo.updated' && data?.event?.id === eventId && accept(data)), [subscribe, eventId, accept])

  const s = state?.session
  const ticking = s?.status === 'live' && s.phase !== 'idle' && !s.pausedAt
  const now = useNow(ticking ? 250 : null) + offset

  let timer = null
  if (s && s.phase !== 'idle' && s.phaseStartedAt) {
    const duration = s.phase === 'qa' ? s.qaSeconds : s.presentationSeconds
    const end = s.pausedAt ? Date.parse(s.pausedAt) : now
    const elapsed = Math.max(0, (end - Date.parse(s.phaseStartedAt)) / 1000 - (s.pausedSeconds || 0))
    timer = { duration, elapsed, remaining: Math.max(0, Math.ceil(duration - elapsed)), over: elapsed > duration, paused: Boolean(s.pausedAt), phase: s.phase }
  }
  const current = state?.presentations.find((p) => p.id === s?.currentPresentationId) || null
  const upNext = state?.presentations.find((p) => p.status === 'waiting') || null

  return { state, error, load, accept, timer, current, upNext }
}

export const clock = (sec) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`
