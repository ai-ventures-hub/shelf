'use client'

import { useEffect, useState, useSyncExternalStore } from 'react'
import { DROP_PHASE_LABELS, SCAN_ROWS } from '@/lib/landing-demos'

const REDUCED_QUERY = '(prefers-reduced-motion: reduce)'

function subscribeReducedMotion(onChange: () => void) {
  const mq = window.matchMedia(REDUCED_QUERY)
  mq.addEventListener('change', onChange)
  return () => mq.removeEventListener('change', onChange)
}

/**
 * #how — the simulated drop-to-run loop. Four phases on a 3200ms clock;
 * panels are keyed by phase so the fadeUp entrance replays on every swap.
 * Reduced motion pins to the finished Running card instead of looping.
 */
export function DropDemo() {
  const reduced = useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia(REDUCED_QUERY).matches,
    () => false,
  )
  const [tick, setTick] = useState(0)
  const phase = reduced ? 3 : tick

  useEffect(() => {
    if (reduced) return
    const timer = setInterval(() => setTick((p) => (p + 1) % 4), 3200)
    return () => clearInterval(timer)
  }, [reduced])

  return (
    <div className="drop-shell">
      <div className="mock-window mock-window--drop">
        <div className="drop-titlebar">
          <span className="traffic traffic--sm" aria-hidden>
            <span />
            <span />
            <span />
          </span>
          <span className="drop-titlebar-app">SHELF · LIBRARY</span>
          <span className="drop-titlebar-phase">{DROP_PHASE_LABELS[phase]}</span>
        </div>
        <div className="drop-stage">
          {phase === 0 && (
            <div className="drop-zone" key="p0">
              <div className="drop-zone-box">
                <div className="drop-folder" aria-hidden>
                  <div className="drop-folder-tab" />
                  <div className="drop-folder-body" />
                </div>
                <div className="drop-zone-title">Drop your project here</div>
                <div className="drop-zone-sub">
                  the folder Claude Code just made counts
                </div>
              </div>
            </div>
          )}
          {phase === 1 && (
            <div className="drop-panel drop-scan" key="p1">
              <div className="drop-kicker">Reading portfolio-site/</div>
              {SCAN_ROWS.map((row) => (
                <div className="drop-scan-row" key={row.left}>
                  <span>{row.left}</span>
                  <span data-tone={row.tone}>{row.right}</span>
                </div>
              ))}
              <div className="drop-scan-note">
                You didn’t answer a single question.
              </div>
            </div>
          )}
          {phase === 2 && (
            <div className="drop-panel drop-install" key="p2">
              <div className="drop-kicker">Packages weren’t installed yet</div>
              <div className="drop-install-box">
                <div className="drop-install-row">
                  <span>npm install</span>
                  <span>running…</span>
                </div>
                <div className="drop-bar">
                  <div className="drop-bar-fill" />
                </div>
              </div>
              <div className="drop-install-note">
                Shelf asked once, then handled it. Never silently, never with
                sudo.
              </div>
            </div>
          )}
          {phase === 3 && (
            <div className="drop-panel drop-running" key="p3">
              <div className="drop-running-card">
                <div className="drop-running-head">
                  <span className="lt lt--lg" aria-hidden>
                    P
                  </span>
                  <span className="drop-running-id">
                    <span className="drop-running-name">portfolio-site</span>
                    <span className="drop-running-url">
                      http://localhost:3001
                    </span>
                  </span>
                  <span className="drop-running-pill">● Running</span>
                </div>
                <div className="drop-running-actions">
                  <span className="mock-btn mock-btn--primary">Open</span>
                  <span className="mock-btn">Stop</span>
                  <span className="drop-running-clients">
                    Connected: Claude Code · Cursor
                  </span>
                </div>
              </div>
              <div className="drop-running-note">
                Next week you won’t remember the command. You won’t need to.
              </div>
            </div>
          )}
        </div>
        <div className="drop-dots" aria-hidden>
          {[0, 1, 2, 3].map((i) => (
            <span key={i} data-active={i === phase ? 'true' : 'false'} />
          ))}
        </div>
      </div>
      <p className="drop-note">Simulated loop. The real thing is about this fast.</p>
    </div>
  )
}
