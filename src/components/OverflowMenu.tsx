import { useEffect, useId, useRef, useState } from 'react'

export interface OverflowMenuItem {
  id: string
  label: string
  danger?: boolean
  disabled?: boolean
  onSelect: () => void
}

/**
 * Compact overflow / dropdown menu.
 * Default trigger is ⋯; pass `triggerLabel` (e.g. "Open") for a labeled control with chevron.
 * Closes on outside click / Escape.
 */
export function OverflowMenu({
  items,
  label = 'More actions',
  triggerLabel,
}: {
  items: OverflowMenuItem[]
  /** Accessible name for the trigger (and visible text when unlabeled). */
  label?: string
  /** When set, show this label + chevron instead of ⋯. */
  triggerLabel?: string
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const menuId = useId()
  const labeled = Boolean(triggerLabel)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className={`overflow-menu${labeled ? ' is-labeled' : ''}`} ref={rootRef}>
      <button
        type="button"
        className={`btn btn-quiet${labeled ? '' : ' btn-sm'} overflow-menu-trigger`}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((v) => !v)}
      >
        {labeled ? (
          <>
            <span>{triggerLabel}</span>
            <svg
              className="overflow-menu-chevron"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.25"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M6 9l6 6 6-6" />
            </svg>
          </>
        ) : (
          '⋯'
        )}
      </button>
      {open ? (
        <ul id={menuId} className="overflow-menu-list" role="menu">
          {items.map((item) => (
            <li key={item.id} role="none">
              <button
                type="button"
                role="menuitem"
                className={`overflow-menu-item${item.danger ? ' is-danger' : ''}`}
                disabled={item.disabled}
                onClick={() => {
                  setOpen(false)
                  item.onSelect()
                }}
              >
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
