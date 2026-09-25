import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import jsQR from 'jsqr'
import Icon from '../../components/Icon'
import { Button, EmptyState, ErrorState, Input, Select } from '../../components/ui'
import { useData } from '../../context/DataContext'
import * as api from '../../services/api'
import { cx, formatDate, formatDateTime, todayISO } from '../../utils/format'

const TITLES = {
  'checkin/invalid': 'Invalid QR',
  'checkin/not_found': 'Registration not found',
  'checkin/wrong_event': 'Wrong event',
  'checkin/already': 'Already checked in',
  'checkin/revoked': 'QR revoked',
  'checkin/not_approved': 'Not approved',
  'checkin/event_closed': 'Event closed',
}
const SCAN_EVERY_MS = 180
const SAME_CODE_COOLDOWN_MS = 4000

// Camera → QR text. Uses the browser's BarcodeDetector when there is one,
// otherwise decodes frames with jsQR.
function useScanner({ active, onCode }) {
  const videoRef = useRef(null)
  const [state, setState] = useState('off') // off | starting | on | denied | unsupported | error
  const onCodeRef = useRef(onCode)
  onCodeRef.current = onCode

  useEffect(() => {
    if (!active) return
    if (!navigator.mediaDevices?.getUserMedia) {
      setState('unsupported')
      return
    }
    let stream
    let raf
    let stopped = false
    let last = 0
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    const detector = 'BarcodeDetector' in window ? new window.BarcodeDetector({ formats: ['qr_code'] }) : null

    async function tick(t) {
      if (stopped) return
      raf = requestAnimationFrame(tick)
      const v = videoRef.current
      if (!v || v.readyState < 2 || t - last < SCAN_EVERY_MS) return
      last = t
      try {
        let text = null
        if (detector) {
          const found = await detector.detect(v)
          text = found[0]?.rawValue || null
        } else {
          const w = Math.min(640, v.videoWidth)
          const h = Math.round((v.videoHeight / v.videoWidth) * w)
          canvas.width = w
          canvas.height = h
          ctx.drawImage(v, 0, 0, w, h)
          text = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'dontInvert' })?.data || null
        }
        if (text && !stopped) onCodeRef.current(text)
      } catch {
        /* a frame that failed to decode: keep scanning */
      }
    }

    setState('starting')
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
      .then((s) => {
        if (stopped) return s.getTracks().forEach((tr) => tr.stop())
        stream = s
        const v = videoRef.current
        v.srcObject = s
        v.setAttribute('playsinline', '')
        return v.play().then(() => {
          setState('on')
          raf = requestAnimationFrame(tick)
        })
      })
      .catch((e) => setState(e?.name === 'NotAllowedError' ? 'denied' : 'error'))

    return () => {
      stopped = true
      cancelAnimationFrame(raf)
      stream?.getTracks().forEach((tr) => tr.stop())
      if (videoRef.current) videoRef.current.srcObject = null
      setState('off')
    }
  }, [active])

  return { videoRef, state }
}

export default function AdminCheckIn() {
  const { myEvents, hostBookings, markAttended, localStatus, loadLocal } = useData()
  const today = todayISO()
  const options = useMemo(
    () =>
      myEvents
        .filter((e) => e.status !== 'Cancelled')
        .sort((a, b) => {
          // Today / upcoming first (soonest first), then past (latest first).
          const pa = (a.endDate || a.date) < today
          const pb = (b.endDate || b.date) < today
          return pa !== pb ? (pa ? 1 : -1) : pa ? b.date.localeCompare(a.date) : a.date.localeCompare(b.date)
        }),
    [myEvents, today],
  )
  const [eventId, setEventId] = useState('')
  useEffect(() => {
    if (!eventId && options.length) setEventId(options[0].id)
  }, [options, eventId])
  const event = options.find((e) => e.id === eventId)

  const [camera, setCamera] = useState(false)
  const [manual, setManual] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null) // { ok, title, message, detail }
  const [attendance, setAttendance] = useState([])
  const [attLoading, setAttLoading] = useState(false)
  const lastScan = useRef({ code: '', at: 0 })
  const busyRef = useRef(false)

  const loadAttendance = useCallback(async () => {
    if (!eventId) return
    setAttLoading(true)
    try {
      setAttendance(await api.eventAttendance(eventId))
    } catch {
      /* the list is secondary; check-in still works */
    } finally {
      setAttLoading(false)
    }
  }, [eventId])

  useEffect(() => {
    setResult(null)
    setAttendance([])
    loadAttendance()
  }, [loadAttendance])

  const submit = useCallback(
    async (code) => {
      if (!eventId || busyRef.current) return
      busyRef.current = true
      setBusy(true)
      try {
        const r = await api.checkIn(eventId, code)
        markAttended(r.bookingDbId)
        setResult({
          ok: true,
          title: 'Checked in',
          message: r.attendeeName,
          detail: `${r.bookingId} · ${r.seats} ${r.seats === 1 ? 'seat' : 'seats'} · ${formatDateTime(r.checkedInAt)}`,
        })
        setManual('')
        loadAttendance()
      } catch (e) {
        setResult({ ok: false, title: TITLES[e.code] || "Couldn't check in", message: e.message })
      } finally {
        busyRef.current = false
        setBusy(false)
      }
    },
    [eventId, markAttended, loadAttendance],
  )

  const onCode = useCallback(
    (text) => {
      const now = Date.now()
      // The same QR stays in view for a while: only send it once per few seconds.
      if (text === lastScan.current.code && now - lastScan.current.at < SAME_CODE_COOLDOWN_MS) return
      lastScan.current = { code: text, at: now }
      submit(text)
    },
    [submit],
  )
  const { videoRef, state } = useScanner({ active: camera && Boolean(eventId), onCode })

  const approved = hostBookings.filter((b) => b.eventId === eventId && (b.status === 'Confirmed' || b.status === 'Attended'))
  const approvedSeats = approved.reduce((s, b) => s + b.seats, 0)
  const inSeats = attendance.reduce((s, a) => s + (a.seats || 0), 0)

  if (localStatus.error && !options.length) return <ErrorState message={localStatus.error} onRetry={loadLocal} />
  if (!localStatus.loading && !options.length) {
    return (
      <>
        <header className="dash-head">
          <div>
            <p className="eyebrow">Event day</p>
            <h1>Check-in</h1>
          </div>
        </header>
        <EmptyState icon="scan" title="No events to check in" message="Create an event first. Approved attendees get a QR you can scan here." />
      </>
    )
  }

  return (
    <>
      <header className="dash-head">
        <div>
          <p className="eyebrow">Event day</p>
          <h1>Check-in</h1>
          <p className="muted">Scan an attendee&apos;s QR or type their manual code. Each registration can check in once, for this event only.</p>
        </div>
      </header>

      <div className="table-tools">
        <Select
          label="Event"
          value={eventId}
          onChange={(e) => setEventId(e.target.value)}
          options={options.map((e) => ({ value: e.id, label: `${e.title} · ${formatDate(e.date, { year: false })}${e.date === today ? ' (today)' : ''}` }))}
        />
      </div>

      <div className="checkin">
        <section className="card checkin__scan" aria-labelledby="scan-h">
          <div className="card__head">
            <h3 id="scan-h">
              <Icon name="camera" size={17} /> Scan QR
            </h3>
            <Button size="sm" variant={camera ? 'secondary' : 'primary'} icon={camera ? 'x' : 'camera'} onClick={() => setCamera((c) => !c)}>
              {camera ? 'Stop camera' : 'Start camera'}
            </Button>
          </div>
          <div className={cx('checkin__video', state === 'on' && 'is-live')}>
            <video ref={videoRef} muted playsInline aria-label="Camera preview" />
            {state !== 'on' && (
              <div className="checkin__placeholder">
                {state === 'starting' ? (
                  <span className="spinner spinner--lg" aria-hidden="true" />
                ) : (
                  <Icon name="scan" size={40} />
                )}
                <p className="small">
                  {
                    {
                      off: 'Start the camera and hold the QR inside the frame.',
                      starting: 'Starting camera…',
                      denied: 'Camera permission was denied. Allow it in the browser, or use the manual code.',
                      unsupported: 'This browser can’t use the camera here. Use the manual code.',
                      error: 'Couldn’t start the camera. Use the manual code.',
                    }[state]
                  }
                </p>
              </div>
            )}
            {state === 'on' && <span className="checkin__frame" aria-hidden="true" />}
          </div>

          <form
            className="checkin__manual"
            onSubmit={(e) => {
              e.preventDefault()
              if (manual.trim()) submit(manual.trim())
            }}
          >
            <Input
              label="Enter code manually"
              placeholder="e.g. 7KQ2M-9XA4P"
              value={manual}
              onChange={(e) => setManual(e.target.value.toUpperCase())}
              autoComplete="off"
              spellCheck={false}
              maxLength={200}
            />
            <Button type="submit" icon="check" loading={busy} disabled={!manual.trim() || !eventId}>
              Check in
            </Button>
          </form>

          <div className={cx('checkin__result', result && (result.ok ? 'is-ok' : 'is-bad'))} role="status" aria-live="assertive">
            {result ? (
              <>
                <span className="checkin__result-icon" aria-hidden="true">
                  <Icon name={result.ok ? 'checkCircle' : 'alert'} size={26} />
                </span>
                <div>
                  <strong>{result.title}</strong>
                  <p>{result.message}</p>
                  {result.detail && <small>{result.detail}</small>}
                </div>
              </>
            ) : (
              <p className="muted small">Results appear here.</p>
            )}
          </div>
        </section>

        <section className="card checkin__list" aria-labelledby="att-h">
          <div className="card__head">
            <h3 id="att-h">Checked in</h3>
            <Button size="sm" variant="ghost" icon="refresh" onClick={loadAttendance} loading={attLoading} aria-label="Refresh attendance" />
          </div>
          <div className="event-summary__nums">
            <span>
              <strong>{attendance.length}</strong> of {approved.length} registrations
            </span>
            <span>
              <strong>{inSeats}</strong> of {approvedSeats} seats
            </span>
            {event && (
              <span>
                <strong>{event.capacity}</strong> capacity
              </span>
            )}
          </div>
          {attendance.length ? (
            <ul className="mini-list">
              {attendance.map((a) => (
                <li key={a.bookingDbId}>
                  <div>
                    <strong>{a.attendeeName}</strong>
                    <small>
                      <code>{a.bookingId}</code> · {a.seats} {a.seats === 1 ? 'seat' : 'seats'}
                    </small>
                  </div>
                  <span className="mini-list__right">
                    <small className="muted">{formatDateTime(a.checkedInAt)}</small>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted small">{attLoading ? 'Loading…' : 'Nobody has checked in yet.'}</p>
          )}
        </section>
      </div>
    </>
  )
}
