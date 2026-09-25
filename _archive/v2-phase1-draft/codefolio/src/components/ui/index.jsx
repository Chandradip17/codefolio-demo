// Design-system primitives. Keep these small and consistent.
import { forwardRef, useId } from 'react'
import { Link } from 'react-router-dom'
import Icon from '../Icon'
import { cx } from '../../utils/format'

export function Spinner({ size = 16, label }) {
  return <span className="spinner" style={{ width: size, height: size }} role={label ? 'status' : undefined} aria-label={label} aria-hidden={label ? undefined : true} />
}

export function Button({ variant = 'primary', size = 'md', to, href, icon, iconRight, loading, block, className, children, disabled, ...rest }) {
  const cls = cx('btn', `btn--${variant}`, `btn--${size}`, block && 'btn--block', loading && 'is-loading', className)
  const content = (
    <>
      {loading ? <Spinner size={14} /> : icon && <Icon name={icon} size={size === 'sm' ? 15 : 16} />}
      {children && <span>{children}</span>}
      {iconRight && !loading && <Icon name={iconRight} size={size === 'sm' ? 15 : 16} />}
    </>
  )
  if (to) {
    return (
      <Link to={to} className={cls} {...rest}>
        {content}
      </Link>
    )
  }
  if (href) {
    return (
      <a href={href} className={cls} target="_blank" rel="noopener noreferrer" {...rest}>
        {content}
      </a>
    )
  }
  return (
    <button type="button" className={cls} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {content}
    </button>
  )
}

export function Field({ label, hint, error, id, required, children, className, counter }) {
  return (
    <div className={cx('field', error && 'has-error', className)}>
      {label && (
        <div className="field__top">
          <label htmlFor={id} className="field__label">
            {label}
            {required ? <span className="field__req"> *</span> : <span className="field__opt"> (optional)</span>}
          </label>
          {counter}
        </div>
      )}
      {children}
      {error ? (
        <p className="field__error" id={`${id}-err`} role="alert">
          <Icon name="alert" size={13} /> {error}
        </p>
      ) : (
        hint && (
          <p className="field__hint" id={`${id}-hint`}>
            {hint}
          </p>
        )
      )}
    </div>
  )
}

const describedBy = (id, error, hint) => (error ? `${id}-err` : hint ? `${id}-hint` : undefined)

export const Input = forwardRef(function Input({ label, hint, error, required, className, prefix, suffix, ...rest }, ref) {
  const auto = useId()
  const id = rest.id || auto
  return (
    <Field label={label} hint={hint} error={error} id={id} required={required} className={className}>
      <div className={cx('control', prefix && 'has-prefix', suffix && 'has-suffix')}>
        {prefix && <span className="control__affix">{prefix}</span>}
        <input ref={ref} id={id} className="input" aria-invalid={error ? true : undefined} aria-describedby={describedBy(id, error, hint)} required={required} {...rest} />
        {suffix && <span className="control__affix control__affix--end">{suffix}</span>}
      </div>
    </Field>
  )
})

export function Textarea({ label, hint, error, required, className, maxLength, value, ...rest }) {
  const auto = useId()
  const id = rest.id || auto
  const counter = maxLength ? (
    <span className={cx('field__count', value?.length > maxLength * 0.9 && 'is-near')}>
      {value?.length || 0}/{maxLength}
    </span>
  ) : null
  return (
    <Field label={label} hint={hint} error={error} id={id} required={required} className={className} counter={counter}>
      <textarea id={id} className="input textarea" aria-invalid={error ? true : undefined} aria-describedby={describedBy(id, error, hint)} maxLength={maxLength} value={value} {...rest} />
    </Field>
  )
}

const STATUS = {
  pending: { label: 'Pending', icon: 'clock', tone: 'warn' },
  approved: { label: 'Approved', icon: 'check', tone: 'ok' },
  rejected: { label: 'Rejected', icon: 'x', tone: 'danger' },
  removed: { label: 'Removed', icon: 'ban', tone: 'danger' },
  attended: { label: 'Attended', icon: 'checkCircle', tone: 'ok' },
  open: { label: 'Open', icon: 'radio', tone: 'ok' },
  closed: { label: 'Closed', icon: 'lock', tone: 'muted' },
  upcoming: { label: 'Upcoming', icon: 'calendar', tone: 'accent' },
  ongoing: { label: 'Ongoing', icon: 'zap', tone: 'ok' },
  completed: { label: 'Completed', icon: 'check', tone: 'muted' },
  admin: { label: 'Admin', icon: 'lock', tone: 'accent' },
}

// Status is always icon + text, never color alone.
export function Status({ status, label }) {
  const s = STATUS[status] || { label: label || status, icon: 'info', tone: 'muted' }
  return (
    <span className={cx('status', `status--${s.tone}`)}>
      <Icon name={s.icon} size={12} strokeWidth={2.5} />
      {label || s.label}
    </span>
  )
}

export function Tag({ children, className }) {
  return <span className={cx('tag', className)}>{children}</span>
}

export function Avatar({ src, name, size = 40, className }) {
  const initials = (name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase()
  return (
    <span className={cx('avatar', className)} style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }} aria-hidden="true">
      {src ? <img src={src} alt="" referrerPolicy="no-referrer" loading="lazy" /> : initials}
    </span>
  )
}

export function EmptyState({ icon = 'info', title, children, action }) {
  return (
    <div className="empty">
      <Icon name={icon} size={20} />
      <div>
        <p className="empty__title">{title}</p>
        {children && <p className="empty__text">{children}</p>}
        {action && <div className="empty__action">{action}</div>}
      </div>
    </div>
  )
}

export function ErrorState({ title = 'Something went wrong', message, onRetry }) {
  return (
    <div className="empty empty--error" role="alert">
      <Icon name="alert" size={20} />
      <div>
        <p className="empty__title">{title}</p>
        {message && <p className="empty__text">{message}</p>}
        {onRetry && (
          <div className="empty__action">
            <Button size="sm" variant="secondary" icon="refresh" onClick={onRetry}>
              Retry
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

export function Skeleton({ w = '100%', h = 14, className, style }) {
  return <span className={cx('skeleton', className)} style={{ width: w, height: h, ...style }} aria-hidden="true" />
}

export function Segmented({ options, value, onChange, label }) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} className={cx('segmented__opt', value === o.value && 'is-active')} onClick={() => onChange(o.value)}>
          {o.icon && <Icon name={o.icon} size={14} />}
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function PageHeader({ eyebrow, title, description, actions }) {
  return (
    <header className="page-header">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        {description && <p className="page-header__desc">{description}</p>}
      </div>
      {actions && <div className="page-header__actions">{actions}</div>}
    </header>
  )
}
