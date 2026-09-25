import Icon from './Icon'
import { LiveIndicator } from './LiveBits'
import { useData } from '../context/DataContext'
import { useNow } from '../hooks/useNow'
import { useOpenEvent } from '../hooks/useOpenEvent'
import { cx } from '../utils/format'

function ago(ms) {
  const s = Math.round(ms / 1000)
  if (s < 10) return 'just now'
  if (s < 60) return `${s}s ago`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

export default function ActivityFeed({ title = 'Live activity', emptyText }) {
  const { activity, getEvent } = useData()
  const openEvent = useOpenEvent()
  const now = useNow(15000)

  return (
    <section className="card feed" aria-labelledby="feed-title">
      <div className="card__head">
        <h3 id="feed-title">{title}</h3>
        <LiveIndicator compact />
      </div>
      {activity.length === 0 ? (
        <p className="feed__empty">
          <Icon name="radio" size={18} />
          {emptyText || 'Nothing yet. Changes to your events will appear here instantly.'}
        </p>
      ) : (
        <ol className="feed__list" aria-live="polite" aria-relevant="additions">
          {activity.map((it) => {
            const clickable = it.eventId && getEvent(it.eventId)
            const Tag = clickable ? 'button' : 'div'
            return (
              <li key={it.id} className={cx('feed__item', `feed__item--${it.tone}`, !it.seeded && now - it.at < 8000 && 'is-new')}>
                <Tag className="feed__row" {...(clickable ? { type: 'button', onClick: () => openEvent(it.eventId) } : {})}>
                  <span className="feed__icon" aria-hidden="true">
                    <Icon name={it.icon || 'info'} size={15} />
                  </span>
                  <span className="feed__text">
                    <strong>{it.title}</strong>
                    {it.text && <small>{it.text}</small>}
                  </span>
                  <time className="feed__time" dateTime={new Date(it.at).toISOString()}>
                    {ago(now - it.at)}
                  </time>
                </Tag>
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}
