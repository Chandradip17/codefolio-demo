import { useCallback, useEffect, useState } from 'react'
import Icon from '../../components/Icon'
import Modal, { ConfirmDialog } from '../../components/Modal'
import { Badge, Button, EmptyState, ErrorState, Select, Segmented } from '../../components/ui'
import { useData } from '../../context/DataContext'
import { useToast } from '../../context/ToastContext'
import * as api from '../../services/api'
import { formatDate, formatIST } from '../../utils/format'
import { useHackathonPicker } from './OrganizerJudging'

const REASON = { spam: 'Spam', harassment: 'Harassment or hate', inappropriate: 'Inappropriate', off_topic: 'Off-topic', other: 'Other' }
const STATUS = { pending: ['warn', 'Pending'], reviewed: ['neutral', 'Reviewed'], dismissed: ['neutral', 'Dismissed'], action_taken: ['success', 'Action taken'] }
const MUTE_OPTIONS = [
  { value: '30', label: '30 minutes' },
  { value: '120', label: '2 hours' },
  { value: '720', label: '12 hours' },
  { value: '1440', label: '1 day' },
  { value: '10080', label: '7 days' },
]

function ReviewModal({ eventId, report, onClose, onDone }) {
  const toast = useToast()
  const [minutes, setMinutes] = useState('120')
  const [busy, setBusy] = useState('')
  const run = async (kind, fn, msg) => {
    setBusy(kind)
    try {
      await fn()
      toast(msg)
      onDone()
    } catch (e) {
      toast({ title: 'Couldn’t update', message: e.message, tone: 'error' })
      setBusy('')
    }
  }
  const m = report.message
  return (
    <Modal open onClose={onClose} title="Review report" size="md">
      <div className="form-stack">
        <blockquote className="chat-quote">
          <strong>
            {m.author.name}
            {m.author.username ? ` · @${m.author.username}` : ''}
          </strong>
          <span className="pre-line">{m.text}</span>
          <small className="muted">
            {formatIST(m.createdAt)}
            {m.deleted ? ' · already removed' : ''}
          </small>
        </blockquote>
        <dl className="answers__list">
          <div>
            <dt>Reported by</dt>
            <dd>{report.reporter.name}</dd>
          </div>
          <div>
            <dt>Reason</dt>
            <dd>
              {REASON[report.reason]}
              {report.details ? ` · “${report.details}”` : ''}
            </dd>
          </div>
          <div>
            <dt>Reports on this message</dt>
            <dd>{report.reportsOnMessage}</dd>
          </div>
        </dl>
        <div className="row-actions demo-actions">
          <Button variant="ghost" onClick={() => run('dismiss', () => api.reviewChatReport(report.id, 'dismissed'), { title: 'Report dismissed', tone: 'info' })} loading={busy === 'dismiss'} disabled={Boolean(busy)}>
            Dismiss
          </Button>
          {!m.deleted && (
            <Button variant="danger-ghost" icon="trash" onClick={() => run('delete', () => api.deleteChatMessage(m.id), { title: 'Message removed', message: 'Participants now see a “removed by a moderator” placeholder.' })} loading={busy === 'delete'} disabled={Boolean(busy)}>
              Delete message
            </Button>
          )}
        </div>
        <div className="grid-2 chat-mute-row">
          <Select label="Mute the author for" value={minutes} onChange={(e) => setMinutes(e.target.value)} options={MUTE_OPTIONS} hint="They can still read the chat." />
          <Button
            variant="secondary"
            icon="ban"
            onClick={() => run('mute', () => api.muteChatUser(eventId, m.author.id, Number(minutes), REASON[report.reason], report.id), { title: `${m.author.name} muted`, message: 'They can’t post in this hackathon’s chat until the mute ends.' })}
            loading={busy === 'mute'}
            disabled={Boolean(busy)}
          >
            Mute user
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function Board({ eventId }) {
  const toast = useToast()
  const { subscribe } = useData()
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState('pending')
  const [reviewing, setReviewing] = useState(null)
  const [toggling, setToggling] = useState(false)
  const [closing, setClosing] = useState(false)
  const [unmuting, setUnmuting] = useState('')

  const load = useCallback(async () => {
    setError('')
    try {
      setData(await api.chatModeration(eventId))
    } catch (e) {
      setError(e.message)
    }
  }, [eventId])
  useEffect(() => {
    load()
  }, [load])
  useEffect(() => subscribe((type, d) => type === 'chat.report' && d.eventId === eventId && load()), [subscribe, eventId, load])

  async function setActive(active) {
    setToggling(true)
    try {
      await api.setChatRoomActive(eventId, active)
      toast(active ? { title: 'Chat opened', message: 'Participants can post again.' } : { title: 'Chat closed', message: 'Participants can still read previous messages.', tone: 'info' })
      setClosing(false)
      load()
    } catch (e) {
      toast({ title: 'Couldn’t update the chat', message: e.message, tone: 'error' })
    } finally {
      setToggling(false)
    }
  }
  async function unmute(m) {
    setUnmuting(m.userId)
    try {
      await api.unmuteChatUser(eventId, m.userId)
      toast({ title: `${m.name} can chat again`, tone: 'info' })
      load()
    } catch (e) {
      toast({ title: 'Couldn’t unmute', message: e.message, tone: 'error' })
    } finally {
      setUnmuting('')
    }
  }

  if (error) return <ErrorState message={error} onRetry={load} />
  if (!data) return <div className="skeleton" style={{ height: 320, borderRadius: 20 }} />
  const active = data.room ? data.room.active : true
  const pending = data.reports.filter((r) => r.status === 'pending')
  const shown = filter === 'pending' ? pending : data.reports

  return (
    <>
      <div className="event-summary card">
        <div>
          <strong>Participant chat</strong>
          <p className="small muted">
            <Badge tone={active ? 'success' : 'neutral'} icon={active ? 'radio' : 'lock'}>
              {active ? 'Open' : 'Closed'}
            </Badge>{' '}
            · cooldown {data.limits.cooldownSeconds}s · max {data.limits.maxPerMinute}/min · {data.limits.maxLength} characters
            {data.limits.readOnlyAfterEnd ? ' · read-only after the hackathon ends' : ''}
          </p>
        </div>
        <div className="event-summary__nums">
          <span>
            <strong>{data.messages}</strong> messages
          </span>
          <span>
            <strong>{pending.length}</strong> reports pending
          </span>
          <span>
            <strong>{data.mutes.length}</strong> muted
          </span>
        </div>
        <div className="row-actions">
          <Button variant="secondary" icon="eye" to={`/hackathons/${encodeURIComponent(eventId)}/chat`}>
            Open chat
          </Button>
          {active ? (
            <Button variant="danger-ghost" icon="lock" onClick={() => setClosing(true)}>
              Close chat
            </Button>
          ) : (
            <Button icon="radio" onClick={() => setActive(true)} loading={toggling}>
              Open chat
            </Button>
          )}
        </div>
      </div>

      <div className="chart-grid comm-grid">
        <section className="card" aria-labelledby="rep-h">
          <div className="card__head">
            <h3 id="rep-h">Reported messages</h3>
            <Segmented
              label="Report filter"
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'pending', label: 'Pending', count: pending.length },
                { value: 'all', label: 'All', count: data.reports.length },
              ]}
            />
          </div>
          {!shown.length ? (
            <p className="muted small">{filter === 'pending' ? 'No reports waiting for review.' : 'No messages have been reported.'}</p>
          ) : (
            <ul className="mini-list">
              {shown.map((r) => (
                <li key={r.id}>
                  <div>
                    <strong className="chat-report__text">“{r.message.text}”</strong>
                    <small>
                      {r.message.author.name} · {REASON[r.reason]} · reported by {r.reporter.name} · {formatIST(r.createdAt)}
                    </small>
                  </div>
                  <span className="mini-list__right">
                    <Badge tone={STATUS[r.status][0]}>{STATUS[r.status][1]}</Badge>
                    {r.status === 'pending' && (
                      <Button size="sm" variant="secondary" onClick={() => setReviewing(r)}>
                        Review
                      </Button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="card" aria-labelledby="mute-h">
          <div className="card__head">
            <h3 id="mute-h">Muted in this chat</h3>
          </div>
          {!data.mutes.length ? (
            <p className="muted small">Nobody is muted. Mutes only affect this hackathon’s chat, never the member’s account.</p>
          ) : (
            <ul className="mini-list">
              {data.mutes.map((m) => (
                <li key={m.userId}>
                  <div>
                    <strong>{m.name}</strong>
                    <small>
                      until {formatIST(m.mutedUntil)}
                      {m.reason ? ` · ${m.reason}` : ''}
                    </small>
                  </div>
                  <span className="mini-list__right">
                    <Button size="sm" variant="ghost" onClick={() => unmute(m)} loading={unmuting === m.userId}>
                      Unmute
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {reviewing && (
        <ReviewModal
          eventId={eventId}
          report={reviewing}
          onClose={() => setReviewing(null)}
          onDone={() => {
            setReviewing(null)
            load()
          }}
        />
      )}
      <ConfirmDialog
        open={closing}
        onClose={() => setClosing(false)}
        onConfirm={() => setActive(false)}
        busy={toggling}
        title="Close the participant chat?"
        confirmLabel="Close chat"
        cancelLabel="Keep it open"
        message={<p>Participants will still see previous messages but can’t post until you open it again.</p>}
      />
    </>
  )
}

export default function OrganizerChatModeration() {
  const { list, error, id, choose } = useHackathonPicker()
  if (error) return <ErrorState message={error} />
  return (
    <>
      <header className="dash-head">
        <div>
          <p className="eyebrow">Chat moderation</p>
          <h1>Chat moderation</h1>
          <p className="muted">Keep your hackathon’s participant chat friendly: review reports, remove messages, pause members, or close the chat.</p>
        </div>
      </header>
      {list && !list.length ? (
        <EmptyState icon="trophy" title="No hackathons yet" message="Create a hackathon first." action={<Button to="/admin/events/new" icon="plus">Add Event</Button>} />
      ) : (
        <>
          <div className="table-tools">
            <Select
              label="Hackathon"
              value={id}
              onChange={(e) => choose(e.target.value)}
              options={(list || []).map((h) => ({ value: h.id, label: `${h.title} · ${formatDate(h.date, { year: false })}` }))}
            />
          </div>
          {id ? <Board key={id} eventId={id} /> : <div className="skeleton" style={{ height: 320, borderRadius: 20 }} />}
        </>
      )}
      <p className="small muted">
        <Icon name="info" size={14} /> Participant chat is two-way discussion between participants. Official, one-way information belongs in the Communication Center.
      </p>
    </>
  )
}
