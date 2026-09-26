import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import Icon from '../components/Icon'
import Modal from '../components/Modal'
import { Badge, Button, EmptyState, ErrorState, Select, Textarea } from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { useData } from '../context/DataContext'
import { useToast } from '../context/ToastContext'
import { useNow } from '../hooks/useNow'
import * as api from '../services/api'
import { cx, formatDate } from '../utils/format'

const REASONS = [
  { value: 'spam', label: 'Spam' },
  { value: 'harassment', label: 'Harassment or hate' },
  { value: 'inappropriate', label: 'Inappropriate content' },
  { value: 'off_topic', label: 'Off-topic' },
  { value: 'other', label: 'Something else' },
]
const time = (iso) => new Date(iso).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit' })
const day = (iso) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })

function ReportDialog({ message, onClose, onDone }) {
  const toast = useToast()
  const [reason, setReason] = useState('spam')
  const [details, setDetails] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    try {
      await api.reportChatMessage(message.id, reason, details.trim())
      toast({ title: 'Report sent', message: 'The organizers will review it. Thanks for keeping the chat friendly.' })
      onDone(message.id)
    } catch (x) {
      toast({ title: 'Couldn’t report', message: x.message, tone: 'error' })
      if (x.code === 'chat/already_reported') onDone(message.id)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      open
      onClose={onClose}
      title="Report message"
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="report-form" variant="danger" icon="alert" loading={busy}>
            Report
          </Button>
        </>
      }
    >
      <form id="report-form" className="form-stack" onSubmit={submit} noValidate>
        <blockquote className="chat-quote">
          <strong>{message.name}</strong>
          <span className="pre-line">{message.message}</span>
        </blockquote>
        <Select label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} options={REASONS} />
        <Textarea label="Details" rows={3} maxLength={500} value={details} onChange={(e) => setDetails(e.target.value)} hint="Optional · only the organizers see this" />
      </form>
    </Modal>
  )
}

function Room({ eventId }) {
  const { user } = useAuth()
  const { subscribe } = useData()
  const toast = useToast()
  const [data, setData] = useState(null) // { event, room, limits }
  const [messages, setMessages] = useState([]) // oldest → newest
  const [hasMore, setHasMore] = useState(false)
  const [error, setError] = useState(null)
  const [olderBusy, setOlderBusy] = useState(false)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState('')
  const [cooldownUntil, setCooldownUntil] = useState(0)
  const [reporting, setReporting] = useState(null)
  const [removing, setRemoving] = useState('')
  const listRef = useRef(null)
  const stick = useRef(true) // follow new messages only when the reader is at the bottom
  const keepOffset = useRef(null) // preserve position when older messages are prepended

  const load = useCallback(async () => {
    setError(null)
    try {
      const r = await api.chatRoom(eventId)
      setData({ event: r.event, room: r.room, limits: r.limits })
      setMessages([...r.messages].reverse())
      setHasMore(r.hasMore)
      setCooldownUntil(r.room.cooldownLeft ? Date.now() + r.room.cooldownLeft * 1000 : 0)
      stick.current = true
    } catch (e) {
      setError(e)
    }
  }, [eventId])
  useEffect(() => {
    load()
  }, [load])

  // Live: only new messages / removals / room + mute changes. History is never reloaded.
  useEffect(
    () =>
      subscribe((type, d) => {
        if (d?.eventId !== eventId) return
        if (type === 'chat.message') setMessages((list) => (list.some((m) => m.id === d.message.id) ? list : [...list, d.message]))
        else if (type === 'chat.deleted') setMessages((list) => list.map((m) => (m.id === d.id ? { ...m, deleted: true, message: null } : m)))
        else if (type === 'chat.room') setData((x) => x && { ...x, room: { ...x.room, active: d.active } })
        else if (type === 'chat.muted') setData((x) => x && { ...x, room: { ...x.room, mutedUntil: d.mutedUntil } })
      }),
    [subscribe, eventId],
  )

  useLayoutEffect(() => {
    const el = listRef.current
    if (!el) return
    if (keepOffset.current != null) {
      el.scrollTop = el.scrollHeight - keepOffset.current
      keepOffset.current = null
    } else if (stick.current) el.scrollTop = el.scrollHeight
  }, [messages])

  // Fast ticks while a cooldown runs; slow ticks otherwise (so a mute ends on screen too).
  const [ticking, setTicking] = useState(false)
  useEffect(() => {
    if (!cooldownUntil) return
    setTicking(true)
    const t = setTimeout(() => setTicking(false), Math.max(0, cooldownUntil - Date.now()) + 300)
    return () => clearTimeout(t)
  }, [cooldownUntil])
  const now = useNow(ticking ? 250 : 15000)
  const cooldownLeft = Math.max(0, Math.ceil((cooldownUntil - now) / 1000))

  async function loadOlder() {
    if (!messages.length) return
    setOlderBusy(true)
    try {
      const r = await api.chatOlder(eventId, messages[0].id)
      keepOffset.current = listRef.current ? listRef.current.scrollHeight - listRef.current.scrollTop : null
      setMessages((list) => [...[...r.messages].reverse().filter((m) => !list.some((x) => x.id === m.id)), ...list])
      setHasMore(r.hasMore)
    } catch (e) {
      toast({ title: 'Couldn’t load older messages', message: e.message, tone: 'error' })
    } finally {
      setOlderBusy(false)
    }
  }

  async function send(e) {
    e?.preventDefault()
    const raw = text
    const body = raw.trim()
    if (!body || sending || cooldownLeft) return
    setSending(true)
    setSendError('')
    try {
      const r = await api.sendChatMessage(eventId, body)
      stick.current = true
      setMessages((list) => (list.some((m) => m.id === r.message.id) ? list : [...list, r.message]))
      // Clear only what was sent; keep anything typed while it was sending.
      setText((cur) => (cur.startsWith(raw) ? cur.slice(raw.length).trimStart() : cur))
      setCooldownUntil(Date.now() + r.cooldownSeconds * 1000)
    } catch (x) {
      setSendError(x.message)
      // The server is the authority: take its remaining wait.
      if (x.retryAfter) setCooldownUntil(Date.now() + x.retryAfter * 1000)
      if (x.code === 'chat/muted' || x.code === 'chat/closed' || x.code === 'chat/read_only') load()
    } finally {
      setSending(false)
    }
  }

  async function remove(m) {
    setRemoving(m.id)
    try {
      await api.deleteChatMessage(m.id)
      setMessages((list) => list.map((x) => (x.id === m.id ? { ...x, deleted: true, message: null } : x)))
      toast({ title: 'Message removed', tone: 'info' })
    } catch (e) {
      toast({ title: 'Couldn’t remove', message: e.message, tone: 'error' })
    } finally {
      setRemoving('')
    }
  }

  if (error) {
    return error.status === 404 ? (
      <EmptyState
        icon="lock"
        title="Chat not available"
        message="The participant chat is only for people registered in this hackathon."
        action={
          <Button to="/hackathons/chat" variant="secondary" icon="arrowLeft">
            My hackathon chats
          </Button>
        }
      />
    ) : (
      <ErrorState message={error.message} onRetry={load} />
    )
  }
  if (!data) return <div className="skeleton" style={{ height: 480, borderRadius: 20 }} />

  const { room, limits } = data
  const muted = room.mutedUntil && Date.parse(room.mutedUntil) > now
  const canPost = room.participant && room.active && !room.readOnly && !muted
  const notice = !room.active
    ? { tone: 'warn', icon: 'lock', text: 'Participant chat is currently closed. You can still view previous messages.' }
    : room.readOnly
      ? { tone: 'info', icon: 'lock', text: 'This hackathon has ended, so the chat is read-only. The history stays available.' }
      : muted
        ? { tone: 'warn', icon: 'ban', text: `A moderator has paused your messages until ${time(room.mutedUntil)} IST. You can still read the chat.` }
        : !room.participant
          ? { tone: 'info', icon: 'eye', text: 'You’re viewing as a moderator. Participants post here; use announcements for official updates.' }
          : null

  let lastDay = ''
  return (
    <section className="card chat" aria-label={`${data.event.title} participant chat`}>
      <div className="card__head">
        <h3>
          <Icon name="users" size={17} /> {data.event.title}
        </h3>
        <span className="chat__badges">
          {room.moderator && <Badge tone="info">Moderator</Badge>}
          <Badge tone={room.active && !room.readOnly ? 'success' : 'neutral'} icon={room.active && !room.readOnly ? 'radio' : 'lock'}>
            {!room.active ? 'Closed' : room.readOnly ? 'Read-only' : 'Open'}
          </Badge>
        </span>
      </div>

      <div
        className="chat__list"
        ref={listRef}
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        onScroll={(e) => {
          const el = e.currentTarget
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60
        }}
      >
        {hasMore && (
          <div className="chat__older">
            <Button size="sm" variant="ghost" icon="arrowUp" onClick={loadOlder} loading={olderBusy}>
              Load older messages
            </Button>
          </div>
        )}
        {!messages.length ? (
          <EmptyState icon="users" title="No messages yet" message="Start the conversation with other participants." />
        ) : (
          messages.map((m) => {
            const d = day(m.createdAt)
            const divider = d !== lastDay
            lastDay = d
            const mine = m.userId === user.id
            return (
              <div key={m.id}>
                {divider && <p className="chat__day small muted">{formatDate(d, { weekday: true })}</p>}
                <article className={cx('chat-msg', mine && 'chat-msg--mine', m.deleted && 'is-removed')}>
                  <span className="avatar chat-msg__avatar" aria-hidden="true">
                    {m.avatarUrl ? <img src={m.avatarUrl} alt="" referrerPolicy="no-referrer" /> : (m.name || '?').slice(0, 1)}
                  </span>
                  <div className="chat-msg__body">
                    <div className="chat-msg__meta">
                      {m.username ? (
                        <Link className="link" to={`/profile/${m.username}`}>
                          <strong>{mine ? 'You' : m.name}</strong>
                        </Link>
                      ) : (
                        <strong>{mine ? 'You' : m.name}</strong>
                      )}
                      <time className="small muted" dateTime={m.createdAt}>
                        {time(m.createdAt)}
                      </time>
                    </div>
                    {m.deleted ? <p className="small muted chat-msg__text">This message was removed by a moderator.</p> : <p className="pre-line chat-msg__text">{m.message}</p>}
                  </div>
                  {!m.deleted && (
                    <span className="chat-msg__actions">
                      {room.moderator && (
                        <Button size="sm" variant="danger-ghost" icon="trash" aria-label="Remove message" title="Remove message" onClick={() => remove(m)} loading={removing === m.id} />
                      )}
                      {room.participant && !mine && (
                        <Button
                          size="sm"
                          variant="ghost"
                          icon="alert"
                          aria-label={m.reportedByMe ? 'Reported' : 'Report message'}
                          title={m.reportedByMe ? 'You reported this message' : 'Report message'}
                          disabled={m.reportedByMe}
                          onClick={() => setReporting(m)}
                        />
                      )}
                    </span>
                  )}
                </article>
              </div>
            )
          })
        )}
      </div>

      {notice && (
        <p className={cx('insight', `insight--${notice.tone}`)} role="status">
          <Icon name={notice.icon} size={15} /> {notice.text}
        </p>
      )}

      {canPost && (
        <form className="chat__composer" onSubmit={send}>
          <Textarea
            label="Message"
            rows={2}
            maxLength={limits.maxLength}
            value={text}
            onChange={(e) => {
              setText(e.target.value)
              if (sendError) setSendError('')
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) send(e)
            }}
            placeholder="Message the other participants… (Enter to send, Shift+Enter for a new line)"
            error={sendError || undefined}
            hint={`${text.length}/${limits.maxLength} · Be kind: organizers moderate this chat`}
          />
          <div className="chat__send">
            <span className="small muted" aria-live="polite">
              {cooldownLeft ? `You can send another message in ${cooldownLeft} second${cooldownLeft === 1 ? '' : 's'}.` : ''}
            </span>
            <Button type="submit" icon="arrowRight" loading={sending} disabled={!text.trim() || Boolean(cooldownLeft)}>
              Send
            </Button>
          </div>
        </form>
      )}

      {reporting && (
        <ReportDialog
          message={reporting}
          onClose={() => setReporting(null)}
          onDone={(id) => {
            setMessages((list) => list.map((m) => (m.id === id ? { ...m, reportedByMe: true } : m)))
            setReporting(null)
          }}
        />
      )}
    </section>
  )
}

// Participant ↔ participant chat. Official, one-way updates stay in Hackathon updates.
export default function ParticipantChat() {
  const { hackathonId } = useParams()
  const navigate = useNavigate()
  const [list, setList] = useState(null)
  const [listError, setListError] = useState('')
  useEffect(() => {
    api.chatHackathons().then(setList, (e) => setListError(e.message))
  }, [])
  const id = hackathonId || list?.[0]?.id || ''

  return (
    <div className="container page-pad">
      <header className="dash-head">
        <div>
          <p className="eyebrow">Participant chat</p>
          <h1>Talk with other participants</h1>
          <p className="muted">Find teammates, ask questions and share resources. Official information from the organizers is in Hackathon updates.</p>
        </div>
        <div className="dash-head__actions">
          {id && (
            <Button to={`/hackathons/${encodeURIComponent(id)}/communication`} variant="secondary" icon="radio">
              Hackathon updates
            </Button>
          )}
        </div>
      </header>

      {listError ? (
        <ErrorState message={listError} />
      ) : !list ? (
        <div className="skeleton" style={{ height: 480, borderRadius: 20 }} />
      ) : !list.length && !hackathonId ? (
        <EmptyState
          icon="users"
          title="No hackathon chats yet"
          message="Apply to a hackathon to join its participant chat."
          action={
            <Button to="/events" icon="search">
              Browse events
            </Button>
          }
        />
      ) : (
        <>
          {list.length > 1 && (
            <div className="table-tools">
              <Select
                label="Hackathon"
                value={id}
                onChange={(e) => navigate(`/hackathons/${encodeURIComponent(e.target.value)}/chat`)}
                options={[...(list.some((h) => h.id === id) ? [] : [{ value: id, label: id }]), ...list.map((h) => ({ value: h.id, label: `${h.title} · ${formatDate(h.date, { year: false })}` }))]}
              />
            </div>
          )}
          <Room key={id} eventId={id} />
        </>
      )}
    </div>
  )
}
