import { useId, useLayoutEffect, useRef, useState } from 'react'
import { ChevronDown, TriangleAlert, X } from 'lucide-react'
import { Link } from 'react-router-dom'
import { healthWarning } from '../../shared/tool-health-presentation'
import type { ToolHealth } from '../types'

export function ToolHealthWarning({ health, live, toolName }: { health?: ToolHealth; live: boolean; toolName: string }) {
  if (!health || health.launchable || live) return null
  return <WarningDetails health={health} toolName={toolName} />
}

function WarningDetails({ health, toolName }: { health: ToolHealth; toolName: string }) {
  const id = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const popover = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const { label, heading } = healthWarning(health)

  // Native popovers escape scrolling containers and stretched card links, and
  // provide light dismissal, Escape, and keyboard ordering beside the trigger.
  useLayoutEffect(() => {
    if (!open) return
    function place() {
      const anchor = trigger.current?.getBoundingClientRect()
      const panel = popover.current
      if (!anchor || !panel) return
      const bounds = panel.getBoundingClientRect()
      const left = Math.max(12, Math.min(anchor.left, window.innerWidth - bounds.width - 12))
      const above = anchor.top - bounds.height - 8
      const preferredTop = above >= 12 ? above : anchor.bottom + 8
      const top = Math.max(12, Math.min(preferredTop, window.innerHeight - bounds.height - 12))
      panel.style.left = `${left}px`
      panel.style.top = `${top}px`
    }
    place()
    popover.current?.focus({ preventScroll: true })
    window.addEventListener('resize', place)
    document.addEventListener('scroll', place, true)
    const observer = new ResizeObserver(place)
    if (popover.current) observer.observe(popover.current)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', place)
      document.removeEventListener('scroll', place, true)
    }
  }, [open])

  function close() {
    popover.current?.hidePopover()
    setOpen(false)
    trigger.current?.focus({ preventScroll: true })
  }

  return <>
    <button ref={trigger} type="button" className="health-warning-trigger" popoverTarget={id}
      aria-haspopup="dialog" aria-expanded={open} aria-controls={id} aria-label={`${label}: ${toolName}`}>
      <TriangleAlert size={13} aria-hidden /><span>{label}</span><ChevronDown size={12} aria-hidden />
    </button>
    <div ref={popover} id={id} popover="auto" className="health-warning-popover" role="dialog"
      tabIndex={-1} aria-labelledby={`${id}-heading`}
      onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close() } }}
      onToggle={(event) => setOpen((event.nativeEvent as ToggleEvent).newState === 'open')}>
      <div className="health-warning-heading">
        <strong id={`${id}-heading`}>{heading}</strong>
        <button type="button" className="btn btn-quiet btn-sm btn-icon" aria-label="Close warning" onClick={close}><X size={14} aria-hidden /></button>
      </div>
      {health.problems.length ? <ul>{health.problems.map((problem, index) => <li key={index}>{problem}</li>)}</ul>
        : <p>Open this tool to review its launch configuration.</p>}
      <Link to={`/tools/${encodeURIComponent(health.toolId)}`} onClick={() => popover.current?.hidePopover()}>View tool details</Link>
    </div>
  </>
}
