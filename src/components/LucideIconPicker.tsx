import { Suspense, useEffect, useId, useMemo, useRef, useState } from 'react'
import {
  filterLucideNames,
  getLucideIcon,
  humanizeLucideName,
} from '../lib/lucideCatalog'

/**
 * Searchable Lucide picker — trigger shows current icon + label; popover grids icons.
 */
export function LucideIconPicker({
  value,
  onChange,
  iconColor = '#ffffff',
  iconBackground = '#3b82f6',
  allowClear = true,
}: {
  value?: string
  onChange: (name: string | undefined) => void
  iconColor?: string
  iconBackground?: string
  allowClear?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const triggerRef = useRef<HTMLButtonElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const listId = useId()

  const names = useMemo(() => filterLucideNames(query), [query])
  const Selected = getLucideIcon(value)
  const label = value ? humanizeLucideName(value) : 'Choose icon…'

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false); triggerRef.current?.focus() }
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    const t = window.setTimeout(() => searchRef.current?.focus(), 0)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
      window.clearTimeout(t)
    }
  }, [open])

  return (
    <div className="lucide-picker" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="lucide-picker-trigger"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((v) => !v)}
      >
        <span
          className="lucide-picker-preview"
          style={{ background: iconBackground, color: iconColor }}
        >
          {Selected ? <Suspense fallback={<span>…</span>}><Selected size={18} strokeWidth={2} /></Suspense> : <span>?</span>}
        </span>
        <span className="lucide-picker-label">{label}</span>
      </button>

      {open ? (
        <div className="lucide-picker-popover" role="presentation">
          <input
            ref={searchRef}
            className="field-input lucide-picker-search"
            type="search"
            placeholder="Search icons…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search Lucide icons"
          />
          <div
            id={listId}
            className="lucide-picker-grid"
            role="group"
            aria-label="Lucide icons"
          >
            {names.length === 0 ? (
              <p className="lucide-picker-empty">No icons match</p>
            ) : (
              names.map((name) => {
                const Icon = getLucideIcon(name)
                if (!Icon) return null
                const active = name.toLowerCase() === value?.toLowerCase()
                return (
                  <button
                    key={name}
                    type="button"
                    aria-label={humanizeLucideName(name)}
                    aria-pressed={active}
                    title={humanizeLucideName(name)}
                    className={`lucide-picker-cell${active ? ' is-active' : ''}`}
                    onClick={() => {
                      onChange(name)
                      setOpen(false)
                      triggerRef.current?.focus()
                      setQuery('')
                    }}
                  >
                    <Suspense fallback={<span>…</span>}><Icon size={18} strokeWidth={1.85} /></Suspense>
                  </button>
                )
              })
            )}
          </div>
          {allowClear && value ? (
            <button
              type="button"
              className="btn btn-quiet btn-sm lucide-picker-clear"
              onClick={() => {
                onChange(undefined)
                setOpen(false)
              }}
            >
              Clear icon
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
