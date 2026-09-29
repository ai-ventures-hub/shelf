import { MoreHorizontal } from 'lucide-react'
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'

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
 * Keyboard: opening moves focus into the menu; Arrow keys, Home, and End move
 * between items; Escape closes and returns focus to the trigger; Tab closes.
 * Closes on outside click.
 */
export function OverflowMenu({
  items,
  label = 'More actions',
  triggerLabel,
  size = 'sm',
}: {
  items: OverflowMenuItem[]
  /** Accessible name for the trigger (and visible text when unlabeled). A
   *  labeled trigger's name must start with its visible text. */
  label?: string
  /** When set, show this label + chevron instead of ⋯. */
  triggerLabel?: string
  /** Unlabeled square trigger size — match the neighboring buttons' rail
   *  (sm = 34px next to btn-sm rows, md = 42px next to full-size buttons). */
  size?: 'sm' | 'md'
}) {
  const [open, setOpen] = useState(false)
  // Which end of the menu receives focus when it opens.
  const [initialFocus, setInitialFocus] = useState<'first' | 'last'>('first')
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const menuId = useId()
  const triggerId = useId()
  const labeled = Boolean(triggerLabel)

  function menuItems(): HTMLButtonElement[] {
    return Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])
  }

  function close(returnFocus: boolean) {
    setOpen(false)
    if (returnFocus) triggerRef.current?.focus()
  }

  function openMenu(focus: 'first' | 'last') {
    setInitialFocus(focus)
    setOpen(true)
  }

  useEffect(() => {
    if (!open) return
    const enabled = menuItems()
    ;(initialFocus === 'last' ? enabled.at(-1) : enabled[0])?.focus()
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open, initialFocus])

  function onMenuKeyDown(event: KeyboardEvent<HTMLUListElement>) {
    const enabled = menuItems()
    if (enabled.length === 0) return
    const index = enabled.indexOf(document.activeElement as HTMLButtonElement)
    const focusAt = (next: number) => enabled[(next + enabled.length) % enabled.length]?.focus()
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        focusAt(index + 1)
        break
      case 'ArrowUp':
        event.preventDefault()
        focusAt(index < 0 ? -1 : index - 1)
        break
      case 'Home':
        event.preventDefault()
        focusAt(0)
        break
      case 'End':
        event.preventDefault()
        focusAt(-1)
        break
      case 'Escape':
        event.preventDefault()
        event.stopPropagation()
        close(true)
        break
      case 'Tab':
        // Let Tab move on naturally; the menu is not a focus trap.
        setOpen(false)
        break
    }
  }

  return (
    <div className={`overflow-menu${labeled ? ' is-labeled' : ''}`} ref={rootRef}>
      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        className={`btn btn-quiet${
          labeled ? '' : size === 'md' ? ' btn-icon' : ' btn-sm btn-icon'
        } overflow-menu-trigger`}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => (open ? close(false) : openMenu('first'))}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            openMenu(event.key === 'ArrowUp' ? 'last' : 'first')
          } else if (event.key === 'Escape' && open) {
            event.preventDefault()
            close(true)
          }
        }}
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
          <MoreHorizontal size={size === 'md' ? 17 : 15} aria-hidden />
        )}
      </button>
      {open ? (
        <ul
          ref={listRef}
          id={menuId}
          className="overflow-menu-list"
          role="menu"
          aria-labelledby={triggerId}
          onKeyDown={onMenuKeyDown}
        >
          {items.map((item) => (
            <li key={item.id} role="none">
              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                className={`overflow-menu-item${item.danger ? ' is-danger' : ''}`}
                disabled={item.disabled}
                onClick={() => {
                  // Return focus first, so a dialog the item opens restores
                  // focus to the trigger when it closes.
                  close(true)
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
