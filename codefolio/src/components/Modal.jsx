import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Icon from './Icon'
import { Button, Input } from './ui'
import { cx } from '../utils/format'

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'

export default function Modal({ open, onClose, title, size = 'md', children, footer, labelledBy, hideTitle, className }) {
  const panel = useRef(null)
  const restore = useRef(null)
  const autoId = useId()
  const titleId = labelledBy || autoId
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    if (!open) return
    restore.current = document.activeElement
    document.body.classList.add('no-scroll')
    const t = setTimeout(() => {
      const first = panel.current?.querySelector('[data-autofocus]') || panel.current?.querySelector(FOCUSABLE)
      ;(first || panel.current)?.focus()
    }, 30)
    const onKey = (e) => {
      // Only the top-most dialog reacts (a confirm opened from inside another dialog).
      const dialogs = document.querySelectorAll('.modal')
      if (dialogs.length > 1 && dialogs[dialogs.length - 1] !== panel.current) return
      if (e.key === 'Escape') {
        e.stopPropagation()
        closeRef.current?.()
      }
      if (e.key === 'Tab' && panel.current) {
        const els = [...panel.current.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null)
        if (!els.length) return
        const first = els[0]
        const last = els[els.length - 1]
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      clearTimeout(t)
      document.removeEventListener('keydown', onKey)
      // only unlock if no other modal is still open
      if (document.querySelectorAll('.modal-backdrop').length <= 1) document.body.classList.remove('no-scroll')
      restore.current?.focus?.()
    }
  }, [open])

  if (!open) return null
  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div
        ref={panel}
        className={cx('modal', `modal--${size}`, className)}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className={cx('modal__head', hideTitle && 'modal__head--floating')}>
          <h2 id={titleId} className={hideTitle ? 'sr-only' : 'modal__title'}>
            {title}
          </h2>
          <button className="icon-btn modal__close" onClick={onClose} aria-label="Close dialog">
            <Icon name="x" size={20} />
          </button>
        </div>
        <div className="modal__body">{children}</div>
        {footer && <div className="modal__foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}

export function ConfirmDialog({ open, onClose, onConfirm, title, message, confirmLabel = 'Confirm', cancelLabel = 'Keep it', tone = 'danger', requireText, busy }) {
  const [typed, setTyped] = useState('')
  useEffect(() => {
    if (open) setTyped('')
  }, [open])
  const blocked = requireText && typed.trim() !== requireText
  return (
    <Modal
      open={open}
      onClose={busy ? undefined : onClose}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button variant={tone === 'danger' ? 'danger' : 'primary'} onClick={onConfirm} disabled={blocked} loading={busy}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="confirm">
        <div className={cx('confirm__icon', `confirm__icon--${tone}`)} aria-hidden="true">
          <Icon name={tone === 'danger' ? 'alert' : 'info'} size={24} />
        </div>
        <div className="confirm__text">{message}</div>
      </div>
      {requireText && (
        <Input
          label={
            <>
              Type <code>{requireText}</code> to confirm
            </>
          }
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          autoComplete="off"
          data-autofocus
        />
      )}
    </Modal>
  )
}
