import { useEffect, useRef, type DialogHTMLAttributes } from 'react'

/** Native modal semantics: focus containment, inert background, Escape, and restoration. */
export function Modal({
  open,
  busy = false,
  onDismiss,
  className = 'name-prompt-backdrop',
  children,
  ...props
}: Omit<DialogHTMLAttributes<HTMLDialogElement>, 'open'> & {
  open: boolean
  busy?: boolean
  onDismiss: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    if (!open || !ref.current) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const dialog = ref.current
    dialog.showModal()
    return () => {
      dialog.close()
      if (previous?.isConnected) previous.focus()
    }
  }, [open])
  return (
    <dialog
      {...props}
      ref={ref}
      className={`shelf-modal ${className}`}
      onCancel={(event) => {
        event.preventDefault()
        if (!busy) onDismiss()
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) onDismiss()
      }}
    >
      {children}
    </dialog>
  )
}
