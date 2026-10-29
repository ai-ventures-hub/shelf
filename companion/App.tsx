import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CompanionOverview, CompanionPreviewGrant, CompanionTool } from '../shared/companion-contracts'
import type { LogLine, ToolRuntimeState, ToolStatus } from '../shared/contracts'
import { dockBadgeText } from '../shared/desktop-status'
import { api, ApiError, clearPaired, connectLive, getToken, setPaired } from './api'

type Route =
  | { name: 'tools' }
  | { name: 'tool'; id: string }
  | { name: 'stacks' }
  | { name: 'more' }

function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean)
  if (parts[0] === 'tools' && parts[1]) return { name: 'tool', id: decodeURIComponent(parts[1]) }
  if (parts[0] === 'stacks' || parts[0] === 'collections') return { name: 'stacks' }
  if (parts[0] === 'more') return { name: 'more' }
  return { name: 'tools' }
}

function useRoute(): [Route, (hash: string) => void] {
  const [route, setRoute] = useState<Route>(() => parseRoute(location.hash))
  useEffect(() => {
    const onChange = () => setRoute(parseRoute(location.hash))
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return [route, (hash) => { location.hash = hash }]
}

/** `/pair#CODE.FINGERPRINT` from the QR, or nothing. */
function pairingFromLocation(): { code: string; fingerprint: string } | null {
  if (location.pathname !== '/pair') return null
  const [code, fingerprint] = location.hash.replace(/^#/, '').split('.')
  return code ? { code, fingerprint: fingerprint || '' } : null
}

function formatFingerprint(hex: string): string {
  return (hex.match(/.{1,2}/g) || []).join(':').toUpperCase()
}

/** True when launched from the Home Screen: its storage is separate from Safari's. */
function isStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean }
  return nav.standalone === true || window.matchMedia('(display-mode: standalone)').matches
}

function statusLabel(status: ToolStatus | undefined): string {
  switch (status) {
    case 'running': return 'Running'
    case 'starting': return 'Starting'
    case 'stopping': return 'Stopping'
    case 'error': return 'Error'
    default: return 'Stopped'
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function CompanionApp() {
  const [token, setToken] = useState<string | null>(() => getToken())
  if (!token) return <PairScreen onPaired={() => setToken(getToken())} />
  return <Shell onUnpaired={() => setToken(null)} />
}

// ---- pairing ----------------------------------------------------------------

function guessDeviceName(): string {
  const ua = navigator.userAgent
  const base = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android phone' : 'Phone'
  return isStandalone() ? `${base} (Home Screen)` : base
}

function PairScreen({ onPaired }: { onPaired: () => void }) {
  const fromQr = useMemo(pairingFromLocation, [])
  const [code, setCode] = useState(fromQr?.code || '')
  const [name, setName] = useState(() => guessDeviceName())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const autoTried = useRef(false)

  const pair = useCallback(async (offered: string) => {
    setBusy(true)
    setError(null)
    try {
      const result = await api.pair(offered.trim().toUpperCase(), name.trim())
      setPaired(result)
      history.replaceState(null, '', '/')
      onPaired()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }, [name, onPaired])

  useEffect(() => {
    if (fromQr && !autoTried.current) {
      autoTried.current = true
      void pair(fromQr.code)
    }
  }, [fromQr, pair])

  return (
    <div className="app">
      <main className="scroll pair">
        <h1>Shelf</h1>
        {isStandalone() ? (
          <p className="muted">
            The Home Screen app keeps its own pairing, separate from Safari. On the Mac open
            Settings → Companion, press <strong>Pair a device</strong>, and type the 8-character code
            shown under the QR.
          </p>
        ) : (
          <p className="muted">
            Pair this phone with the Shelf on your Mac: Settings → Companion, scan the QR code, or type
            the code it shows. A copy added to the Home Screen will ask to pair once more.
          </p>
        )}
        {fromQr?.fingerprint ? (
          <p className="muted small fingerprint">
            Certificate fingerprint from the QR: <code>{formatFingerprint(fromQr.fingerprint)}</code>
          </p>
        ) : null}
        <label className="field">
          <span>Pairing code</span>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            autoCapitalize="characters"
            autoComplete="one-time-code"
            placeholder="8 characters"
          />
        </label>
        <label className="field">
          <span>Name this phone</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
        </label>
        {error ? <p className="notice error" role="alert">{error}</p> : null}
        <button type="button" className="btn primary block" disabled={busy || code.trim().length < 6} onClick={() => void pair(code)}>
          {busy ? 'Pairing…' : 'Pair'}
        </button>
      </main>
    </div>
  )
}

// ---- shell -------------------------------------------------------------------

function Shell({ onUnpaired }: { onUnpaired: () => void }) {
  const [route, go] = useRoute()
  const [overview, setOverview] = useState<CompanionOverview | null>(null)
  const [states, setStates] = useState<Map<string, ToolRuntimeState>>(new Map())
  const [live, setLive] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const logSink = useRef<((line: LogLine) => void) | null>(null)
  const scroll = useRef<HTMLElement | null>(null)

  const refresh = useCallback(async () => {
    try {
      const next = await api.overview()
      setOverview(next)
      setStates((prev) => {
        const merged = new Map(prev)
        for (const state of next.states) merged.set(state.toolId, state)
        return merged
      })
      setError(null)
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        clearPaired()
        onUnpaired()
        return
      }
      setError(errorMessage(err))
    }
  }, [onUnpaired])

  useEffect(() => { void refresh() }, [refresh])

  useEffect(() => {
    const refreshLater = debounce(() => void refresh(), 400)
    return connectLive((message) => {
      if (message.type === 'hello') {
        setStates((prev) => {
          const next = new Map(prev)
          for (const state of message.states) next.set(state.toolId, state)
          return next
        })
      } else if (message.type === 'process:update') {
        setStates((prev) => new Map(prev).set(message.state.toolId, message.state))
      } else if (message.type === 'logs:line') {
        logSink.current?.(message.line)
      } else if (message.type === 'library:changed' || message.type === 'receipts:update') {
        refreshLater()
      }
    }, (open) => {
      setLive(open)
      // iOS drops the socket whenever the app is backgrounded; the overview
      // is the full truth, so fetch it again on every reconnect.
      if (open) void refresh()
    })
  }, [refresh])

  // Each screen starts at the top; only the middle scrolls.
  const routeKey = route.name === 'tool' ? `tool:${route.id}` : route.name
  useEffect(() => { scroll.current?.scrollTo({ top: 0 }) }, [routeKey])

  // Running count on the Home Screen icon, same rule as the Dock badge.
  useEffect(() => {
    const badge = dockBadgeText([...states.values()])
    const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> }
    if (badge) void nav.setAppBadge?.(Number(badge)).catch(() => undefined)
    else void nav.clearAppBadge?.().catch(() => undefined)
  }, [states])

  const tools = overview?.tools ?? []
  const health = overview?.health ?? []
  const running = [...states.values()].filter((state) => state.status === 'running').length
  const title = route.name === 'stacks' ? 'Stacks' : route.name === 'more' ? 'More' : 'Tools'

  return (
    <div className="app">
      <header className="top">
        <h1>{route.name === 'tool' ? 'Shelf' : title}</h1>
        <span className={`live${live ? ' is-live' : ''}`} aria-label={live ? 'Live' : 'Reconnecting'}>
          <i />{live ? `${running} running` : 'Reconnecting…'}
        </span>
      </header>
      <main className="scroll" ref={scroll}>
        {error ? <p className="notice error" role="alert">{error} <button type="button" className="link" onClick={() => void refresh()}>Retry</button></p> : null}
        {route.name === 'tools' ? <ToolsScreen tools={tools} states={states} health={health} loaded={Boolean(overview)} go={go} /> : null}
        {route.name === 'tool' ? (
          <ToolScreen
            tool={tools.find((item) => item.id === route.id) || null}
            state={states.get(route.id)}
            health={health.find((item) => item.toolId === route.id)}
            onLogSink={(sink) => { logSink.current = sink }}
            onStateChange={(state) => setStates((prev) => new Map(prev).set(state.toolId, state))}
            onRefresh={() => void refresh()}
          />
        ) : null}
        {route.name === 'stacks' ? <StacksScreen overview={overview} states={states} /> : null}
        {route.name === 'more' ? <MoreScreen overview={overview} onUnpaired={onUnpaired} /> : null}
      </main>
      <nav className="tabs" aria-label="Sections">
        <Tab hash="#/" active={route.name === 'tools' || route.name === 'tool'} label="Tools" icon="◫" />
        <Tab hash="#/stacks" active={route.name === 'stacks'} label="Stacks" icon="☰" />
        <Tab hash="#/more" active={route.name === 'more'} label="More" icon="⋯" />
      </nav>
    </div>
  )
}

function Tab({ hash, active, label, icon }: { hash: string; active: boolean; label: string; icon: string }) {
  return (
    <a href={hash} aria-current={active ? 'page' : undefined}>
      <span className="tab-icon" aria-hidden="true">{icon}</span>
      {label}
    </a>
  )
}

function debounce(fn: () => void, ms: number): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  return () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(fn, ms)
  }
}

// ---- tools ---------------------------------------------------------------------

function StatusPill({ status, compact = false }: { status: ToolStatus | undefined; compact?: boolean }) {
  return <span className={`pill is-${status || 'stopped'}${compact ? ' compact' : ''}`}>{statusLabel(status)}</span>
}

function Tile({ tool, size = 'm' }: { tool: CompanionTool; size?: 'm' | 'l' }) {
  return (
    <span
      className={`tile ${size}`}
      style={{ background: tool.iconBackground || 'var(--panel-raised)', color: tool.iconColor || 'var(--ink)' }}
      aria-hidden="true"
    >
      {tool.name.trim().charAt(0).toUpperCase() || '•'}
    </span>
  )
}

function ToolsScreen({ tools, states, health, loaded, go }: {
  tools: CompanionTool[]
  states: Map<string, ToolRuntimeState>
  health: CompanionOverview['health']
  loaded: boolean
  go: (hash: string) => void
}) {
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  const matches = tools
    .filter((tool) => !q || tool.name.toLowerCase().includes(q) || tool.tags.some((tag) => tag.toLowerCase().includes(q)))
    .sort((a, b) => a.name.localeCompare(b.name))
  const active = matches.filter((tool) => {
    const status = states.get(tool.id)?.status
    return status === 'running' || status === 'starting' || status === 'stopping' || status === 'error'
  })
  const idle = matches.filter((tool) => !active.includes(tool))

  const row = (tool: CompanionTool) => {
    const state = states.get(tool.id)
    const problem = health.find((item) => item.toolId === tool.id)
    const hint = state?.status === 'error'
      ? state.message || 'Stopped with an error'
      : problem && !problem.launchable && state?.status !== 'running'
        ? problem.problems[0]
        : tool.description || (tool.port ? `Port ${tool.port}` : '')
    return (
      <li key={tool.id}>
        <button type="button" className="row" onClick={() => go(`#/tools/${encodeURIComponent(tool.id)}`)}>
          <Tile tool={tool} />
          <span className="row-main">
            <strong>{tool.name}</strong>
            <small>{hint}</small>
          </span>
          <StatusPill status={state?.status} compact />
          <span className="chevron" aria-hidden="true">›</span>
        </button>
      </li>
    )
  }

  return (
    <section className="screen">
      <input className="search" type="search" placeholder="Search tools" value={query} onChange={(e) => setQuery(e.target.value)} />
      {!loaded ? <p className="muted center">Loading…</p> : null}
      {loaded && tools.length === 0 ? <p className="muted center">No tools in the library yet.</p> : null}
      {loaded && tools.length > 0 && matches.length === 0 ? <p className="muted center">Nothing matches “{query}”.</p> : null}
      {active.length > 0 ? (
        <>
          <h2>Active</h2>
          <ul className="list">{active.map(row)}</ul>
        </>
      ) : null}
      {idle.length > 0 ? (
        <>
          {active.length > 0 ? <h2>Stopped</h2> : null}
          <ul className="list">{idle.map(row)}</ul>
        </>
      ) : null}
    </section>
  )
}

function ToolScreen({ tool, state, health, onLogSink, onStateChange, onRefresh }: {
  tool: CompanionTool | null
  state: ToolRuntimeState | undefined
  health: CompanionOverview['health'][number] | undefined
  onLogSink: (sink: ((line: LogLine) => void) | null) => void
  onStateChange: (state: ToolRuntimeState) => void
  onRefresh: () => void
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [grant, setGrant] = useState<CompanionPreviewGrant | null>(null)
  const [showLog, setShowLog] = useState(false)
  const toolId = tool?.id

  // A grant belongs to one tool and one minute; drop it when either changes.
  useEffect(() => { setGrant(null); setShowLog(false) }, [toolId])
  useEffect(() => { setGrant(null) }, [state?.status])

  if (!tool) {
    return (
      <section className="screen">
        <a href="#/" className="back">‹ Tools</a>
        <p className="muted">This tool is no longer in the library.</p>
      </section>
    )
  }

  async function act(label: string, run: () => Promise<ToolRuntimeState>) {
    setBusy(label)
    setError(null)
    try {
      onStateChange(await run())
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }

  const status = state?.status
  const isUp = status === 'running'
  const inFlight = status === 'starting' || status === 'stopping'
  const canStart = !isUp && !inFlight
  const blocked = health && !health.launchable && canStart ? health.problems.join(' ') : null

  return (
    <section className="screen">
      <a href="#/" className="back">‹ Tools</a>
      <div className="hero">
        <Tile tool={tool} size="l" />
        <h2>{tool.name}</h2>
        <StatusPill status={status} />
        {state?.message && status !== 'running' ? <p className="muted small">{state.message}</p> : null}
      </div>

      <div className="actions">
        {isUp || inFlight ? (
          <>
            <button type="button" className="btn danger grow" disabled={!!busy || !isUp} onClick={() => void act('stop', () => api.stop(tool.id))}>
              {busy === 'stop' || status === 'stopping' ? 'Stopping…' : 'Stop'}
            </button>
            <button type="button" className="btn" disabled={!!busy || !isUp} onClick={() => void act('restart', () => api.restart(tool.id))}>
              {busy === 'restart' ? 'Restarting…' : 'Restart'}
            </button>
          </>
        ) : (
          <button type="button" className="btn primary grow" disabled={!!busy || Boolean(blocked)} onClick={() => void act('start', () => api.start(tool.id))}>
            {busy === 'start' ? 'Starting…' : 'Start'}
          </button>
        )}
      </div>

      {isUp && tool.remotePreview ? (
        <div className="actions">
          {grant ? (
            <a className="btn primary grow" href={grant.url} target="_blank" rel="noopener" onClick={() => setGrant(null)}>
              Open {tool.name} ↗
            </a>
          ) : (
            <button
              type="button"
              className="btn grow"
              disabled={busy === 'preview'}
              onClick={() => {
                setBusy('preview')
                setError(null)
                api.previewGrant(tool.id)
                  .then((next) => { setGrant(next); onRefresh() })
                  .catch((err: unknown) => setError(errorMessage(err)))
                  .finally(() => setBusy(null))
              }}
            >
              {busy === 'preview' ? 'Getting access…' : 'Open preview'}
            </button>
          )}
        </div>
      ) : null}
      {grant ? <p className="muted small center">Opens in Safari. The link works once, within a minute.</p> : null}

      {error ? <p className="notice error" role="alert">{error}</p> : null}
      {blocked ? <p className="notice warn">{blocked}</p> : null}
      {tool.description ? <p className="muted">{tool.description}</p> : null}
      {isUp && !tool.remotePreview ? (
        <p className="muted small">
          To open this tool here, on the Mac press <strong>Edit</strong> on it, expand <strong>Advanced</strong>, and turn on
          <strong> Allow remote preview from paired phones</strong>.
        </p>
      ) : null}

      <p className="center">
        <button type="button" className="link" onClick={() => setShowLog((v) => !v)}>{showLog ? 'Hide log' : 'Show log'}</button>
      </p>
      {showLog ? <ToolLog toolId={tool.id} onLogSink={onLogSink} /> : null}
    </section>
  )
}

function ToolLog({ toolId, onLogSink }: { toolId: string; onLogSink: (sink: ((line: LogLine) => void) | null) => void }) {
  const [logs, setLogs] = useState<LogLine[]>([])
  const [report, setReport] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const end = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    let cancelled = false
    api.logs(toolId).then((lines) => { if (!cancelled) setLogs(lines.slice(-300)) }).catch(() => undefined)
    onLogSink((line) => {
      if (line.toolId === toolId) setLogs((prev) => [...prev.slice(-299), line])
    })
    return () => { cancelled = true; onLogSink(null) }
  }, [toolId, onLogSink])

  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }) }, [logs.length])

  return (
    <div className="logwrap">
      <pre className="log">
        {logs.length === 0 ? <span className="muted">No output yet.</span> : null}
        {logs.map((line, index) => (
          <span key={line.id || `${line.at}-${index}`} className={`logline is-${line.stream}`}>{line.text}{'\n'}</span>
        ))}
        <div ref={end} />
      </pre>
      <div className="actions">
        <button
          type="button"
          className="btn small"
          onClick={() => {
            void api.report(toolId)
              .then(({ report: text }) => {
                setReport(text || 'No report for the current state.')
                if (text) void navigator.clipboard?.writeText(text).then(() => setNote('Error report copied.')).catch(() => setNote(null))
              })
              .catch((err: unknown) => setNote(errorMessage(err)))
          }}
        >
          Copy error report
        </button>
        {note ? <span className="muted small">{note}</span> : null}
      </div>
      {report && !note ? <textarea className="report" readOnly value={report} rows={8} onFocus={(e) => e.currentTarget.select()} /> : null}
    </div>
  )
}

// ---- stacks --------------------------------------------------------------------

function StacksScreen({ overview, states }: { overview: CompanionOverview | null; states: Map<string, ToolRuntimeState> }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const collections = overview?.collections ?? []
  async function act(id: string, run: () => Promise<{ results: { toolId: string; outcome: string }[] }>) {
    setBusy(id)
    setNote(null)
    try {
      const result = await run()
      const summary = result.results.reduce<Record<string, number>>((acc, item) => { acc[item.outcome] = (acc[item.outcome] || 0) + 1; return acc }, {})
      setNote(Object.entries(summary).map(([outcome, count]) => `${count} ${outcome.replace(/-/g, ' ')}`).join(', ') || 'Nothing to do.')
    } catch (err) {
      setNote(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }
  return (
    <section className="screen">
      {!overview ? <p className="muted center">Loading…</p> : null}
      {overview && collections.length === 0 ? <p className="muted center">No collections yet. Make one in Shelf on your Mac.</p> : null}
      {note ? <p className="notice">{note}</p> : null}
      <ul className="list">
        {collections.map((collection) => {
          const running = collection.toolIds.filter((id) => states.get(id)?.status === 'running').length
          const all = running === collection.toolIds.length && running > 0
          return (
            <li key={collection.id} className="card">
              <div className="row-main">
                <strong>{collection.name}</strong>
                <small>{running} of {collection.toolIds.length} running{collection.description ? ` · ${collection.description}` : ''}</small>
              </div>
              <div className="actions">
                <button type="button" className="btn primary grow" disabled={!!busy || all} onClick={() => void act(collection.id, () => api.startCollection(collection.id))}>
                  {busy === collection.id ? 'Working…' : 'Start all'}
                </button>
                <button type="button" className="btn grow" disabled={!!busy || running === 0} onClick={() => void act(collection.id, () => api.stopCollection(collection.id))}>
                  Stop all
                </button>
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

// ---- more ---------------------------------------------------------------------

function MoreScreen({ overview, onUnpaired }: { overview: CompanionOverview | null; onUnpaired: () => void }) {
  const [busy, setBusy] = useState(false)
  return (
    <section className="screen">
      <ul className="list">
        <li className="card">
          <div className="row-main">
            <strong>Connected to your Mac</strong>
            <small>{location.host}{overview?.appVersion ? ` · Shelf ${overview.appVersion}` : ''}</small>
          </div>
        </li>
        <li className="card">
          <div className="row-main">
            <strong>{overview?.keepAwakeActive ? 'Your Mac is staying awake' : 'Mac sleep is not held'}</strong>
            <small>
              {overview?.keepAwakeActive
                ? 'While this is open, Shelf holds off app sleep so the Mac stays reachable.'
                : 'Turn on “Stay awake while a phone is connected” in Settings → Companion on the Mac.'}
            </small>
          </div>
        </li>
        <li className="card">
          <div className="row-main">
            <strong>Everything lives on the Mac</strong>
            <small>This phone holds only its own pairing token. Revoke it any time from Settings → Companion.</small>
          </div>
        </li>
      </ul>
      <div className="actions">
        <button
          type="button"
          className="btn danger grow"
          disabled={busy}
          onClick={async () => {
            if (!confirm('Unpair this phone? Pair it again from Settings → Companion on the Mac.')) return
            setBusy(true)
            try { await api.unpair() } catch { /* token may already be revoked */ }
            clearPaired()
            onUnpaired()
          }}
        >
          Unpair this phone
        </button>
      </div>
    </section>
  )
}
