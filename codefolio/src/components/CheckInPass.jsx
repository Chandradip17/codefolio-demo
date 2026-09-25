import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import Modal, { ConfirmDialog } from './Modal'
import Icon from './Icon'
import { Badge, Button } from './ui'
import { useAuth } from '../context/AuthContext'
import * as api from '../services/api'
import { formatDate, formatDateTime, formatTime } from '../utils/format'

// The QR only carries a random token (no personal details); the server looks
// the token up at check-in and accepts it once, for this event only.
const payload = (token) => `codefolio:ci:${token}`

export default function CheckInPass({ booking, open, onClose }) {
  const { user } = useAuth()
  const [cred, setCred] = useState(null)
  const [qr, setQr] = useState('')
  const [error, setError] = useState('')
  const [askRegen, setAskRegen] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open || !booking) return
    let live = true
    setCred(null)
    setQr('')
    setError('')
    api
      .bookingCredential(booking.id)
      .then((c) => live && setCred(c))
      .catch((e) => live && setError(e.message))
    return () => {
      live = false
    }
  }, [open, booking])

  useEffect(() => {
    if (!cred?.token) return
    let live = true
    QRCode.toDataURL(payload(cred.token), { errorCorrectionLevel: 'M', margin: 1, width: 560, color: { dark: '#14161a', light: '#ffffff' } })
      .then((url) => live && setQr(url))
      .catch(() => live && setError('Could not draw the QR code. Use the manual code instead.'))
    return () => {
      live = false
    }
  }, [cred?.token])

  async function regenerate() {
    setBusy(true)
    try {
      setCred(await api.regenerateCredential(booking.id))
      setAskRegen(false)
    } catch (e) {
      setError(e.message)
      setAskRegen(false)
    } finally {
      setBusy(false)
    }
  }

  if (!booking) return null
  const e = booking.event
  const checkedIn = Boolean(cred?.checkedInAt) || booking.status === 'Attended'

  return (
    <>
      <Modal open={open && !askRegen} onClose={onClose} title="Check-in pass" size="sm" className="qr-modal">
        <div className="qr-pass pass">
          <div className="pass__top">
            <div>
              <p className="eyebrow">Booking ID</p>
              <p className="pass__id">{booking.bookingId}</p>
            </div>
            {checkedIn ? (
              <Badge tone="info" icon="check">
                Checked in
              </Badge>
            ) : (
              <Badge tone="success" icon="checkCircle">
                Ready for check-in
              </Badge>
            )}
          </div>

          <div className="qr-pass__code">
            {error ? (
              <p className="form-error" role="alert">
                <Icon name="alert" size={15} /> {error}
              </p>
            ) : qr ? (
              <img src={qr} alt={`Check-in QR code for ${e.title}`} className={checkedIn ? 'is-used' : undefined} />
            ) : (
              <span className="spinner spinner--lg" aria-label="Loading your QR code" />
            )}
          </div>

          {cred && (
            <div className="qr-pass__manual">
              <span className="muted small">Can&apos;t scan? Give the organizer this code</span>
              <code>{cred.manualCode.replace(/(.{5})(?=.)/, '$1-')}</code>
            </div>
          )}

          <div className="ticket__perf" aria-hidden="true" />
          <dl className="pass__grid">
            <div className="pass__wide">
              <dt>Event</dt>
              <dd>{e.title}</dd>
            </div>
            <div>
              <dt>Date</dt>
              <dd>{formatDate(e.date, { weekday: true })}</dd>
            </div>
            <div>
              <dt>Time</dt>
              <dd>{formatTime(e.time)}</dd>
            </div>
            <div>
              <dt>Participant</dt>
              <dd>{booking.attendeeName || user?.name}</dd>
            </div>
            <div>
              <dt>Seats</dt>
              <dd>{booking.seats}</dd>
            </div>
            {checkedIn && cred?.checkedInAt && (
              <div className="pass__wide">
                <dt>Checked in</dt>
                <dd>{formatDateTime(cred.checkedInAt)}</dd>
              </div>
            )}
          </dl>
        </div>

        <div className="qr-pass__foot">
          <p className="muted small">
            <Icon name="lock" size={13} /> Works only for this event and only once. Don&apos;t share screenshots of it.
          </p>
          {!checkedIn && cred && (
            <Button size="sm" variant="ghost" icon="refresh" onClick={() => setAskRegen(true)}>
              Regenerate QR
            </Button>
          )}
        </div>
      </Modal>

      <ConfirmDialog
        open={open && askRegen}
        onClose={() => setAskRegen(false)}
        onConfirm={regenerate}
        busy={busy}
        tone="info"
        title="Regenerate your QR?"
        confirmLabel="Regenerate"
        cancelLabel="Cancel"
        message={
          <>
            <p>You&apos;ll get a new QR and manual code.</p>
            <p className="muted">The old one stops working immediately. Use this if you think someone else has a copy of it.</p>
          </>
        }
      />
    </>
  )
}
