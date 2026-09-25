import { useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'

// The event modal is driven by the `?event=<id>` query param so it can be
// deep-linked, survives the login redirect and closes with the back button.
export function useOpenEvent() {
  const [, setParams] = useSearchParams()
  return useCallback(
    (id) =>
      setParams((p) => {
        const next = new URLSearchParams(p)
        next.set('event', id)
        return next
      }),
    [setParams],
  )
}

export function useCloseEvent() {
  const [, setParams] = useSearchParams()
  return useCallback(
    () =>
      setParams(
        (p) => {
          const next = new URLSearchParams(p)
          next.delete('event')
          return next
        },
        { replace: true },
      ),
    [setParams],
  )
}
