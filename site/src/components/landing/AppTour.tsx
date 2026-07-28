'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ShelfMark } from '@/components/ShelfMark'

/**
 * Beat 02 — the app, live. A code-animated tour of the real macOS window:
 * Library launch → a capability gap being recorded → folder-scan registration
 * → MCP clients connecting. 30s loop in four segments; the pills jump the
 * clock. Ships zero video bytes — every frame is DOM.
 *
 * The clock only runs while the section is on screen. Reduced motion pins
 * each scene to its completed state (pills still switch scenes).
 */

const DUR = 30_000
const SEG = [0, 9_000, 16_000, 23_000]
/** Scene-complete timestamps used when the clock is pinned (reduced motion). */
const SEG_DONE = [8_400, 15_400, 22_400, 29_800]
const DESIGN_W = 1120
const DESIGN_H = 656

const TABS = ['Library', 'Capability gaps', 'Register a tool', 'MCP Connections']

const CAPTIONS = [
  'Every tool on one calm home screen — status and launch at a glance.',
  'An unmet ask becomes a recorded, deduped gap — a plan, not a silent failure.',
  'Point at a folder — Shelf scans and suggests the whole registration.',
  'Claude Desktop, Cursor, and Codex — connected in one click.',
]

const TOOLS = [
  {
    name: 'Image Prepper',
    desc: 'Accept Google map share link and downloads photos and AI reviews automatically.',
    iconBg: '#16a34a',
    iconPath: 'M4 5h16v14H4z M4 16l5-5 4 4 3-3 4 4',
    meta: [':5050', '8h ago', 'dev tool'],
  },
  {
    name: 'MCP Claude Setup',
    desc: 'Studio GUI that generates Claude Desktop / Claude Code MCP values.',
    iconBg: '#ea580c',
    iconPath:
      'M14.7 6.3a4.5 4.5 0 0 0-6 5.6L3 17.6V21h3.4l5.7-5.7a4.5 4.5 0 0 0 5.6-6l-3 3-2.3-2.3z',
    meta: [':5121', '2d ago', 'MCP'],
  },
  {
    name: 'MCP Codex Setup',
    desc: 'Studio GUI that generates Codex custom MCP values for WordPress.',
    iconBg: '#2563eb',
    iconPath:
      'M14.7 6.3a4.5 4.5 0 0 0-6 5.6L3 17.6V21h3.4l5.7-5.7a4.5 4.5 0 0 0 5.6-6l-3 3-2.3-2.3z',
    meta: [':5120', '2d ago', 'MCP'],
  },
  {
    name: 'Mermaid Studio',
    desc: 'Local-first Mermaid diagram studio for designing large-scale systems.',
    iconBg: '#db2777',
    iconPath: 'M4 4h6v6H4z M14 14h6v6h-6z M10 7h7v7',
    meta: [':3001', '8h ago', 'mermaid'],
  },
  {
    name: 'Section Builder',
    desc: 'Local studio + MCP for preparing page asset bundles (bcb-design-kit).',
    iconBg: '#6366f1',
    iconPath: 'M4 8l8-4 8 4v8l-8 4-8-4z M4 8l8 4 8-4 M12 12v8',
    meta: [':5111', '34h ago', 'WordPress'],
  },
]

const GAP_QUERY = 'Can anything fill PDF forms?'

const REG_ROWS = [
  ['NAME', 'CSV De-duper', false],
  ['LAUNCH', 'python cleanup.py --dedupe', true],
  ['PORT', 'none · one-shot', false],
  ['TAGS', 'csv · utility', false],
  ['CAPABILITIES', 'dedupe csv rows', false],
  ['AGENT ACCESS', 'CLI · ready', false],
  ['DESIGN.MD', 'Detected', false],
] as const

const CLIENTS = [
  { name: 'Claude Desktop', initial: 'C', iconBg: '#d97757', top: 22 },
  { name: 'Cursor', initial: 'Cu', iconBg: '#374151', top: 88 },
  { name: 'OpenAI Codex', initial: 'Cx', iconBg: '#0f766e', top: 154 },
]

/** Cursor waypoints inside the Library scene (design-space px). */
const WAYPOINTS = [
  { t: 1300, x: 560, y: 420, o: 0 },
  { t: 1900, x: 560, y: 420, o: 1 },
  { t: 3400, x: 150, y: 205, o: 1 },
  { t: 5900, x: 165, y: 215, o: 1 },
  { t: 7300, x: 560, y: 460, o: 0 },
]

function tabAt(t: number) {
  let tab = 0
  for (let i = 0; i < SEG.length; i++) if (t >= SEG[i]) tab = i
  return tab
}

/** Coarse state signature — re-render only when a visible beat changes. */
function beatSignature(t: number) {
  const tab = tabAt(t)
  const b: Array<number | boolean> = [tab]
  if (tab === 0) {
    b.push(
      Math.min(5, Math.floor(Math.max(0, t - 350) / 130)),
      t > 3700,
      t > 5100,
      t > 3500 && t < 4400,
    )
    let w = -1
    for (let i = 0; i < WAYPOINTS.length; i++) if (t >= WAYPOINTS[i].t) w = i
    b.push(w)
  } else if (tab === 1) {
    const gt = t - SEG[1]
    b.push(Math.min(28, Math.max(0, Math.floor((gt - 700) / 42))), gt > 2600, gt > 3400)
  } else if (tab === 2) {
    const rt = t - SEG[2]
    b.push(rt > 1500, Math.max(0, Math.min(7, Math.floor((rt - 1700) / 380) + 1)))
  } else {
    const mt = t - SEG[3]
    b.push(Math.max(0, Math.min(3, Math.floor((mt - 1100) / 1350) + 1)))
  }
  return b.join(',')
}

function usePinnedClock() {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => setReduced(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])
  return reduced
}

export function AppTour() {
  const [clock, setClock] = useState(0)
  const [pinnedTab, setPinnedTab] = useState(0)
  const [inView, setInView] = useState(false)
  const reduced = usePinnedClock()
  /* Reduced motion swaps the running clock for the scene-complete pin. */
  const t = reduced ? SEG_DONE[pinnedTab] : clock
  const sectionRef = useRef<HTMLElement | null>(null)
  const scaleRef = useRef<HTMLDivElement | null>(null)
  const [scale, setScale] = useState(1)
  const t0 = useRef<number>(0)
  const lastSig = useRef('')

  /* Scale the fixed-geometry window to the container, video-style. */
  useEffect(() => {
    const el = scaleRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => {
      setScale(Math.min(1, entry.contentRect.width / DESIGN_W))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const el = sectionRef.current
    if (!el) return
    const io = new IntersectionObserver(
      ([entry]) => setInView(entry.isIntersecting),
      { threshold: 0.2 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  /* The clock. Runs only on screen and only when motion is welcome. */
  useEffect(() => {
    if (reduced || !inView) return
    t0.current = performance.now() - clock
    const iv = setInterval(() => {
      const next = (performance.now() - t0.current) % DUR
      const sig = beatSignature(next)
      if (sig !== lastSig.current) {
        lastSig.current = sig
        setClock(next)
      }
    }, 100)
    return () => clearInterval(iv)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inView, reduced])

  const selectTab = useCallback(
    (i: number) => {
      if (reduced) {
        setPinnedTab(i)
        return
      }
      t0.current = performance.now() - SEG[i]
      lastSig.current = ''
      setClock(SEG[i])
    },
    [reduced],
  )

  /* ---- Derived scene state (ported beat-for-beat from the design) ------- */
  const tab = tabAt(t)

  // Library
  const lt = t - SEG[0]
  const launched = tab === 0 ? lt > 5100 : true
  const starting = tab === 0 && lt > 3700 && !launched
  const cardOn = (i: number) => tab !== 0 || lt > 350 + i * 130
  const ipStatus = launched ? 'Running' : starting ? 'Starting…' : 'Stopped'
  const runningCount = launched ? 1 : 0

  // Cursor — render the next waypoint as target; CSS transition covers the leg.
  let cx = WAYPOINTS[0].x
  let cy = WAYPOINTS[0].y
  let co = 0
  let cdur = 100
  if (!reduced && tab === 0) {
    let w = -1
    for (let i = 0; i < WAYPOINTS.length; i++) if (lt >= WAYPOINTS[i].t) w = i
    if (w >= 0) {
      const tgt = WAYPOINTS[Math.min(w + 1, WAYPOINTS.length - 1)]
      cx = tgt.x
      cy = tgt.y
      co = tgt.o
      cdur = Math.max(250, tgt.t - WAYPOINTS[w].t)
    }
  }
  const rippleOn = !reduced && tab === 0 && lt > 3500 && lt < 4400

  // Capability gaps
  const gt = t - SEG[1]
  const gapChars =
    tab < 1 ? 0 : tab > 1 ? GAP_QUERY.length
    : Math.max(0, Math.min(GAP_QUERY.length, Math.floor((gt - 700) / 42)))
  const gapTyped = gapChars >= GAP_QUERY.length
  const gapAnswer = tab > 1 || (tab === 1 && gt > 2600)
  const gapCard = tab > 1 || (tab === 1 && gt > 3400)

  // Register a tool
  const rt = t - SEG[2]
  const scanned = tab > 2 || (tab === 2 && rt > 1500)
  const regRowOn = (i: number) => tab > 2 || (tab === 2 && rt > 1700 + i * 380)
  const regDone = tab > 2 || (tab === 2 && rt > 1700 + REG_ROWS.length * 380)

  // MCP Connections
  const mt = t - SEG[3]
  const clientOn = (i: number) => tab === 3 && mt > 1100 + i * 1350
  const connectedCount = CLIENTS.filter((_, i) => clientOn(i)).length

  const libActive = tab === 0 ? 'All tools' : tab === 1 ? 'Capability gaps' : ''

  return (
    <section
      id="app"
      ref={sectionRef}
      className="section"
      aria-labelledby="app-heading"
    >
      <div className="section-inner">
        <div className="section-head section-head--center" data-reveal>
          <p className="eyebrow">The app</p>
          <h2 id="app-heading">This is Shelf.</h2>
          <p className="section-lead">
            The real macOS app — the same library, gaps, and connections your
            agents see over MCP.
          </p>
        </div>

        <div className="tour" data-reveal style={{ '--reveal-order': 1 } as React.CSSProperties}>
          <div className="tour-tabs" role="group" aria-label="Tour scenes">
            {TABS.map((label, i) => (
              <button
                key={label}
                type="button"
                className="tour-tab"
                data-active={i === tab || undefined}
                aria-pressed={i === tab}
                onClick={() => selectTab(i)}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="tour-scale" ref={scaleRef} style={{ height: DESIGN_H * scale }}>
            <div
              className="tour-window"
              style={{ transform: `scale(${scale})` }}
              aria-hidden
            >
              <div className="tour-titlebar">
                <span className="tour-dot tour-dot--r" />
                <span className="tour-dot tour-dot--y" />
                <span className="tour-dot tour-dot--g" />
                <span className="tour-titlebar-label">Shelf</span>
              </div>

              <div className="tour-body">
                {/* Sidebar */}
                <div className="tour-sidebar">
                  <div className="tour-side-brand">
                    <ShelfMark className="tour-side-mark" />
                    <div>
                      <div className="tour-side-name">Shelf</div>
                      <div className="tour-side-sub">Local tools</div>
                    </div>
                  </div>
                  <div className="tour-side-label">Library</div>
                  {(
                    [
                      ['All tools', '5'],
                      ['Favorites', '0'],
                      ['Running', String(runningCount)],
                      ['Recent', '5'],
                      ['Capability gaps', '1'],
                    ] as const
                  ).map(([label, count]) => (
                    <div
                      key={label}
                      className="tour-side-item"
                      data-active={label === libActive || undefined}
                    >
                      <span>{label}</span>
                      <span className="tour-side-count">{count}</span>
                    </div>
                  ))}
                  <div className="tour-side-label">Collections</div>
                  {(
                    [
                      ['GWP Tools', '3'],
                      ['Suds Tools', '2'],
                      ['+ New collection', ''],
                    ] as const
                  ).map(([label, count]) => (
                    <div key={label} className="tour-side-item">
                      <span>{label}</span>
                      <span className="tour-side-count">{count}</span>
                    </div>
                  ))}
                  <div className="tour-side-label">System</div>
                  {(['MCP Connections', 'Settings'] as const).map((label) => (
                    <div
                      key={label}
                      className="tour-side-item"
                      data-active={(tab === 3 && label === 'MCP Connections') || undefined}
                    >
                      <span>{label}</span>
                    </div>
                  ))}
                </div>

                {/* Main pane */}
                <div className="tour-main">
                  {/* Scene 1 · Library */}
                  <div className="tour-scene" style={{ display: tab === 0 ? 'block' : 'none' }}>
                    <div className="tour-pane-head">
                      <div>
                        <div className="tour-pane-title">Library</div>
                        <div className="tour-pane-sub">
                          5 tools ·{' '}
                          <span style={{ color: launched ? '#34d399' : undefined }}>
                            {runningCount} running
                          </span>
                        </div>
                      </div>
                      <div className="tour-btn-primary">Add tool</div>
                    </div>
                    <div className="tour-toolbar">
                      <div className="tour-search">Search name, tags, or command</div>
                      <div className="tour-chip">Filter</div>
                      <div className="tour-toolbar-hint">Sort</div>
                      <div className="tour-chip">Name</div>
                    </div>
                    <div className="tour-grid">
                      {TOOLS.map((tool, i) => {
                        const isIP = i === 0
                        const on = cardOn(i)
                        const running = isIP && launched
                        const status = isIP ? ipStatus : 'Stopped'
                        return (
                          <div
                            key={tool.name}
                            className="tour-card"
                            style={{
                              opacity: on ? 1 : 0,
                              transform: on ? 'translateY(0)' : 'translateY(14px)',
                              borderColor: running ? 'rgba(52,211,153,.4)' : undefined,
                              boxShadow: running ? '0 0 26px rgba(52,211,153,.12)' : undefined,
                            }}
                          >
                            <div className="tour-card-top">
                              <div className="tour-card-icon" style={{ background: tool.iconBg }}>
                                <svg
                                  width="18"
                                  height="18"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="#fff"
                                  strokeWidth="1.8"
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                >
                                  <path d={tool.iconPath} />
                                </svg>
                              </div>
                              <div
                                className="tour-status"
                                style={
                                  isIP
                                    ? {
                                        background: launched
                                          ? 'rgba(52,211,153,.12)'
                                          : starting
                                            ? 'rgba(251,191,36,.12)'
                                            : undefined,
                                        color: launched
                                          ? '#34d399'
                                          : starting
                                            ? '#fbbf24'
                                            : undefined,
                                      }
                                    : undefined
                                }
                              >
                                <span
                                  className="tour-status-dot"
                                  style={{
                                    background: isIP
                                      ? launched
                                        ? '#34d399'
                                        : starting
                                          ? '#fbbf24'
                                          : undefined
                                      : undefined,
                                    animation:
                                      running || starting
                                        ? 'shelfPulse 1.4s infinite'
                                        : undefined,
                                  }}
                                />
                                {status}
                              </div>
                            </div>
                            <div className="tour-card-name">{tool.name}</div>
                            <div className="tour-card-desc">{tool.desc}</div>
                            <div className="tour-card-meta">
                              {tool.meta.map((m, mi) => (
                                <span key={m} className="tour-tag">
                                  {isIP && mi === 0 && launched ? ':5050 · live' : m}
                                </span>
                              ))}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>

                  {/* Scene 2 · Capability gaps */}
                  <div className="tour-scene" style={{ display: tab === 1 ? 'block' : 'none' }}>
                    <div className="tour-pane-title">Capability gaps</div>
                    <div className="tour-pane-sub tour-pane-sub--lede">
                      Unmet needs, recorded and deduped — plans, not silent failures.
                    </div>
                    <div className="tour-gap-thread">
                      <div className="tour-gap-row">
                        <div className="tour-gap-avatar">Cu</div>
                        <div className="tour-gap-bubble">
                          {GAP_QUERY.slice(0, gapChars)}
                          <span
                            className="tour-gap-caret"
                            style={{ opacity: tab === 1 && !gapTyped ? 1 : 0 }}
                          />
                        </div>
                      </div>
                      <div className="tour-gap-row" style={{ opacity: gapAnswer ? 1 : 0 }}>
                        <ShelfMark className="tour-gap-mark" />
                        <div className="tour-gap-reply">
                          No tool declares this capability — recording the gap.
                        </div>
                      </div>
                      <div
                        className="tour-gap-card"
                        style={{
                          opacity: gapCard ? 1 : 0,
                          transform: gapCard ? 'translateY(0)' : 'translateY(16px)',
                        }}
                      >
                        <div className="tour-gap-card-head">
                          <div className="tour-gap-card-title">Fill PDF forms</div>
                          <span className="tour-gap-pill">Gap · open</span>
                        </div>
                        <div className="tour-gap-facts">
                          <div>
                            <div className="tour-fact-label">Recurrence</div>
                            <div className="tour-fact-value">×3 this week</div>
                          </div>
                          <div>
                            <div className="tour-fact-label">Last request</div>
                            <div className="tour-fact-value">just now · Cursor</div>
                          </div>
                          <div>
                            <div className="tour-fact-label">Recorded in</div>
                            <div className="tour-fact-value tour-fact-value--mono">
                              capability-gaps.json
                            </div>
                          </div>
                        </div>
                        <div className="tour-gap-actions">
                          <div className="tour-btn-primary">Create tool</div>
                          <div className="tour-btn-ghost">Dismiss</div>
                        </div>
                      </div>
                      <div className="tour-footnote" style={{ opacity: gapCard ? 1 : 0 }}>
                        Deduped — a repeat ask increments recurrence instead of adding a row.
                      </div>
                    </div>
                  </div>

                  {/* Scene 3 · Register a tool */}
                  <div className="tour-scene" style={{ display: tab === 2 ? 'block' : 'none' }}>
                    <div className="tour-pane-title">Register a tool</div>
                    <div className="tour-pane-sub tour-pane-sub--lede">
                      Point at the folder. Shelf remembers the ritual.
                    </div>
                    <div className="tour-reg">
                      <div className="tour-reg-drop">
                        <div className="tour-reg-path">~/Projects/csv-de-duper</div>
                        <div
                          className="tour-status tour-status--scan"
                          style={{
                            background: scanned ? 'rgba(52,211,153,.1)' : 'rgba(251,191,36,.1)',
                            color: scanned ? '#34d399' : '#fbbf24',
                          }}
                        >
                          <span
                            className="tour-status-dot"
                            style={{
                              background: scanned ? '#34d399' : '#fbbf24',
                              animation: scanned ? undefined : 'shelfPulse 1s infinite',
                            }}
                          />
                          {scanned ? 'Scanned' : 'Scanning…'}
                        </div>
                        <div className="tour-reg-hint">
                          Scripts, ports, package manager,
                          <br />
                          and DESIGN.md — detected for you.
                        </div>
                      </div>
                      <div className="tour-reg-form">
                        {REG_ROWS.map(([label, value, mono], i) => (
                          <div
                            key={label}
                            className="tour-reg-row"
                            style={{
                              opacity: regRowOn(i) ? 1 : 0,
                              transform: regRowOn(i) ? 'translateX(0)' : 'translateX(10px)',
                            }}
                          >
                            <div className="tour-reg-label">{label}</div>
                            <div className={mono ? 'tour-reg-value tour-reg-value--mono' : 'tour-reg-value'}>
                              {value}
                            </div>
                          </div>
                        ))}
                        <div className="tour-reg-actions" style={{ opacity: regDone ? 1 : 0.25 }}>
                          <div
                            className="tour-btn-primary"
                            style={{
                              boxShadow: regDone ? '0 0 22px rgba(99,102,241,.45)' : undefined,
                            }}
                          >
                            Add to library
                          </div>
                          <div className="tour-btn-ghost">Edit details</div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Scene 4 · MCP Connections */}
                  <div className="tour-scene" style={{ display: tab === 3 ? 'block' : 'none' }}>
                    <div className="tour-pane-title">MCP Connections</div>
                    <div className="tour-pane-sub tour-pane-sub--lede">
                      One library, every agent — one-click config, your other servers untouched.
                    </div>
                    <div className="tour-mcp">
                      <div className="tour-mcp-clients">
                        {CLIENTS.map((client, i) => {
                          const on = clientOn(i)
                          return (
                            <div
                              key={client.name}
                              className="tour-mcp-client"
                              style={{ borderColor: on ? 'rgba(52,211,153,.3)' : undefined }}
                            >
                              <div
                                className="tour-mcp-avatar"
                                style={{ background: client.iconBg }}
                              >
                                {client.initial}
                              </div>
                              <div className="tour-mcp-meta">
                                <div className="tour-mcp-name">{client.name}</div>
                                <div
                                  className="tour-mcp-status"
                                  style={{ color: on ? '#34d399' : undefined }}
                                >
                                  {on ? 'Connected' : 'Writing config…'}
                                </div>
                              </div>
                              <span
                                className="tour-status-dot tour-status-dot--lg"
                                style={{
                                  background: on ? '#34d399' : '#3d4353',
                                  animation: on ? 'shelfPulse 1.6s infinite' : undefined,
                                }}
                              />
                            </div>
                          )
                        })}
                      </div>
                      <div className="tour-mcp-lines">
                        {CLIENTS.map((client, i) => {
                          const on = clientOn(i)
                          return (
                            <div
                              key={client.name}
                              className="tour-mcp-line"
                              style={{
                                top: client.top,
                                opacity: on ? 1 : 0.35,
                                background: on
                                  ? 'linear-gradient(90deg, rgba(52,211,153,.5), rgba(99,102,241,.35))'
                                  : 'rgba(255,255,255,.06)',
                              }}
                            >
                              <span
                                className="tour-mcp-packet"
                                style={{
                                  animation: on
                                    ? `shelfFlow 1.8s ${i * 0.6}s infinite`
                                    : undefined,
                                }}
                              />
                            </div>
                          )
                        })}
                      </div>
                      <div
                        className="tour-mcp-hub"
                        style={{
                          boxShadow:
                            connectedCount === 3 ? '0 0 40px rgba(99,102,241,.25)' : undefined,
                        }}
                      >
                        <div className="tour-mcp-hub-head">
                          <ShelfMark className="tour-mcp-hub-mark" />
                          <div>
                            <div className="tour-mcp-hub-name">The shelf</div>
                            <div className="tour-mcp-hub-sub">Local · 5 tools</div>
                          </div>
                        </div>
                        <div className="tour-mcp-hub-path">
                          ~/Library/Application Support/
                          <br />
                          Shelf/library.json
                        </div>
                      </div>
                    </div>
                    <div
                      className="tour-footnote"
                      style={{ opacity: connectedCount === 3 ? 1 : 0 }}
                    >
                      list · register · launch · stop · logs · discover — the same verbs your
                      desktop app uses.
                    </div>
                  </div>

                  {/* Cursor overlay (Library scene) */}
                  <div
                    className="tour-cursor"
                    style={{
                      transform: `translate(${cx}px, ${cy}px)`,
                      opacity: co,
                      transitionDuration: `${cdur}ms, 500ms`,
                    }}
                  >
                    <svg width="22" height="22" viewBox="0 0 24 24">
                      <path
                        d="M5 3l14 8.5-6.2 1.3L9.5 19z"
                        fill="#fff"
                        stroke="#0b101c"
                        strokeWidth="1.5"
                      />
                    </svg>
                    <span
                      className="tour-cursor-ripple"
                      style={{ animation: rippleOn ? 'shelfRipple .7s ease-out' : undefined }}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>

          <p className="tour-caption" aria-live="off">
            {CAPTIONS[tab]}
          </p>
        </div>
      </div>
    </section>
  )
}
