'use client'

import { useEffect, useEffectEvent, useRef, useState } from 'react'
import {
  DEMO_BEAT_ORDER,
  DEMO_BEATS,
  DEMO_PROMPT_CHIPS,
  READINESS_LABEL,
  type DemoBeatId,
  type DemoReadiness,
  type DemoTool,
} from '@/lib/demo-states'

/** Auto-tour dwell per beat (~4s × 5 ≈ 20s to Capability Intelligence). */
const BEAT_MS = 4000

function statusTone(status: string): string {
  if (status === 'Running') return 'success'
  if (status === 'Ready' || status === 'Added') return 'brand'
  if (status === 'Starting') return 'warning'
  return 'muted'
}

function readinessTone(state: DemoReadiness): string {
  if (state === 'ready') return 'success'
  if (state === 'needs_setup') return 'warning'
  if (state === 'manual_only') return 'muted'
  return 'danger'
}

function StatusPill({ status }: { status: string }) {
  return (
    <span className="demo-pill" data-tone={statusTone(status)}>
      {status}
    </span>
  )
}

function ReadinessPill({ state }: { state: DemoReadiness }) {
  return (
    <span
      className="demo-pill demo-pill--readiness"
      data-tone={readinessTone(state)}
      title="Agent readiness — separate from process status"
    >
      {READINESS_LABEL[state]}
    </span>
  )
}

function ToolCard({
  tool,
  featured,
  showCapabilities,
}: {
  tool: DemoTool
  featured: boolean
  showCapabilities: boolean
}) {
  return (
    <li
      className="demo-tool-card"
      data-featured={featured ? 'true' : undefined}
    >
      <div className="demo-tool-top">
        <div className="demo-tool-icon" aria-hidden>
          {tool.name.slice(0, 1)}
        </div>
        <div className="demo-tool-copy">
          <strong>{tool.name}</strong>
          <span className="demo-tool-cmd">{tool.command}</span>
        </div>
        <div className="demo-tool-pills">
          <StatusPill status={tool.status} />
          <ReadinessPill state={tool.readiness} />
        </div>
      </div>
      <div className="demo-tool-meta">
        {tool.port > 0 ? <span>:{tool.port}</span> : <span>One-shot</span>}
        <span>{tool.tags.join(' · ')}</span>
      </div>
      {showCapabilities && tool.capabilities.length > 0 ? (
        <ul className="demo-cap-list" aria-label={`${tool.name} capabilities`}>
          {tool.capabilities.map((cap) => (
            <li key={cap}>{cap}</li>
          ))}
        </ul>
      ) : null}
      {tool.logLine ? <pre className="demo-tool-log">{tool.logLine}</pre> : null}
      {featured && tool.status === 'Running' ? (
        <div className="demo-tool-actions">
          <span className="demo-btn demo-btn--primary">Launch</span>
          <span className="demo-btn">Open URL</span>
          <span className="demo-btn">Stop</span>
        </div>
      ) : null}
    </li>
  )
}

/**
 * Direction A — interactive dual-surface demo.
 * Prepared state machine only; no live filesystem or MCP.
 */
export function DualDemo() {
  const [beatId, setBeatId] = useState<DemoBeatId>('import')
  const [paused, setPaused] = useState(false)
  const [reducedMotion, setReducedMotion] = useState(false)
  const tourIndex = useRef(0)

  const beat = DEMO_BEATS[beatId]
  const showCapabilities =
    beatId === 'capability' || beatId === 'ready-scan' || beatId === 'gap'

  const preferReducedMotion = useEffectEvent(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReducedMotion(mq.matches)
    // Reduced motion: land on capability beat (Phase 2 story) without auto-tour.
    if (mq.matches) {
      setBeatId('capability')
      setPaused(true)
    }
  })

  useEffect(() => {
    preferReducedMotion()
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = () => preferReducedMotion()
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
    // preferReducedMotion is a stable useEffectEvent handle
  }, [])

  useEffect(() => {
    if (paused || reducedMotion) return
    const timer = window.setInterval(() => {
      tourIndex.current = (tourIndex.current + 1) % DEMO_BEAT_ORDER.length
      setBeatId(DEMO_BEAT_ORDER[tourIndex.current])
    }, BEAT_MS)
    return () => window.clearInterval(timer)
  }, [paused, reducedMotion])

  function selectBeat(id: DemoBeatId) {
    setBeatId(id)
    setPaused(true)
    const idx = DEMO_BEAT_ORDER.indexOf(id)
    if (idx >= 0) tourIndex.current = idx
  }

  function resumeTour() {
    setPaused(false)
  }

  return (
    <div id="demo" className="dual-demo" aria-label="Shelf product demonstration">
      <div className="dual-demo-toolbar">
        <p className="dual-demo-caption">
          Simulated — prepared states, not your local Mac.
        </p>
        {paused && !reducedMotion ? (
          <button type="button" className="demo-tour-btn" onClick={resumeTour}>
            Resume tour
          </button>
        ) : null}
      </div>

      <div className="demo-chips" role="group" aria-label="Try a prepared prompt">
        {DEMO_PROMPT_CHIPS.map((chip) => (
          <button
            key={chip.beatId}
            type="button"
            className="demo-chip"
            data-active={beatId === chip.beatId ? 'true' : undefined}
            aria-pressed={beatId === chip.beatId}
            onClick={() => selectBeat(chip.beatId)}
          >
            {chip.label}
          </button>
        ))}
      </div>

      <div className="dual-demo-grid" data-beat={beatId}>
        <section className="demo-surface" aria-labelledby="demo-agent-heading">
          <header className="demo-surface-head">
            <h3 id="demo-agent-heading">Agent</h3>
            <span className="demo-surface-meta">Cursor · MCP</span>
          </header>
          <ul className="demo-chat" key={beatId}>
            {beat.messages.map((msg, i) => (
              <li
                key={`${beatId}-${i}`}
                className="demo-chat-bubble"
                data-role={msg.role}
                style={{ animationDelay: reducedMotion ? '0ms' : `${i * 120}ms` }}
              >
                <span className="demo-chat-role">
                  {msg.role === 'user' ? 'You' : 'Agent'}
                </span>
                <p>{msg.text}</p>
              </li>
            ))}
          </ul>
        </section>

        <section
          className="demo-surface demo-surface--shelf"
          aria-labelledby="demo-shelf-heading"
        >
          <header className="demo-surface-head">
            <h3 id="demo-shelf-heading">Shelf</h3>
            <span className="demo-surface-meta">
              Library · {beat.tools.length} tools
            </span>
          </header>
          {beat.shelfNote ? (
            <p className="demo-shelf-note" key={`note-${beatId}`}>
              {beat.shelfNote}
            </p>
          ) : null}

          {beat.gaps.length > 0 ? (
            <div className="demo-gaps" aria-labelledby="demo-gaps-heading">
              <div className="demo-gaps-head">
                <h4 id="demo-gaps-heading">Capability Gaps</h4>
                <span className="demo-gaps-meta">Local inbox</span>
              </div>
              <ul className="demo-gaps-list">
                {beat.gaps.map((gap) => (
                  <li key={gap.id} className="demo-gap-row">
                    <div className="demo-gap-main">
                      <strong>{gap.task}</strong>
                      <span>{gap.reason}</span>
                    </div>
                    <span
                      className="demo-pill"
                      data-tone="warning"
                      title="Deduped occurrence count"
                    >
                      ×{gap.occurrenceCount}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <ul className="demo-tool-list" key={`tools-${beatId}`}>
            {beat.tools.map((tool) => (
              <ToolCard
                key={tool.id}
                tool={tool}
                featured={tool.id === beat.featuredToolId}
                showCapabilities={
                  showCapabilities &&
                  (tool.id === beat.featuredToolId || beatId === 'ready-scan')
                }
              />
            ))}
          </ul>
        </section>
      </div>
    </div>
  )
}
