import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Download, LoaderCircle, TriangleAlert, X } from 'lucide-react'
import { updateNotice } from '../../shared/app-update-presentation'
import { useAppUpdate } from '../hooks/useAppUpdate'
import { AppUpdateDetails } from './AppUpdatePanel'

export function SidebarUpdate({ collapsed }: { collapsed: boolean }) {
  const { state, error, dismissedVersion, dismiss, installing } = useAppUpdate()
  const label = updateNotice(state, dismissedVersion, error)
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState({ left: 0, bottom: 0 })
  const trigger = useRef<HTMLButtonElement>(null)
  const popover = useRef<HTMLDivElement>(null)
  function close() { setOpen(false); trigger.current?.focus() }
  function dismissNotice() {
    dismiss()
    setOpen(false)
    document.querySelector<HTMLAnchorElement>('.sidebar-system a[href="#/settings"]')?.focus()
  }
  useEffect(() => {
    if (!open) return
    function place() {
      const rect = trigger.current?.getBoundingClientRect()
      if (rect) setPosition({ left: Math.min(rect.right + 12, window.innerWidth - 332), bottom: Math.max(12, window.innerHeight - rect.bottom) })
    }
    place()
    popover.current?.focus()
    function pointer(event: PointerEvent) {
      if (popover.current?.contains(event.target as Node) || trigger.current?.contains(event.target as Node)) return
      setOpen(false)
    }
    function key(event: KeyboardEvent) {
      if (event.key === 'Escape') { event.preventDefault(); close() }
      if (event.key === 'Tab' && popover.current) {
        const controls = Array.from(popover.current.querySelectorAll<HTMLElement>('button:not(:disabled), a[href]'))
        const first = controls[0], last = controls[controls.length - 1]
        if (event.shiftKey && (document.activeElement === first || document.activeElement === popover.current)) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
      }
    }
    document.addEventListener('pointerdown', pointer)
    document.addEventListener('keydown', key)
    window.addEventListener('resize', place)
    return () => { document.removeEventListener('pointerdown', pointer); document.removeEventListener('keydown', key); window.removeEventListener('resize', place) }
  }, [open])
  const busy = state?.status === 'checking' || state?.status === 'downloading'
  if (!label && !open) return null
  const text = label || 'Shelf updates'
  return <>
    <div className={`sidebar-update${error || state?.status === 'error' ? ' is-error' : ''}`}>
      <button ref={trigger} className="sidebar-update-trigger" title={text} aria-label={text} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? 'update-popover' : undefined} onClick={() => setOpen(!open)}>
        {error || state?.status === 'error' ? <TriangleAlert size={16} aria-hidden /> : busy ? <LoaderCircle size={16} className="update-spinner" aria-hidden /> : <Download size={16} aria-hidden />}
        {!collapsed && <span>{text}</span>}
      </button>
      {!collapsed && state?.status === 'ready' && !error && <button className="sidebar-update-dismiss" disabled={installing} aria-label="Dismiss update notice for this session" onClick={dismissNotice}><X size={14} aria-hidden /></button>}
    </div>
    <span className="sr-only" role="status">{label}</span>
    {open && createPortal(<div id="update-popover" className="update-popover" role="dialog" aria-label="Shelf updates" tabIndex={-1} ref={popover} style={{ ...position, maxHeight: `calc(100vh - ${position.bottom + 12}px)` }}>
      <div className="update-popover-heading"><strong>Updates</strong><button className="btn btn-quiet btn-sm btn-icon" aria-label="Close updates" onClick={close}><X size={16} aria-hidden /></button></div>
      <AppUpdateDetails />
      {collapsed && state?.status === 'ready' && !error && <button className="btn btn-quiet btn-sm" disabled={installing} onClick={dismissNotice}>Dismiss notice</button>}
    </div>, document.body)}
  </>
}
