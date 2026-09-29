import { X } from 'lucide-react'
import { useLayoutEffect, useRef, useSyncExternalStore } from 'react'

export type ToastTone = 'info' | 'success' | 'warning' | 'error'

interface Toast {
  id: number
  message: string
  tone: ToastTone
}

let toasts: Toast[] = []
let nextId = 0
const listeners = new Set<() => void>()
const timers = new Map<number, number>()

function publish(next: Toast[]) {
  toasts = next
  for (const listener of listeners) listener()
}

export function dismissToast(id: number) {
  window.clearTimeout(timers.get(id))
  timers.delete(id)
  publish(toasts.filter((toast) => toast.id !== id))
}

/**
 * Non-blocking message in the bottom corner. Use for results of actions that
 * have no inline place to report (Quick Open, background saves). Errors stay
 * longer and are announced assertively.
 */
export function notify(message: string, { tone = 'info' }: { tone?: ToastTone } = {}) {
  const id = ++nextId
  // Keep the stack short; the oldest message goes first.
  publish([...toasts.slice(-2), { id, message, tone }])
  timers.set(id, window.setTimeout(() => dismissToast(id), tone === 'error' || tone === 'warning' ? 10_000 : 6_000))
  return id
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Mounted once. A manual popover keeps toasts above page content. */
export function ToastHost() {
  const current = useSyncExternalStore(subscribe, () => toasts)
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el?.showPopover) return
    const open = el.matches(':popover-open')
    if (current.length > 0 && !open) el.showPopover()
    if (current.length === 0 && open) el.hidePopover()
  }, [current])
  return (
    <div ref={ref} className="toast-stack" popover="manual" aria-live="polite">
      {current.map((toast) => (
        <div
          key={toast.id}
          className="toast"
          data-tone={toast.tone}
          role={toast.tone === 'error' ? 'alert' : 'status'}
        >
          <p className="toast-message">{toast.message}</p>
          <button
            type="button"
            className="btn btn-quiet btn-sm btn-icon toast-dismiss"
            aria-label="Dismiss message"
            title="Dismiss"
            onClick={() => dismissToast(toast.id)}
          >
            <X size={13} aria-hidden />
          </button>
        </div>
      ))}
    </div>
  )
}
