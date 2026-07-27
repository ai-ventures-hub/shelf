'use client'

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import {
  DEMO_BEAT_ORDER,
  DEMO_BEATS,
  READINESS_LABEL,
  type DemoBeatId,
  type DemoReadiness,
  type DemoToolStatus,
} from '@/lib/demo-states'

/** Auto-tour dwell per beat (~4s × 5 ≈ 20s to Capability Intelligence). */
const BEAT_MS = 4000

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

function subscribeReducedMotion(onChange: () => void) {
  const mq = window.matchMedia(REDUCED_MOTION_QUERY)
  mq.addEventListener('change', onChange)
  return () => mq.removeEventListener('change', onChange)
}

function statusTone(status: DemoToolStatus): string {
  if (status === 'Running') return 'success'
  if (status === 'Added') return 'accent'
  if (status === 'Starting') return 'warning'
  return 'neutral'
}

function readinessTone(state: DemoReadiness): string {
  if (state === 'ready') return 'success'
  if (state === 'needs_setup') return 'warning'
  if (state === 'manual_only') return 'neutral'
  return 'danger'
}

/**
 * Hero command-deck demo — the agent↔Shelf conversation, right column.
 * Prepared state machine only; no live filesystem or MCP.
 */
export function HeroDemo() {
  // Reduced motion disables the auto-tour and lands on the capability beat.
  const reducedMotion = useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia(REDUCED_MOTION_QUERY).matches,
    () => false,
  )
  /** Chip the visitor picked; non-null pauses the tour. */
  const [selected, setSelected] = useState<DemoBeatId | null>(null)
  const [tourBeat, setTourBeat] = useState<DemoBeatId>('import')
  const tourIndex = useRef(0)

  const paused = selected !== null
  const beatId = selected ?? (reducedMotion ? 'capability' : tourBeat)
  const beat = DEMO_BEATS[beatId]

  useEffect(() => {
    if (paused || reducedMotion) return
    const timer = window.setInterval(() => {
      tourIndex.current = (tourIndex.current + 1) % DEMO_BEAT_ORDER.length
      setTourBeat(DEMO_BEAT_ORDER[tourIndex.current])
    }, BEAT_MS)
    return () => window.clearInterval(timer)
  }, [paused, reducedMotion])

  function selectBeat(id: DemoBeatId) {
    setSelected(id)
    tourIndex.current = DEMO_BEAT_ORDER.indexOf(id)
  }

  function resumeTour() {
    setTourBeat(DEMO_BEAT_ORDER[tourIndex.current])
    setSelected(null)
  }

  return (
    <div id="demo" className="hero-demo" aria-label="Shelf product demonstration">
      <div className="demo-chips" role="group" aria-label="Try a prepared prompt">
        {DEMO_BEAT_ORDER.map((id) => (
          <button
            key={id}
            type="button"
            className="demo-chip"
            data-active={beatId === id ? 'true' : undefined}
            aria-pressed={beatId === id}
            onClick={() => selectBeat(id)}
          >
            {DEMO_BEATS[id].chip}
          </button>
        ))}
      </div>

      <section className="demo-panel" aria-labelledby="demo-agent-heading">
        <header className="demo-panel-head">
          <h3 id="demo-agent-heading">Agent</h3>
          <span className="demo-panel-meta">Cursor · MCP</span>
        </header>
        <div className="demo-msgs" key={beatId}>
          <div className="demo-msg" data-role="user">
            <span className="demo-msg-label">You</span>
            <p>{beat.user}</p>
          </div>
          <div
            className="demo-msg"
            data-role="agent"
            style={{ animationDelay: reducedMotion ? '0ms' : '120ms' }}
          >
            <span className="demo-msg-label">Agent</span>
            <p>{beat.agent}</p>
          </div>
        </div>
      </section>

      <section className="demo-panel" aria-labelledby="demo-shelf-heading">
        <header className="demo-panel-head">
          <h3 id="demo-shelf-heading">Shelf</h3>
          <span className="demo-panel-meta">Library · {beat.tools.length} tools</span>
        </header>
        <p className="demo-note" key={`note-${beatId}`}>
          {beat.shelfNote}
        </p>
        <ul className="demo-tool-list" key={`tools-${beatId}`}>
          {beat.tools.map((tool) => (
            <li
              key={tool.id}
              className="demo-tool-row"
              data-featured={tool.id === 'image-prepper' ? 'true' : undefined}
            >
              <div className="demo-tool-copy">
                <strong>{tool.name}</strong>
                <span className="demo-tool-cmd">
                  {tool.command} · {tool.port > 0 ? `:${tool.port}` : 'one-shot'}
                </span>
              </div>
              <div className="demo-tool-pills">
                <span className="pill" data-tone={statusTone(tool.status)}>
                  {tool.status}
                </span>
                <span
                  className="pill"
                  data-tone={readinessTone(tool.readiness)}
                  title="Agent readiness — separate from process status"
                >
                  {READINESS_LABEL[tool.readiness]}
                </span>
              </div>
            </li>
          ))}
          {beat.gap ? (
            <li className="demo-gap-row">
              <div className="demo-tool-copy">
                <strong>{beat.gap.task}</strong>
                <span>{beat.gap.reason}</span>
              </div>
              <span className="pill" data-tone="warning">
                Gap · open
              </span>
            </li>
          ) : null}
        </ul>
      </section>

      <div className="demo-foot">
        <p className="demo-caption">Simulated — prepared states, not your local Mac.</p>
        {paused && !reducedMotion ? (
          <button type="button" className="demo-tour-btn" onClick={resumeTour}>
            Resume tour
          </button>
        ) : null}
      </div>
    </div>
  )
}
