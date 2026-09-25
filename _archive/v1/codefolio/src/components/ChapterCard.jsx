import { Link } from 'react-router-dom'
import Icon from './Icon'

export default function ChapterCard({ chapter, count, liveCount }) {
  return (
    <article className="chapter-card">
      <div className="chapter-card__media">
        <img src={chapter.image} alt="" loading="lazy" />
        <span className="chapter-card__city">
          <Icon name="pin" size={14} /> {chapter.city}
        </span>
      </div>
      <div className="chapter-card__body">
        <h3>{chapter.name}</h3>
        <p>{chapter.description}</p>
        <div className="tag-row">
          {chapter.tags.map((t) => (
            <span key={t} className="tag">
              {t}
            </span>
          ))}
        </div>
        <div className="chapter-card__foot">
          <span className="chapter-card__count">
            <strong>{count}</strong> upcoming
            {liveCount > 0 && <span className="muted"> · {liveCount} live</span>}
          </span>
          <Link to={`/events?city=${encodeURIComponent(chapter.city)}`} className="btn btn--secondary btn--sm">
            <span>Explore Events</span>
            <Icon name="arrowRight" size={16} />
          </Link>
        </div>
      </div>
    </article>
  )
}
