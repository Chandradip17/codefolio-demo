// Small, reusable primitives: Button, Badge, Input, Select, Textarea, EmptyState, ErrorState, Skeleton.
import { forwardRef, useId } from 'react'
import { Link } from 'react-router-dom'
import Icon from './Icon'
import { cx } from '../utils/format'

export function Button({ variant = 'primary', size = 'md', to, href, icon, iconRight, loading, className, children, ...rest }) {
  const cls = cx('btn', `btn--${variant}`, `btn--${size}`, loading && 'is-loading', className)
  const inner = (
    <>
      {loading ? <span className="spinner" aria-hidden="true" /> : icon && <Icon name={icon} size={size === 'sm' ? 16 : 18} />}
      {children && <span>{children}</span>}
      {iconRight && !loading && <Icon name={iconRight} size={size === 'sm' ? 16 : 18} className="btn__icon-right" />}
    </>
  )
  if (to) return <Link to={to} className={cls} {...rest}>{inner}</Link>
  if (href)
    return (
      <a href={href} className={cls} target="_blank" rel="noopener noreferrer" {...rest}>
        {inner}
      </a>
    )
  return (
    <button className={cls} disabled={loading || rest.disabled} aria-busy={loading || undefined} {...rest}>
      {inner}
    </button>
  )
}

const CATEGORY_META = {
  hackathon: { label: 'Hackathon', icon: 'trophy' },
  workshop: { label: 'Workshop', icon: 'wrench' },
  gdg: { label: 'GDG Event', icon: 'users' },
}
export const categoryLabel = (c) => CATEGORY_META[c]?.label || 'Event'

export function Badge({ tone = 'neutral', icon, children, className }) {
  return (
    <span className={cx('badge', `badge--${tone}`, className)}>
      {icon && <Icon name={icon} size={13} />}
      {children}
    </span>
  )
}

export function CategoryBadge({ category }) {
  const m = CATEGORY_META[category] || CATEGORY_META.gdg
  return (
    <Badge tone={category} icon={m.icon}>
      {m.label}
    </Badge>
  )
}

const SOURCE_META = {
  gdg: { label: 'Live · GDG', tone: 'live' },
  devfolio: { label: 'Live · Devfolio', tone: 'live' },
}
export function SourceBadge({ event }) {
  if (event.source === 'codefolio') return event.isSample ? <Badge tone="sample">Sample</Badge> : <Badge tone="neutral">Codefolio</Badge>
  const m = SOURCE_META[event.source]
  return (
    <Badge tone={m.tone} className="badge--dot">
      {m.label}
    </Badge>
  )
}

export function StatusBadge({ status }) {
  const tone =
    {
      Confirmed: 'success',
      Published: 'success',
      Attended: 'info',
      Cancelled: 'danger',
      Completed: 'neutral',
      'Sold Out': 'warn',
      Pending: 'warn',
      Rejected: 'danger',
      Removed: 'danger',
      pending: 'warn',
      approved: 'success',
      rejected: 'danger',
    }[status] || 'neutral'
  return <Badge tone={tone}>{status}</Badge>
}

function Field({ label, error, hint, id, children, required, className }) {
  return (
    <div className={cx('field', error && 'has-error', className)}>
      {label && (
        <label htmlFor={id} className="field__label">
          {label}
          {required && <span aria-hidden="true" className="field__req"> *</span>}
        </label>
      )}
      {children}
      {error ? (
        <p className="field__error" id={`${id}-err`} role="alert">
          <Icon name="alert" size={14} /> {error}
        </p>
      ) : (
        hint && <p className="field__hint" id={`${id}-hint`}>{hint}</p>
      )}
    </div>
  )
}

const describedBy = (id, error, hint) => (error ? `${id}-err` : hint ? `${id}-hint` : undefined)

export const Input = forwardRef(function Input({ label, error, hint, icon, className, required, ...rest }, ref) {
  const auto = useId()
  const id = rest.id || auto
  return (
    <Field label={label} error={error} hint={hint} id={id} required={required} className={className}>
      <div className={cx('input-wrap', icon && 'has-icon')}>
        {icon && <Icon name={icon} size={18} className="input-wrap__icon" />}
        <input
          ref={ref}
          id={id}
          className="input"
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(id, error, hint)}
          required={required}
          {...rest}
        />
      </div>
    </Field>
  )
})

export function Select({ label, error, hint, options, className, required, ...rest }) {
  const auto = useId()
  const id = rest.id || auto
  return (
    <Field label={label} error={error} hint={hint} id={id} required={required} className={className}>
      <div className="select-wrap">
        <select id={id} className="input select" aria-invalid={error ? true : undefined} aria-describedby={describedBy(id, error, hint)} {...rest}>
          {options.map((o) => {
            const opt = typeof o === 'string' ? { value: o, label: o } : o
            return (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            )
          })}
        </select>
        <Icon name="chevronDown" size={16} className="select-wrap__chev" />
      </div>
    </Field>
  )
}

export function Textarea({ label, error, hint, className, required, ...rest }) {
  const auto = useId()
  const id = rest.id || auto
  return (
    <Field label={label} error={error} hint={hint} id={id} required={required} className={className}>
      <textarea id={id} className="input textarea" aria-invalid={error ? true : undefined} aria-describedby={describedBy(id, error, hint)} {...rest} />
    </Field>
  )
}

export function Segmented({ options, value, onChange, label, size }) {
  return (
    <div className={cx('segmented', size && `segmented--${size}`)} role="radiogroup" aria-label={label}>
      {options.map((o) => {
        const opt = typeof o === 'string' ? { value: o, label: o } : o
        const active = value === opt.value
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            className={cx('segmented__opt', active && 'is-active')}
            onClick={() => onChange(opt.value)}
          >
            {opt.icon && <Icon name={opt.icon} size={15} />}
            {opt.label}
            {opt.count != null && <span className="segmented__count">{opt.count}</span>}
          </button>
        )
      })}
    </div>
  )
}

export function EmptyState({ icon = 'search', title, message, action }) {
  return (
    <div className="state">
      <div className="state__icon" aria-hidden="true">
        <Icon name={icon} size={28} />
      </div>
      <h3>{title}</h3>
      {message && <p>{message}</p>}
      {action}
    </div>
  )
}

export function ErrorState({ title = 'Something went wrong', message, onRetry }) {
  return (
    <div className="state state--error" role="alert">
      <div className="state__icon" aria-hidden="true">
        <Icon name="alert" size={28} />
      </div>
      <h3>{title}</h3>
      {message && <p className="state__detail">{message}</p>}
      {onRetry && (
        <Button variant="secondary" icon="refresh" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  )
}

export function SkeletonCard() {
  return (
    <div className="ticket ticket--skeleton" aria-hidden="true">
      <div className="skeleton skeleton--media" />
      <div className="ticket__body">
        <div className="skeleton skeleton--line" style={{ width: '40%' }} />
        <div className="skeleton skeleton--title" />
        <div className="skeleton skeleton--line" style={{ width: '70%' }} />
        <div className="skeleton skeleton--line" style={{ width: '55%' }} />
      </div>
      <div className="ticket__stub">
        <div className="skeleton skeleton--btn" />
      </div>
    </div>
  )
}

export function SectionHeader({ eyebrow, title, subtitle, action, id }) {
  return (
    <div className="section-head">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h2 id={id}>{title}</h2>
        {subtitle && <p className="section-head__sub">{subtitle}</p>}
      </div>
      {action}
    </div>
  )
}
