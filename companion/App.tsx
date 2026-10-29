import { LayoutGrid, List, MoreHorizontal, Search, Star } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CompanionDraft, CompanionOverview, CompanionPreviewGrant, CompanionTool } from '../shared/companion-contracts'
import type { LogLine, ToolRuntimeState, ToolStatus } from '../shared/contracts'
import { dockBadgeText } from '../shared/desktop-status'
import { ShelfMark } from '../src/components/ShelfMark'
import { api, ApiError, clearPaired, connectLive, getToken, setPaired } from './api'

type Route =
  | { name: 'tools' }
  | { name: 'tool'; id: string }
  | { name: 'more' }

type ViewMode = 'list' | 'grid'
const VIEW_KEY = 'shelf-companion-view'
const FAV_KEY = 'shelf-companion-favorites'

function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean)
  if (parts[0] === 'tools' && parts[1]) return { name: 'tool', id: decodeURIComponent(parts[1]) }
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

function readView(): ViewMode {
  try { return localStorage.getItem(VIEW_KEY) === 'grid' ? 'grid' : 'list' } catch { return 'list' }
}

function readFavoritesOnly(): boolean {
  try { return localStorage.getItem(FAV_KEY) === '1' } catch { return false }
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
        <ShelfMark className="pair-mark" />
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
  const [view, setView] = useState<ViewMode>(readView)
  const [favoritesOnly, setFavoritesOnly] = useState<boolean>(readFavoritesOnly)
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const logSink = useRef<((line: LogLine) => void) | null>(null)
  const scroll = useRef<HTMLElement | null>(null)
  const searchRef = useRef<HTMLInputElement | null>(null)

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
      } else if (message.type === 'library:changed' || message.type === 'receipts:update' || message.type === 'drafts:changed') {
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

  function chooseView(next: ViewMode) {
    setView(next)
    try { localStorage.setItem(VIEW_KEY, next) } catch { /* private mode */ }
  }

  function toggleFavorites() {
    setFavoritesOnly((on) => {
      try { localStorage.setItem(FAV_KEY, on ? '0' : '1') } catch { /* private mode */ }
      return !on
    })
  }

  function toggleSearch() {
    setSearchOpen((open) => {
      if (open) setQuery('')
      return !open
    })
    setTimeout(() => searchRef.current?.focus(), 0)
  }

  const tools = overview?.tools ?? []
  const drafts = overview?.drafts ?? []
  const health = overview?.health ?? []
  const running = [...states.values()].filter((state) => state.status === 'running').length
  const onTools = route.name === 'tools'

  return (
    <div className="app">
      <header className="top">
        <a href="#/" className="brand" aria-label="All tools">
          <ShelfMark className="brand-mark" />
          <span>Shelf</span>
        </a>
        <div className="top-right">
          <span className={`live${live ? ' is-live' : ''}`} aria-label={live ? `${running} running` : 'Reconnecting'} title={live ? `${running} running` : 'Reconnecting…'}>
            <i />{running}
          </span>
          {onTools ? (
            <>
              <button type="button" className={`iconbtn${searchOpen ? ' is-on' : ''}`} aria-label="Search" aria-pressed={searchOpen} onClick={toggleSearch}>
                <Search size={20} aria-hidden />
              </button>
              <button type="button" className={`iconbtn${favoritesOnly ? ' is-on' : ''}`} aria-label="Favorites only" aria-pressed={favoritesOnly} onClick={toggleFavorites}>
                <Star size={20} aria-hidden fill={favoritesOnly ? 'currentColor' : 'none'} />
              </button>
              <button type="button" className={`iconbtn${view === 'list' ? ' is-on' : ''}`} aria-label="List view" aria-pressed={view === 'list'} onClick={() => chooseView('list')}>
                <List size={20} aria-hidden />
              </button>
              <button type="button" className={`iconbtn${view === 'grid' ? ' is-on' : ''}`} aria-label="Grid view" aria-pressed={view === 'grid'} onClick={() => chooseView('grid')}>
                <LayoutGrid size={20} aria-hidden />
              </button>
            </>
          ) : null}
          <a href="#/more" className={`iconbtn${route.name === 'more' ? ' is-on' : ''}`} aria-label="More" aria-current={route.name === 'more' ? 'page' : undefined}>
            <MoreHorizontal size={20} aria-hidden />
          </a>
        </div>
      </header>
      {onTools && searchOpen ? (
        <div className="searchbar">
          <input ref={searchRef} className="search" type="search" placeholder="Search tools" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
      ) : null}
      <main className="scroll" ref={scroll}>
        {error ? <p className="notice error" role="alert">{error} <button type="button" className="link" onClick={() => void refresh()}>Retry</button></p> : null}
        {onTools ? <ToolsScreen tools={tools} drafts={drafts} states={states} health={health} loaded={Boolean(overview)} view={view} query={query} favoritesOnly={favoritesOnly} go={go} onRefresh={() => void refresh()} /> : null}
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
        {route.name === 'more' ? <MoreScreen overview={overview} onUnpaired={onUnpaired} /> : null}
      </main>
    </div>
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

/** The tool's mark: the Mac-rendered icon when there is one, else the first letter. */
function Tile({ tool, size = 'm', status }: { tool: CompanionTool; size?: 'm' | 'l' | 'xl'; status?: ToolStatus }) {
  const style = { background: tool.iconBackground || 'linear-gradient(145deg, #9aafff, #526fdd)', color: tool.iconColor || '#081021' }
  const letter = tool.name.trim().charAt(0).toUpperCase() || '•'
  return (
    <span className={`tile ${size}`} style={style} aria-hidden="true">
      {tool.icon?.kind === 'svg' ? (
        // Rendered on the Mac from the Lucide set; same origin, never user-authored markup.
        <span className="tile-svg" dangerouslySetInnerHTML={{ __html: tool.icon.svg }} />
      ) : tool.icon?.kind === 'image' ? (
        <img src={tool.icon.dataUrl} alt="" />
      ) : (
        letter
      )}
      {status ? <i className={`tile-dot is-${status}`} /> : null}
    </span>
  )
}

function ToolsScreen({ tools, drafts, states, health, loaded, view, query, favoritesOnly, go, onRefresh }: {
  tools: CompanionTool[]
  drafts: CompanionDraft[]
  states: Map<string, ToolRuntimeState>
  health: CompanionOverview['health']
  loaded: boolean
  view: ViewMode
  query: string
  favoritesOnly: boolean
  go: (hash: string) => void
  onRefresh: () => void
}) {
  const q = query.trim().toLowerCase()
  const matches = tools
    .filter((tool) => !favoritesOnly || tool.favorite)
    .filter((tool) => !q || tool.name.toLowerCase().includes(q) || tool.tags.some((tag) => tag.toLowerCase().includes(q)))
    .sort((a, b) => a.name.localeCompare(b.name))
  const isActive = (tool: CompanionTool) => {
    const status = states.get(tool.id)?.status
    return status === 'running' || status === 'starting' || status === 'stopping' || status === 'error'
  }
  const active = matches.filter(isActive)
  const idle = matches.filter((tool) => !isActive(tool))
  const open = (tool: CompanionTool) => go(`#/tools/${encodeURIComponent(tool.id)}`)

  // Agent registrations wait at the top: they need the user, and the phone
  // is where the user is when the agent runs from the phone.
  const waiting = !q && drafts.length > 0 ? <DraftsSection drafts={drafts} onDecided={onRefresh} /> : null

  if (!loaded) return <section className="screen"><p className="muted center">Loading…</p></section>
  if (tools.length === 0) return <section className="screen">{waiting}<p className="muted center">No tools in the library yet.</p></section>
  if (matches.length === 0) {
    return (
      <section className="screen">
        {waiting}
        <p className="muted center">{favoritesOnly && !q ? 'No favorites yet. Star a tool in Shelf on your Mac.' : `Nothing matches “${query}”.`}</p>
      </section>
    )
  }

  if (view === 'grid') {
    const cell = (tool: CompanionTool) => {
      const status = states.get(tool.id)?.status
      return (
        <li key={tool.id}>
          <button type="button" className="cell" onClick={() => open(tool)}>
            <Tile tool={tool} size="xl" status={status && status !== 'stopped' ? status : undefined} />
            <span className="cell-name">{tool.name}</span>
          </button>
        </li>
      )
    }
    return (
      <section className="screen">
        {waiting}
        {active.length > 0 ? <><h2>Active</h2><ul className="grid">{active.map(cell)}</ul></> : null}
        {idle.length > 0 ? <>{active.length > 0 ? <h2>Stopped</h2> : null}<ul className="grid">{idle.map(cell)}</ul></> : null}
      </section>
    )
  }

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
        <button type="button" className="row" onClick={() => open(tool)}>
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
      {waiting}
      {active.length > 0 ? <><h2>Active</h2><ul className="list">{active.map(row)}</ul></> : null}
      {idle.length > 0 ? <>{active.length > 0 ? <h2>Stopped</h2> : null}<ul className="list">{idle.map(row)}</ul></> : null}
    </section>
  )
}

/** Shorten a folder path for a phone: ~ for the home folder, the last three segments. */
function shortFolder(projectPath: string): string {
  const home = projectPath.match(/^\/Users\/[^/]+/)?.[0]
  const rel = home ? `~${projectPath.slice(home.length)}` : projectPath
  const parts = rel.split('/').filter(Boolean)
  return parts.length > 4 ? `…/${parts.slice(-3).join('/')}` : rel
}

/**
 * The desktop's "Waiting for you" sheet, one card per agent registration.
 * Accept saves the tool exactly as shown and never launches it; Reject writes
 * nothing. Both go through the same code the desktop sheet uses.
 */
function DraftsSection({ drafts, onDecided }: { drafts: CompanionDraft[]; onDecided: () => void }) {
  const [busyId, setBusyId] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)

  async function decide(draft: CompanionDraft, accept: boolean) {
    setBusyId(draft.id)
    setNotice(null)
    try {
      const result = accept ? await api.acceptDraft(draft.id, draft.updatedAt) : await api.rejectDraft(draft.id)
      setNotice({ tone: result.outcome === 'invalid_folder' ? 'error' : 'ok', text: result.message })
    } catch (err) {
      setNotice({ tone: 'error', text: errorMessage(err) })
    } finally {
      setBusyId(null)
      onDecided()
    }
  }

  return (
    <>
      <h2>Waiting for you</h2>
      {notice ? <p className={`notice${notice.tone === 'error' ? ' error' : ''}`} role="status">{notice.text}</p> : null}
      <ul className="list">
        {drafts.map((draft) => (
          <li key={draft.id} className="card draft">
            <div className="row-main">
              <strong>{draft.name}</strong>
              <small>{draft.client ? `From ${draft.client}` : 'From an agent'} · not in the library, nothing launched</small>
            </div>
            <dl className="facts">
              <dt>Folder</dt><dd title={draft.projectPath}>{shortFolder(draft.projectPath)}</dd>
              <dt>Command</dt><dd><code>{draft.launchCommand || 'No command detected'}</code></dd>
              <dt>Port</dt><dd>{draft.port ?? 'None'}</dd>
              {draft.envKeys.length ? <><dt>Env keys</dt><dd>{draft.envKeys.join(', ')}</dd></> : null}
              {draft.description ? <><dt>About</dt><dd>{draft.description}</dd></> : null}
              {draft.capabilities?.length ? <><dt>Can do</dt><dd>{draft.capabilities.join(' · ')}</dd></> : null}
              {draft.remotePreview ? <><dt>Preview</dt><dd>Requested for this phone; accepting allows it.</dd></> : null}
            </dl>
            <div className="actions">
              <button type="button" className="btn primary grow" disabled={busyId !== null} onClick={() => void decide(draft, true)}>
                {busyId === draft.id ? 'Saving…' : 'Accept'}
              </button>
              <button type="button" className="btn" disabled={busyId !== null} onClick={() => void decide(draft, false)}>
                Reject
              </button>
            </div>
          </li>
        ))}
      </ul>
    </>
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
          To open this tool here, tap the phone icon on its card in Shelf on the Mac, or turn on
          <strong> Allow remote preview</strong> under Edit → Advanced.
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
        {!isStandalone() ? (
          <li className="card">
            <div className="row-main">
              <strong>Add to the Home Screen</strong>
              <small>In Safari: Share → Add to Home Screen. Trust the Mac’s certificate first (Settings → Companion on the Mac explains how) so the Shelf icon comes through; otherwise iOS shows a letter.</small>
            </div>
          </li>
        ) : null}
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
