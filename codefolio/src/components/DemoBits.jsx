import Icon from './Icon'
import { Badge } from './ui'
import { clock } from '../hooks/useDemoSession'
import { cx } from '../utils/format'

const PRES = {
  waiting: ['neutral', 'Waiting'],
  presenting: ['info', 'Presenting'],
  qa: ['warn', 'Q&A'],
  completed: ['success', 'Completed'],
  skipped: ['danger', 'Skipped'],
}
export const PresentationBadge = ({ status }) => <Badge tone={PRES[status]?.[0] || 'neutral'}>{PRES[status]?.[1] || status}</Badge>

const SESSION = { draft: ['warn', 'Not started'], live: ['success', 'Live'], ended: ['neutral', 'Ended'] }
export const SessionBadge = ({ status }) => (
  <Badge tone={SESSION[status]?.[0] || 'neutral'} icon={status === 'live' ? 'radio' : undefined}>
    {SESSION[status]?.[1] || status}
  </Badge>
)

// Server-authoritative countdown (see useDemoSession).
export function DemoTimer({ timer, large }) {
  if (!timer) {
    return (
      <div className={cx('demo-timer', large && 'demo-timer--lg')} aria-live="off">
        <strong className="demo-timer__value">–:––</strong>
        <span className="muted small">Waiting for the next team</span>
      </div>
    )
  }
  const pct = Math.min(100, (timer.elapsed / Math.max(1, timer.duration)) * 100)
  const low = !timer.over && timer.remaining <= 30
  return (
    <div className={cx('demo-timer', large && 'demo-timer--lg', timer.over && 'is-over', low && 'is-low')} role="timer" aria-live="off">
      <span className="demo-timer__phase">
        <Icon name={timer.phase === 'qa' ? 'users' : 'clock'} size={15} /> {timer.phase === 'qa' ? 'Q&A' : 'Presentation'}
        {timer.paused && <Badge tone="warn">Paused</Badge>}
      </span>
      <strong className="demo-timer__value">{timer.over ? 'Time’s up' : clock(timer.remaining)}</strong>
      <span className="meter" aria-hidden="true">
        <span className={cx('meter__fill', timer.over ? 'meter__fill--danger' : low ? 'meter__fill--warn' : 'meter__fill--ok')} style={{ width: `${pct}%` }} />
      </span>
      <span className="muted small">of {clock(timer.duration)}</span>
    </div>
  )
}
