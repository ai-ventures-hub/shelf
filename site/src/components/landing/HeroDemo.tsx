'use client'

import { useEffect, useState, useSyncExternalStore } from 'react'
import {
  DEMO_BEAT_ORDER,
  DEMO_BEATS,
  READINESS_LABEL,
  type DemoBeatId,
  type DemoReadiness,
  type DemoToolStatus,
} from '@/lib/demo-states'
import { ToolTile } from './ToolTile'

/** Typing cadence and dwell — full 5-beat loop lands around 30s. */
const TYPE_MS = 34
const REPLY_DELAY_MS = 450
const HOLD_MS = 4200

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

/** The one gap fixture — always mounted (hidden) to reserve its row height. */
const GAP_FIXTURE = DEMO_BEATS.gap.gap!

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
 * Hero command-deck demo — an ambient loop where each question is typed
 * into the YOU box, the agent answers, and the library reacts.
 * Every beat renders stacked in the same grid cell, so the panel height
 * never changes and the page never jumps. Prepared states only; no live
 * filesystem or MCP.
 */
export function HeroDemo() {
  // Reduced motion: no loop, land on the capability beat fully rendered.
  const reducedMotion = useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia(REDUCED_MOTION_QUERY).matches,
    () => false,
  )
  const [beatIndex, setBeatIndex] = useState(0)
  const [typedCount, setTypedCount] = useState(0)
  const [phase, setPhase] = useState<'typing' | 'reply'>('typing')
  // The Shelf panel lags the typing: it updates when the agent answers.
  const [shelfBeatId, setShelfBeatId] = useState<DemoBeatId>('import')

  const beat = DEMO_BEATS[DEMO_BEAT_ORDER[beatIndex]]

  useEffect(() => {
    if (reducedMotion) return
    if (phase === 'typing') {
      if (typedCount < beat.user.length) {
        const timer = window.setTimeout(() => setTypedCount((c) => c + 1), TYPE_MS)
        return () => window.clearTimeout(timer)
      }
      const timer = window.setTimeout(() => {
        setShelfBeatId(beat.id)
        setPhase('reply')
      }, REPLY_DELAY_MS)
      return () => window.clearTimeout(timer)
    }
    const timer = window.setTimeout(() => {
      setBeatIndex((i) => (i + 1) % DEMO_BEAT_ORDER.length)
      setTypedCount(0)
      setPhase('typing')
    }, HOLD_MS)
    return () => window.clearTimeout(timer)
  }, [phase, typedCount, beatIndex, reducedMotion, beat.id, beat.user])

  const activeBeatId = reducedMotion ? 'capability' : beat.id
  const typing = !reducedMotion && phase === 'typing'
  const showReply = reducedMotion || phase === 'reply'
  const shelf = DEMO_BEATS[reducedMotion ? 'capability' : shelfBeatId]

  return (
    <div id="demo" className="hero-demo" aria-label="Shelf product demonstration">
      <section className="demo-panel" aria-labelledby="demo-agent-heading">
        <header className="demo-panel-head">
          <h3 id="demo-agent-heading">Agent</h3>
          <span className="demo-panel-meta">Cursor · MCP</span>
        </header>
        <div className="demo-msgs">
          {DEMO_BEAT_ORDER.map((id) => {
            const b = DEMO_BEATS[id]
            const active = id === activeBeatId
            return (
              <div
                key={id}
                className="demo-msg-pair"
                data-active={active ? 'true' : 'false'}
                aria-hidden={!active}
              >
                <div className="demo-msg" data-role="user">
                  <span className="demo-msg-label">You</span>
                  <p>
                    {active && !reducedMotion ? b.user.slice(0, typedCount) : b.user}
                    {active && typing ? <span className="demo-caret" aria-hidden /> : null}
                  </p>
                </div>
                <div
                  className="demo-msg"
                  data-role="agent"
                  data-shown={!active || showReply ? 'true' : 'false'}
                >
                  <span className="demo-msg-label">Agent</span>
                  <p>{b.agent}</p>
                </div>
              </div>
            )
          })}
        </div>
      </section>

      <section className="demo-panel" aria-labelledby="demo-shelf-heading">
        <header className="demo-panel-head">
          <h3 id="demo-shelf-heading">Shelf</h3>
          <span className="demo-panel-meta">Library · {shelf.tools.length} tools</span>
        </header>
        <div className="demo-note-stack">
          {DEMO_BEAT_ORDER.map((id) => (
            <p
              key={id}
              className="demo-note"
              data-active={id === shelf.id ? 'true' : 'false'}
              aria-hidden={id !== shelf.id}
            >
              {DEMO_BEATS[id].shelfNote}
            </p>
          ))}
        </div>
        <ul className="demo-tool-list">
          {shelf.tools.map((tool) => (
            <li
              key={tool.id}
              className="demo-tool-row"
              data-featured={tool.id === 'image-prepper' ? 'true' : undefined}
            >
              <ToolTile toolId={tool.id} />
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
          <li
            className="demo-gap-row"
            data-shown={shelf.gap ? 'true' : 'false'}
            aria-hidden={!shelf.gap}
          >
            <div className="demo-tool-copy">
              <strong>{GAP_FIXTURE.task}</strong>
              <span>{GAP_FIXTURE.reason}</span>
            </div>
            <span className="pill" data-tone="warning">
              Gap · open
            </span>
          </li>
        </ul>
      </section>

      <p className="demo-caption">Simulated — prepared states, not your local Mac.</p>
    </div>
  )
}
