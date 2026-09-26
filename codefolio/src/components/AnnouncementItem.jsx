import Icon from './Icon'
import { Badge, Button } from './ui'
import { cx, formatIST } from '../utils/format'

const AUDIENCE = { all: 'Everyone', participants: 'Participants', judges: 'Judges', team: 'Team' }

// One announcement, shared by the member feed and the organizer's Communication Center.
export default function AnnouncementItem({ a, onRead, actions, showAudience }) {
  return (
    <article className={cx('card announce', a.important && 'announce--important', !a.read && onRead && 'is-unread')}>
      <div className="announce__head">
        <span className="announce__icon" aria-hidden="true">
          <Icon name={a.important ? 'alert' : a.pinned ? 'pin' : 'radio'} size={17} />
        </span>
        <div className="announce__title">
          <strong>{a.title}</strong>
          <small className="muted">
            {a.scheduled ? `Scheduled for ${formatIST(a.publishAt)}` : formatIST(a.publishAt)}
            {a.editedAt ? ' · edited' : ''}
            {a.author ? ` · ${a.author}` : ''}
          </small>
        </div>
        <span className="announce__badges">
          {a.important && <Badge tone="danger">Important</Badge>}
          {a.pinned && <Badge tone="info">Pinned</Badge>}
          {a.archivedAt && <Badge tone="neutral">Archived</Badge>}
          {a.scheduled && !a.archivedAt && <Badge tone="warn">Scheduled</Badge>}
          {(showAudience || a.audience !== 'all') && <Badge tone="neutral">{a.audience === 'team' ? `Team ${a.teamName || ''}`.trim() : AUDIENCE[a.audience]}</Badge>}
          {!a.read && onRead && <Badge tone="warn">New</Badge>}
        </span>
      </div>
      <p className="pre-line announce__body">{a.message}</p>
      {(actions || (!a.read && onRead)) && (
        <div className="row-actions">
          {!a.read && onRead && (
            <Button size="sm" variant="ghost" icon="check" onClick={() => onRead(a)}>
              Mark as read
            </Button>
          )}
          {actions}
        </div>
      )}
    </article>
  )
}
