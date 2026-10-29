import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CompanionOverview, CompanionPreviewGrant, CompanionTool } from '../shared/companion-contracts'
import type { LogLine, ToolRuntimeState, ToolStatus } from '../shared/contracts'
import { dockBadgeText } from '../shared/desktop-status'
import { api, ApiError, clearPaired, connectLive, getToken, setPaired } from './api'

type Route =
  | { name: 'home' }
  | { name: 'tools' }
  | { name: 'tool'; id: string }
  | { name: 'collections' }
  | { name: 'more' }

function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean)
  if (parts[0] === 'tools' && parts[1]) return { name: 'tool', id: decodeURIComponent(parts[1]) }
  if (parts[0] === 'tools') return { name: 'tools' }
  if (parts[0] === 'collections') return { name: 'collections' }
  if (parts[0] === 'more') return { name: 'more' }
  return { name: 'home' }
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

  // Arriving from the QR: pair right away, once.
  useEffect(() => {
    if (fromQr && !autoTried.current) {
      autoTried.current = true
      void pair(fromQr.code)
    }
  }, [fromQr, pair])

  return (
    <main className="c-pair">
      <h1>Shelf Companion</h1>
      {isStandalone() ? (
        <p className="c-muted">
          The Home Screen app keeps its own pairing, separate from Safari, so it pairs once more. On the
          Mac open Settings → Companion, press <strong>Pair a device</strong>, and type the 8-character
          code shown under the QR. The Safari pairing stays valid; revoke it on the Mac if you like.
        </p>
      ) : (
        <p className="c-muted">
          Pair this phone with the Shelf on your Mac. Open Settings → Companion there and scan the QR
          code, or type the code it shows. If you later add this page to the Home Screen, that copy will
          ask to pair once more.
        </p>
      )}
      {fromQr?.fingerprint ? (
        <p className="c-fingerprint">
          Certificate fingerprint from the QR: <code>{formatFingerprint(fromQr.fingerprint)}</code>. It should match
          what Shelf shows under Settings → Companion.
        </p>
      ) : null}
      <label className="c-field">
        <span>Pairing code</span>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          autoCapitalize="characters"
          autoComplete="one-time-code"
          inputMode="text"
          placeholder="8 characters"
        />
      </label>
      <label className="c-field">
        <span>Name this phone</span>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
      </label>
      {error ? <p className="c-error" role="alert">{error}</p> : null}
      <button type="button" className="c-btn c-btn-primary" disabled={busy || code.trim().length < 6} onClick={() => void pair(code)}>
        {busy ? 'Pairing…' : 'Pair'}
      </button>
    </main>
  )
}

/** True when launched from the Home Screen: its storage is separate from Safari's. */
function isStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean }
  return nav.standalone === true || window.matchMedia('(display-mode: standalone)').matches
}

function guessDeviceName(): string {
  const ua = navigator.userAgent
  const base = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android phone' : 'Phone'
  return isStandalone() ? `${base} (Home Screen)` : base
}

// ---- shell -------------------------------------------------------------------

function Shell({ onUnpaired }: { onUnpaired: () => void }) {
  const [route, go] = useRoute()
  const [overview, setOverview] = useState<CompanionOverview | null>(null)
  const [states, setStates] = useState<Map<string, ToolRuntimeState>>(new Map())
  const [live, setLive] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const logSink = useRef<((line: LogLine) => void) | null>(null)

  const refresh = useCallback(async () => {
    try {
      const next = await api.overview()
      setOverview(next)
      setStates(new Map(next.states.map((state) => [state.toolId, state])))
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
        // Merge, never replace: a greeting must not erase a state the
        // overview just reported for a tool the greeting does not know.
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

  // Running count on the Home Screen icon, same rule as the Dock badge.
  useEffect(() => {
    const badge = dockBadgeText([...states.values()])
    const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> }
    if (badge) void nav.setAppBadge?.(Number(badge)).catch(() => undefined)
    else void nav.clearAppBadge?.().catch(() => undefined)
  }, [states])

  const tools = overview?.tools ?? []
  const health = overview?.health ?? []

  return (
    <div className="c-app">
      <header className="c-top">
        <strong>Shelf</strong>
        <span className={`c-live${live ? ' is-live' : ''}`} title={live ? 'Live' : 'Reconnecting'}>
          {live ? 'Live' : 'Reconnecting…'}
        </span>
      </header>
      {error ? <p className="c-error" role="alert">{error} <button type="button" className="c-link" onClick={() => void refresh()}>Retry</button></p> : null}
      <main className="c-main">
        {route.name === 'home' ? <HomeScreen overview={overview} states={states} go={go} /> : null}
        {route.name === 'tools' ? <ToolsScreen tools={tools} states={states} health={health} collections={overview?.collections ?? []} go={go} /> : null}
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
        {route.name === 'collections' ? <CollectionsScreen overview={overview} states={states} /> : null}
        {route.name === 'more' ? <MoreScreen overview={overview} onUnpaired={onUnpaired} /> : null}
      </main>
      <nav className="c-tabs" aria-label="Sections">
        <TabLink hash="#/" active={route.name === 'home'} label="Home" />
        <TabLink hash="#/tools" active={route.name === 'tools' || route.name === 'tool'} label="Tools" />
        <TabLink hash="#/collections" active={route.name === 'collections'} label="Stacks" />
        <TabLink hash="#/more" active={route.name === 'more'} label="More" />
      </nav>
    </div>
  )
}

function TabLink({ hash, active, label }: { hash: string; active: boolean; label: string }) {
  return <a href={hash} aria-current={active ? 'page' : undefined}>{label}</a>
}

function debounce(fn: () => void, ms: number): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  return () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(fn, ms)
  }
}

// ---- screens ------------------------------------------------------------------

function HomeScreen({ overview, states, go }: { overview: CompanionOverview | null; states: Map<string, ToolRuntimeState>; go: (hash: string) => void }) {
  const running = [...states.values()].filter((state) => state.status === 'running')
  const errored = [...states.values()].filter((state) => state.status === 'error')
  const toolName = (id: string) => overview?.tools.find((tool) => tool.id === id)?.name || id
  return (
    <section className="c-screen">
      <h1>Home</h1>
      <div className="c-summary">
        <button type="button" className="c-stat" onClick={() => go('#/tools')}>
          <strong>{running.length}</strong><span>running</span>
        </button>
        <button type="button" className={`c-stat${errored.length ? ' is-bad' : ''}`} onClick={() => go('#/tools')}>
          <strong>{errored.length}</strong><span>{errored.length === 1 ? 'needs you' : 'need you'}</span>
        </button>
      </div>
      {errored.length > 0 ? (
        <ul className="c-list">
          {errored.map((state) => (
            <li key={state.toolId}>
              <a href={`#/tools/${encodeURIComponent(state.toolId)}`} className="c-row">
                <span className="c-dot is-error" />
                <span className="c-row-main"><strong>{toolName(state.toolId)}</strong><small>{state.message || 'Stopped with an error'}</small></span>
              </a>
            </li>
          ))}
        </ul>
      ) : null}
      <h2>Activity</h2>
      {!overview ? <p className="c-muted">Loading…</p> : null}
      {overview && overview.board.length === 0 ? <p className="c-muted">Nothing yet today.</p> : null}
      <ul className="c-list">
        {(overview?.board ?? []).slice(0, 40).map((event) => (
          <li key={event.id}>
            {event.toolId ? (
              <a href={`#/tools/${encodeURIComponent(event.toolId)}`} className="c-row">
                <span className="c-row-main"><strong>{event.title}</strong><small>{event.detail}</small></span>
                <time dateTime={event.at}>{timeAgo(event.at)}</time>
              </a>
            ) : (
              <div className="c-row">
                <span className="c-row-main"><strong>{event.title}</strong><small>{event.detail}</small></span>
                <time dateTime={event.at}>{timeAgo(event.at)}</time>
              </div>
            )}
          </li>
        ))}
      </ul>
      {overview?.keepAwakeActive ? <p className="c-muted c-small">Your Mac is staying awake while this is open.</p> : null}
    </section>
  )
}

function ToolsScreen({ tools, states, health, collections, go }: {
  tools: CompanionTool[]
  states: Map<string, ToolRuntimeState>
  health: CompanionOverview['health']
  collections: CompanionOverview['collections']
  go: (hash: string) => void
}) {
  const [filter, setFilter] = useState<string>('all')
  const [query, setQuery] = useState('')
  const visible = tools
    .filter((tool) => filter === 'all' || collections.find((item) => item.id === filter)?.toolIds.includes(tool.id))
    .filter((tool) => !query.trim() || tool.name.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a, b) => Number(Boolean(states.get(b.id)?.status === 'running')) - Number(Boolean(states.get(a.id)?.status === 'running')) || a.name.localeCompare(b.name))
  return (
    <section className="c-screen">
      <h1>Tools</h1>
      <div className="c-filters">
        <input className="c-search" placeholder="Search" value={query} onChange={(e) => setQuery(e.target.value)} />
        {collections.length > 0 ? (
          <select value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Collection">
            <option value="all">All tools</option>
            {collections.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        ) : null}
      </div>
      {tools.length === 0 ? <p className="c-muted">No tools in the library yet.</p> : null}
      <ul className="c-list">
        {visible.map((tool) => {
          const state = states.get(tool.id)
          const h = health.find((item) => item.toolId === tool.id)
          return (
            <li key={tool.id}>
              <button type="button" className="c-row" onClick={() => go(`#/tools/${encodeURIComponent(tool.id)}`)}>
                <ToolTile tool={tool} />
                <span className="c-row-main">
                  <strong>{tool.name}</strong>
                  <small>
                    {statusLabel(state?.status)}
                    {tool.port ? ` · :${tool.port}` : ''}
                    {h && !h.launchable && state?.status !== 'running' ? ` · ${h.problems[0]}` : ''}
                  </small>
                </span>
                <span className={`c-dot is-${state?.status || 'stopped'}`} />
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function ToolTile({ tool }: { tool: CompanionTool }) {
  return (
    <span className="c-tile" style={{ background: tool.iconBackground || 'var(--panel-raised)', color: tool.iconColor || 'var(--ink)' }} aria-hidden="true">
      {tool.name.trim().charAt(0).toUpperCase() || '•'}
    </span>
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
  const [logs, setLogs] = useState<LogLine[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [report, setReport] = useState<string | null>(null)
  const [grant, setGrant] = useState<CompanionPreviewGrant | null>(null)
  const logEnd = useRef<HTMLDivElement | null>(null)
  const toolId = tool?.id

  // A grant belongs to one tool and one minute; drop it when either changes.
  useEffect(() => { setGrant(null) }, [toolId, state?.status])

  useEffect(() => {
    if (!toolId) return
    let cancelled = false
    api.logs(toolId).then((lines) => { if (!cancelled) setLogs(lines.slice(-500)) }).catch(() => undefined)
    onLogSink((line) => {
      if (line.toolId === toolId) setLogs((prev) => [...prev.slice(-499), line])
    })
    return () => { cancelled = true; onLogSink(null) }
  }, [toolId, onLogSink])

  useEffect(() => {
    logEnd.current?.scrollIntoView({ block: 'end' })
  }, [logs.length])

  if (!tool) return <section className="c-screen"><h1>Tool</h1><p className="c-muted">This tool is no longer in the library.</p></section>

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
  const canStart = status !== 'running' && status !== 'starting' && status !== 'stopping'
  return (
    <section className="c-screen">
      <a href="#/tools" className="c-back">‹ Tools</a>
      <div className="c-tool-head">
        <ToolTile tool={tool} />
        <div>
          <h1>{tool.name}</h1>
          <p className="c-muted">
            <span className={`c-dot is-${status || 'stopped'}`} /> {statusLabel(status)}
            {state?.message ? ` · ${state.message}` : ''}
          </p>
        </div>
      </div>
      {tool.description ? <p className="c-muted">{tool.description}</p> : null}
      {health && !health.launchable && canStart ? (
        <p className="c-warn">{health.problems.join(' ')}</p>
      ) : null}
      <div className="c-actions">
        <button type="button" className="c-btn c-btn-primary" disabled={!!busy || !canStart} onClick={() => void act('start', () => api.start(tool.id))}>
          {busy === 'start' ? 'Starting…' : 'Start'}
        </button>
        <button type="button" className="c-btn" disabled={!!busy || status !== 'running'} onClick={() => void act('restart', () => api.restart(tool.id))}>
          {busy === 'restart' ? 'Restarting…' : 'Restart'}
        </button>
        <button type="button" className="c-btn c-btn-danger" disabled={!!busy || (status !== 'running' && status !== 'starting')} onClick={() => void act('stop', () => api.stop(tool.id))}>
          {busy === 'stop' ? 'Stopping…' : 'Stop'}
        </button>
      </div>
      {error ? <p className="c-error" role="alert">{error}</p> : null}
      {status === 'running' && tool.remotePreview ? (
        <div className="c-preview">
          {grant ? (
            <>
              {/* A real link: a Home Screen app cannot script a new tab, but a tap on an anchor opens Safari. */}
              <a className="c-btn c-btn-primary" href={grant.url} target="_blank" rel="noopener" onClick={() => setGrant(null)}>
                Open {tool.name} ↗
              </a>
              <span className="c-muted c-small">Opens in Safari. This link works once, within a minute.</span>
            </>
          ) : (
            <button
              type="button"
              className="c-btn"
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
          {!tool.previewReady && !grant ? <span className="c-muted c-small">Preview is coming up…</span> : null}
        </div>
      ) : null}
      {status === 'running' && !tool.remotePreview && tool.url ? (
        <p className="c-muted c-small">Serving on the Mac at <code>{tool.url}</code>. To open it here: on the Mac, open this tool, press <strong>Edit</strong>, expand <strong>Advanced</strong>, and turn on <strong>Allow remote preview from paired phones</strong>.</p>
      ) : null}
      <div className="c-log-head">
        <h2>Log</h2>
        <button
          type="button"
          className="c-link"
          onClick={() => {
            void api.report(tool.id).then(({ report: text }) => setReport(text || 'No report for the current state.')).catch((err: unknown) => setError(errorMessage(err)))
          }}
        >
          Error report
        </button>
      </div>
      {report ? (
        <div className="c-report">
          <textarea readOnly value={report} rows={10} onFocus={(e) => e.currentTarget.select()} />
          <div className="c-actions">
            <button type="button" className="c-btn" onClick={() => { void navigator.clipboard?.writeText(report).catch(() => undefined) }}>Copy</button>
            <button type="button" className="c-btn" onClick={() => setReport(null)}>Close</button>
          </div>
        </div>
      ) : null}
      <pre className="c-log" aria-live="polite">
        {logs.length === 0 ? <span className="c-muted">No output yet.</span> : null}
        {logs.map((line, index) => (
          <span key={line.id || `${line.at}-${index}`} className={`c-log-line is-${line.stream}`}>{line.text}{'\n'}</span>
        ))}
        <div ref={logEnd} />
      </pre>
    </section>
  )
}

function CollectionsScreen({ overview, states }: { overview: CompanionOverview | null; states: Map<string, ToolRuntimeState> }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const collections = overview?.collections ?? []
  async function act(id: string, run: () => Promise<{ results: { toolId: string; outcome: string }[] }>) {
    setBusy(id)
    setNote(null)
    try {
      const result = await run()
      const summary = result.results.reduce<Record<string, number>>((acc, item) => { acc[item.outcome] = (acc[item.outcome] || 0) + 1; return acc }, {})
      setNote(Object.entries(summary).map(([outcome, count]) => `${count} ${outcome}`).join(', ') || 'Nothing to do.')
    } catch (err) {
      setNote(errorMessage(err))
    } finally {
      setBusy(null)
    }
  }
  return (
    <section className="c-screen">
      <h1>Stacks</h1>
      {collections.length === 0 ? <p className="c-muted">No collections yet. Make one in Shelf on your Mac.</p> : null}
      {note ? <p className="c-muted">{note}</p> : null}
      <ul className="c-list">
        {collections.map((collection) => {
          const running = collection.toolIds.filter((id) => states.get(id)?.status === 'running').length
          return (
            <li key={collection.id} className="c-collection">
              <div className="c-row-main">
                <strong>{collection.name}</strong>
                <small>{running} of {collection.toolIds.length} running{collection.description ? ` · ${collection.description}` : ''}</small>
              </div>
              <div className="c-actions">
                <button type="button" className="c-btn c-btn-primary" disabled={!!busy} onClick={() => void act(collection.id, () => api.startCollection(collection.id))}>
                  {busy === collection.id ? 'Working…' : 'Start stack'}
                </button>
                <button type="button" className="c-btn" disabled={!!busy || running === 0} onClick={() => void act(collection.id, () => api.stopCollection(collection.id))}>
                  Stop stack
                </button>
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function MoreScreen({ overview, onUnpaired }: { overview: CompanionOverview | null; onUnpaired: () => void }) {
  const [busy, setBusy] = useState(false)
  return (
    <section className="c-screen">
      <h1>More</h1>
      <p className="c-muted">
        Connected to Shelf {overview?.appVersion || ''} at <code>{location.host}</code>. Everything you see
        lives on your Mac; this phone holds only its own pairing token.
      </p>
      <p className="c-muted c-small">
        Tip: in Safari use Share → <em>Add to Home Screen</em> to open the Companion like an app and keep
        the running count on its icon.
      </p>
      <button
        type="button"
        className="c-btn c-btn-danger"
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
    </section>
  )
}

function timeAgo(iso: string): string {
  const diff = Date.now() - Date.parse(iso)
  if (!Number.isFinite(diff)) return ''
  const minutes = Math.round(diff / 60_000)
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.round(hours / 24)}d`
}
