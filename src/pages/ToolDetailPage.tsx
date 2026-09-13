import { launchOriginLabel } from '../lib/launchOrigin'
import { ToolEnvironmentPanel } from '../components/ToolEnvironmentPanel'
import { resolveDesignProfile } from '../../shared/design-resolve'
import { useDesignProfiles } from '../hooks/useDesignProfiles'
import { Share2, Sparkles, Star } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { DiagnosticReportDialog } from '../components/DiagnosticReportDialog'
import { LogPanel } from '../components/LogPanel'
import { OverflowMenu, type OverflowMenuItem } from '../components/OverflowMenu'
import { ReceiptHistory } from '../components/ReceiptHistory'
import { StatusPill } from '../components/StatusPill'
import { ToolIcon } from '../components/ToolIcon'
import { ShareWithTeamDialog } from '../components/sharing/ShareWithTeamDialog'
import { UpdateSheet } from '../components/sharing/UpdateSheet'
import { useGapSuggestions } from '../hooks/useGapSuggestions'
import { useLibrary } from '../hooks/useLibrary'
import { useReceipts } from '../hooks/useReceipts'
import { useUiMode } from '../hooks/useUiMode'
import { friendlyLaunchError } from '../lib/launchErrorCopy'
import { formatRelativeTime } from '../lib/relativeTime'
import type { DesignMdResult, LogLine, ToolReadiness } from '../types'

export function ToolDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const { isDeveloper } = useUiMode()
  const {
    tools,
    collections,
    loading: libraryLoading,
    states,
    startTool,
    stopTool,
    restartTool,
    deleteTool,
    getLogs,
    subscribeLogs,
  } = useLibrary()

  const tool = tools.find((t) => t.id === id)
  const state = id ? states[id] : undefined
  const status = state?.status || 'stopped'
  const { profiles } = useDesignProfiles()
  const design = resolveDesignProfile(profiles, collections, { toolId: id })
  const [selectedRun, setSelectedRun] = useState('')
  const [logError, setLogError] = useState<string | null>(null)
  const [logRevision, setLogRevision] = useState(0)
  const [logs, setLogs] = useState<LogLine[]>([])
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(() => {
    const result = (location.state as { registration?: import('../types').RegisterProjectResult } | null)?.registration
    if (result?.outcome === 'saved_launch_failed') return result.state?.message || 'The tool was saved, but setup or launch failed. Review the latest output below and check Environment to retry setup.'
    if (result?.outcome === 'needs_setup') return 'The tool was saved. Open Environment below to review the setup it needs before launching.'
    return null
  })
  const [reportPreview, setReportPreview] = useState<string | null>(null)
  const [reportCopied, setReportCopied] = useState(false)
  const [designMd, setDesignMd] = useState<DesignMdResult | null>(null)
  const [readiness, setReadiness] = useState<ToolReadiness | null>(null)
  // Tool Sharing: result line after "Share" and the updates sheet.
  const [shareStatus, setShareStatus] = useState<
    | { kind: 'copied'; link: string; envKeys: string[] }
    | { kind: 'written'; manifestPath: string; envKeys: string[]; linkNote?: string }
    | { kind: 'bundle'; path: string }
    | null
  >(null)
  const [updatesOpen, setUpdatesOpen] = useState(false)
  const [teamShareOpen, setTeamShareOpen] = useState(false)
  const { receipts, error: receiptError, refresh: refreshReceipts, clear: clearReceipts } = useReceipts({
    toolId: id,
    limit: 25,
  })
  // The Library card links here to confirm/deny a resolve suggestion.
  const { suggestions, resolve, dismiss } = useGapSuggestions()
  const toolSuggestions = suggestions.filter((s) => s.toolId === id)

  useEffect(() => { setSelectedRun('') }, [id])
  useEffect(() => {
    if (!id) return
    let active = true
    let fetching = false
    let changedDuringRead = false
    setLogs([])
    const refreshLogs = async () => {
      if (fetching) { changedDuringRead = true; return }
      if (document.hidden) return
      fetching = true
      changedDuringRead = false
      try {
        const lines = await getLogs(id, selectedRun || undefined)
        if (active) { setLogs(lines.slice(-3000)); setLogError(null) }
      } catch { if (active) setLogError('Could not read this run’s logs.') }
      finally {
        fetching = false
        if (active && changedDuringRead) void refreshLogs()
      }
    }
    void refreshLogs()
    // Local runs push events. Only external running tools need periodic disk reads.
    const timer = !selectedRun && state?.origin === 'external' && ['starting', 'running'].includes(status)
      ? window.setInterval(() => { void refreshLogs() }, 3000) : undefined
    let scheduled: number | undefined
    const off = subscribeLogs(id, () => {
      if (selectedRun || scheduled !== undefined) return
      scheduled = window.setTimeout(() => { scheduled = undefined; void refreshLogs() }, 150)
    })
    const offReceipt = window.shelf.onReceiptUpdate((receipt) => { if (receipt.toolId === id) void refreshLogs() })
    document.addEventListener('visibilitychange', refreshLogs)
    return () => { active = false; window.clearInterval(timer); window.clearTimeout(scheduled); off(); offReceipt(); document.removeEventListener('visibilitychange', refreshLogs) }
  }, [id, getLogs, subscribeLogs, selectedRun, status, state?.origin, logRevision])

  useEffect(() => {
    if (!id || !window.shelf?.getDesignMd) {
      setDesignMd(null)
      return
    }
    let active = true
    void window.shelf.getDesignMd({ id }).then((result) => {
      if (active) setDesignMd(result)
    }).catch(() => { if (active) setActionError('Could not read project design instructions. Reopen this page to retry.') })
    return () => {
      active = false
    }
  }, [id, tool?.projectPath])

  useEffect(() => {
    if (!id || !window.shelf?.checkToolReadiness) return
    let active = true
    void window.shelf.checkToolReadiness(id).then((result) => {
      if (active) setReadiness(result)
    }).catch(() => { if (active) setActionError('Could not check agent readiness. Reopen this page to retry.') })
    return () => {
      active = false
    }
  }, [id, tool?.updatedAt])

  if (libraryLoading) return <p role="status">Loading tool…</p>

  if (!tool || !id) {
    return (
      <div className="empty-state">
        <div>
          <h2>Tool not found</h2>
          <p>This entry is missing from the local library.</p>
          <Link className="btn btn-primary" to="/">
            Back to library
          </Link>
        </div>
      </div>
    )
  }

  // Narrowed after the guard so nested handlers keep a definite Tool.
  const current = tool
  const toolId = id
  const canStop = status === 'running' || status === 'starting' || status === 'stopping' || (status === 'error' && Boolean(state?.pid))
  const canStart = status === 'stopped' || status === 'error'
  const showOpenUrlButton = status === 'running' && Boolean(current.url)

  async function run(action: () => Promise<void>) {
    setBusy(true)
    setActionError(null)
    try {
      await action()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  // Share: write shelf.json (env values stripped structurally) and copy the
  // shelf://add link when the project has a git remote — one click.
  function share() {
    setShareStatus(null)
    void run(async () => {
      const result = await window.shelf.exportToolManifest(toolId)
      setShareStatus(
        result.link
          ? { kind: 'copied', link: result.link, envKeys: result.envKeys }
          : {
              kind: 'written',
              manifestPath: result.manifestPath,
              envKeys: result.envKeys,
              linkNote: result.linkNote,
            },
      )
    })
  }

  function exportBundle() {
    setShareStatus(null)
    void run(async () => {
      const result = await window.shelf.exportToolBundle(toolId)
      if (result.saved && result.path) setShareStatus({ kind: 'bundle', path: result.path })
    })
  }

  function confirmRemove() {
    if (
      !window.confirm(
        `Remove “${current.name}” from Shelf? This does not delete the project files.`,
      )
    ) {
      return
    }
    void run(async () => {
      await deleteTool(toolId)
      navigate('/')
    })
  }

  // Open menu: URL when idle (button while running); folder / editor / terminal.
  const openMenuItems: OverflowMenuItem[] = []
  if (current.url && !showOpenUrlButton) {
    openMenuItems.push({
      id: 'url',
      label: 'Open URL',
      onSelect: () => void run(() => window.shelf.openUrl(current.url!)),
    })
  }
  if (current.projectPath) {
    openMenuItems.push(
      {
        id: 'folder',
        label: 'Open folder',
        onSelect: () => void run(() => window.shelf.openPath(current.projectPath!)),
      },
      {
        id: 'editor',
        label: 'Open editor',
        onSelect: () => void run(() => window.shelf.openEditor(current.projectPath!)),
      },
      {
        id: 'terminal',
        label: 'Open Terminal',
        onSelect: () => void run(() => window.shelf.openTerminal(current.projectPath!)),
      },
    )
  }

  const moreMenuItems: OverflowMenuItem[] = [
    {
      id: 'restart',
      label: 'Restart',
      disabled: busy,
      onSelect: () => void run(() => restartTool(toolId)),
    },
    ...(current.projectPath
      ? [
          {
            id: 'bundle',
            label: 'Export bundle (.zip)…',
            disabled: busy,
            onSelect: exportBundle,
          },
        ]
      : []),
    ...(current.projectPath
      ? [
          {
            id: 'team',
            label: 'Share with team…',
            disabled: busy,
            onSelect: () => setTeamShareOpen(true),
          },
        ]
      : []),
    ...(current.source?.kind === 'git'
      ? [
          {
            id: 'updates',
            label: 'Check for updates…',
            disabled: busy,
            onSelect: () => setUpdatesOpen(true),
          },
        ]
      : []),
    {
      id: 'remove',
      label: 'Remove',
      danger: true,
      disabled: busy,
      onSelect: confirmRemove,
    },
  ]

  return (
    <>
      <header className="page-header">
        <div className="page-header-copy">
          <p className="eyebrow">Tool detail</p>
          <h1 className="page-title">{current.name}</h1>
          <p className="page-lede">
            {current.description || 'No description yet. Edit this tool to document what it does.'}
          </p>
        </div>
        <div className="action-row" style={{ margin: 0, alignItems: 'center' }}>
          {current.projectPath ? (
            <button
              type="button"
              className="btn btn-quiet"
              disabled={busy}
              title="Write shelf.json and copy a link a coworker can open in Shelf"
              onClick={share}
            >
              <Share2 size={15} aria-hidden /> Share
            </button>
          ) : null}
          <Link className="btn btn-primary" to={`/tools/${toolId}/context${selectedRun ? `?run=${encodeURIComponent(selectedRun)}` : ''}`}>
            Memory &amp; handoff
          </Link>
          <Link className="btn btn-quiet" to={`/tools/${toolId}/edit`}>
            Edit
          </Link>
        </div>
      </header>

      <div className="detail-hero">
        <ToolIcon
          name={current.name}
          iconPath={current.iconPath}
          iconLucide={current.iconLucide}
          iconColor={current.iconColor}
          iconBackground={current.iconBackground}
        />
        <div className="stack" style={{ gap: '0.45rem' }}>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <StatusPill status={status} message={state?.message} />
            {current.favorite ? (
              <span className="tag-chip favorite-chip">
                <Star size={11} fill="currentColor" aria-hidden /> Favorite
              </span>
            ) : null}
            {current.tags.map((tag) => (
              <span key={tag} className="tag-chip">
                {tag}
              </span>
            ))}
          </div>
          <p style={{ margin: 0, color: 'var(--muted)' }}>
            {(state?.message !== 'Not started' ? state?.message : undefined) ||
              (current.lastLaunchedAt
                ? `Stopped · last launch ${formatRelativeTime(current.lastLaunchedAt)}`
                : 'Stopped · never launched')}
          </p>
          {state?.pid ? (
            <p style={{ margin: 0, color: 'var(--subtle)', fontSize: '0.82rem' }}>
              pid {state.pid}
              {state.startedAt ? ` · started ${formatRelativeTime(state.startedAt)}` : ''}
            </p>
          ) : null}
        </div>
      </div>

      {actionError ? (
        <div className="warning-card" role="alert" style={{ marginBottom: '1rem' }}>
          {actionError}
        </div>
      ) : null}

      {shareStatus?.kind === 'copied' ? (
        <div className="share-status" role="status">
          <strong>Link copied.</strong> Paste it to a coworker — Shelf shows them a consent
          sheet before anything runs. <code style={{ fontSize: '0.85em' }}>{shareStatus.link}</code>
          {shareStatus.envKeys.length > 0
            ? ` They’ll be asked for their own ${shareStatus.envKeys.join(', ')}; your values were not included.`
            : ''}{' '}
          Commit <code>shelf.json</code> and push so the link has the manifest.
        </div>
      ) : null}
      {shareStatus?.kind === 'written' ? (
        <div className="share-status" role="status">
          <strong>shelf.json written</strong> at{' '}
          <code style={{ fontSize: '0.85em' }}>{shareStatus.manifestPath}</code>
          {shareStatus.envKeys.length > 0 ? ' (env names only, no values)' : ''}.{' '}
          {shareStatus.linkNote ||
            'This project has no git remote, so there’s no link to copy — push it to a remote and share again, or use Export bundle from the ⋯ menu.'}
        </div>
      ) : null}
      {shareStatus?.kind === 'bundle' ? (
        <div className="share-status" role="status">
          <strong>Bundle saved</strong> to{' '}
          <code style={{ fontSize: '0.85em' }}>{shareStatus.path}</code>. It contains{' '}
          <code>shelf.json</code> (no env values) and the project without node_modules, .git, or .env files.
        </div>
      ) : null}

      {state?.code ? (
        <div className="warning-card" role="alert" style={{ marginBottom: '1rem' }}>
          <strong>{friendlyLaunchError(state.code)}</strong>
          <div
            className="action-row"
            style={{ margin: '0.6rem 0 0', flexWrap: 'wrap' }}
          >
            {state.code === 'port_in_use' ? (
              <button
                type="button"
                className="btn btn-quiet btn-sm"
                disabled={busy}
                onClick={() =>
                  void run(() => startTool(toolId, { onPortConflict: 'reassign' }))
                }
              >
                Launch on a free port
              </button>
            ) : null}
            {state.remedy === 'edit_command' ? (
              <Link className="btn btn-quiet btn-sm" to={`/tools/${toolId}/edit`}>
                Edit launch command
              </Link>
            ) : null}
            <button
              type="button"
              className="btn btn-quiet btn-sm"
              onClick={() => {
                void window.shelf.getErrorReport(toolId).then((report) => {
                  if (!report) return
                  setReportPreview(report)
                }).catch(() => setActionError('Could not prepare the diagnostic report. Try again.'))
              }}
            >
              {reportCopied ? 'Copied' : 'Copy report for your AI tool'}
            </button>
          </div>
        </div>
      ) : null}

      {toolSuggestions.map((suggestion) => (
        <div
          className="gap-suggestion gap-suggestion-card"
          key={`${suggestion.gapId}:${suggestion.toolId}`}
          role="status"
        >
          <p>
            <Sparkles size={14} aria-hidden className="gap-suggestion-icon" /> This
            tool can do something your AI assistant was missing —{' '}
            <em>{suggestion.matched.join(', ')}</em>
            {suggestion.matched.length < suggestion.total
              ? ` (${suggestion.matched.length} of ${suggestion.total} requested)`
              : ''}
            .
          </p>
          <div className="gap-suggestion-actions">
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={busy}
              onClick={() => void run(() => resolve(suggestion))}
            >
              {isDeveloper ? 'Resolve gap with this tool' : 'Mark it handled'}
            </button>
            <button
              type="button"
              className="btn btn-quiet btn-sm"
              disabled={busy}
              onClick={() => void run(() => dismiss(suggestion))}
            >
              Not a match
            </button>
            {isDeveloper ? (
              <Link className="btn btn-quiet btn-sm" to="/gaps">
                View in Capability gaps
              </Link>
            ) : null}
          </div>
        </div>
      ))}

      {/* Context-aware: Launch when idle, Stop when live; Open + More for the rest. */}
      <div className="detail-actions">
        {canStart ? (
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={() => void run(() => startTool(toolId))}
          >
            Launch
          </button>
        ) : null}
        {canStop ? (
          <button
            type="button"
            className="btn btn-primary"
            disabled={status === 'stopping' || (busy && status !== 'starting')}
            onClick={() => void run(() => stopTool(toolId))}
          >
            Stop
          </button>
        ) : null}
        {showOpenUrlButton ? (
          <button
            type="button"
            className="btn btn-quiet"
            onClick={() => void run(() => window.shelf.openUrl(current.url!))}
          >
            Open URL
          </button>
        ) : null}
        {openMenuItems.length > 0 ? (
          <OverflowMenu
            triggerLabel="Open"
            label="Open project"
            items={openMenuItems}
          />
        ) : null}
        <div className="detail-actions-more">
          {/* md: this row's neighbors (Launch / Open) sit on the 42px rail. */}
          <OverflowMenu label="More actions" items={moreMenuItems} size="md" />
        </div>
      </div>

      <section className="panel run-summary">
        <div className="panel-header"><h2 className="panel-title">Last run</h2></div>
        <div className="panel-body stack">
          {receipts[0] ? <><strong>{receipts[0].outcome.replaceAll('_', ' ')} · {formatRelativeTime(receipts[0].startedAt)}</strong><p>{receipts[0].message || 'No additional status message.'}</p><p className="muted">Started by {launchOriginLabel(receipts[0].startedBy) || 'Shelf'}{receipts[0].durationMs === undefined ? '' : ` · ${(receipts[0].durationMs / 1000).toFixed(1)} seconds`}</p></> : <p>No run recorded yet. Launch the tool to check how it behaves.</p>}
          <button className="btn btn-quiet btn-sm" onClick={() => void run(async () => { const report = await window.shelf.getErrorReport(toolId, selectedRun || receipts[0]?.id); if (report) setReportPreview(report) })}>Prepare report for your AI tool</button>
          {receiptError && <p role="alert">{receiptError} <button className="btn" onClick={() => void refreshReceipts()}>Retry history</button></p>}
        </div>
      </section>
      {isDeveloper ? (
      <section className="panel capability-panel">
        <div className="panel-header">
          <h2 className="panel-title">Capability intelligence</h2>
          {readiness ? (
            <span className={`readiness-badge is-${readiness.state}`}>
              {readiness.state.replace('_', ' ')}
            </span>
          ) : null}
        </div>
        <div className="panel-body capability-detail-grid">
          <div>
            <div className="field-label">Capabilities</div>
            {tool.capabilities.length > 0 ? (
              <div className="capability-chips">
                {tool.capabilities.map((capability) => (
                  <span className="tag-chip" key={capability}>{capability}</span>
                ))}
              </div>
            ) : (
              <p className="capability-empty">No capabilities described yet.</p>
            )}
          </div>
          <div>
            <div className="field-label">Agent access</div>
            {tool.agentAccess.length > 0 ? (
              <div className="access-summary-list">
                {tool.agentAccess.map((access) => (
                  <div className="access-summary" key={access.id}>
                    <div>
                      <strong>{access.kind === 'http-api' ? 'HTTP API' : access.kind.toUpperCase()}</strong>
                      {access.kind === 'mcp' ? ` · ${access.transport}` : ''}
                      {access.setupRequired ? ' · setup required' : ' · declared ready'}
                    </div>
                    <code>{access.entrypoint}</code>
                    {access.notes ? <p>{access.notes}</p> : null}
                  </div>
                ))}
              </div>
            ) : (
              <p className="capability-empty">Manual use only; no agent interface is declared.</p>
            )}
            {readiness ? <p className="readiness-summary">{readiness.summary}</p> : null}
          </div>
        </div>
      </section>
      ) : null}

      <div className="detail-layout">
        <section className="panel">
          <div className="panel-header">
            <h2 className="panel-title">Run output</h2>
          </div>
          <div className="panel-body">
            <label className="field"><span className="field-label">Run to inspect</span><select className="field-input" value={selectedRun} onChange={(event) => setSelectedRun(event.target.value)}><option value="">Latest output (live when running)</option>{receipts.map((receipt) => <option key={receipt.id} value={receipt.id}>{new Date(receipt.startedAt).toLocaleString()} · {receipt.outcome}</option>)}</select></label>
            {logError && <p role="alert">{logError}</p>}
            <button className="btn btn-quiet btn-sm" onClick={() => setLogRevision((revision) => revision + 1)}>Refresh output</button>
            <LogPanel lines={logs} />
          </div>
        </section>

        <section className="panel">
          <div className="panel-header">
            <h2 className="panel-title">Configuration</h2>
          </div>
          <div className="panel-body stack">
            <div><div className="field-label">Effective design profile</div>{design.profile ? <><Link to={`/design/${design.profile.id}`}>{design.profile.name}</Link><p className="muted">{design.via === 'default' ? 'Shelf default' : `Inherited from ${collections.find((collection) => collection.id === design.collectionId)?.name || 'collection'}`}. This is the profile agents receive when resolving this tool’s design context.</p></> : <p>No profile applies. Bind one to this tool’s collection or choose a default in <Link to="/design">Design profiles</Link>.</p>}</div>
            <div>
              <div className="field-label">Launch command</div>
              <code style={{ color: 'var(--brand-strong)', fontSize: '0.86em' }}>
                {tool.launchCommand}
              </code>
            </div>
            {tool.stopCommand ? (
              <div>
                <div className="field-label">Stop command</div>
                <code style={{ color: 'var(--muted)', fontSize: '0.86em' }}>
                  {tool.stopCommand}
                </code>
              </div>
            ) : null}
            {tool.projectPath ? (
              <div>
                <div className="field-label">Project folder</div>
                <p style={{ margin: '0.25rem 0 0', color: 'var(--muted)', fontSize: '0.9rem' }}>
                  {tool.projectPath}
                </p>
              </div>
            ) : null}
            {isDeveloper || designMd?.found ? (
            <div>
              <div className="field-label">Design system</div>
              {designMd?.found && designMd.path ? (
                <div style={{ marginTop: '0.35rem' }}>
                  <p style={{ margin: 0, color: 'var(--muted)', fontSize: '0.9rem' }}>
                    DESIGN.md found
                  </p>
                  <p
                    style={{
                      margin: '0.25rem 0 0.5rem',
                      color: 'var(--subtle)',
                      fontSize: '0.8rem',
                      wordBreak: 'break-all',
                    }}
                  >
                    {designMd.path}
                  </p>
                  <button
                    type="button"
                    className="btn btn-quiet btn-sm"
                    onClick={() => void run(() => window.shelf.openPath(designMd.path!))}
                  >
                    Reveal DESIGN.md
                  </button>
                </div>
              ) : (
                <p style={{ margin: '0.25rem 0 0', color: 'var(--subtle)', fontSize: '0.85rem' }}>
                  No project-local DESIGN.md detected.
                </p>
              )}
            </div>
            ) : null}
            {tool.source ? (
              <div>
                <div className="field-label">Shared from</div>
                <p style={{ margin: '0.25rem 0 0', color: 'var(--muted)', fontSize: '0.9rem', overflowWrap: 'anywhere' }}>
                  {tool.source.kind === 'git' ? (
                    <code style={{ fontSize: '0.85em' }}>{tool.source.repo}</code>
                  ) : (
                    'A bundle (.zip)'
                  )}
                </p>
                <p style={{ margin: '0.25rem 0 0', color: 'var(--subtle)', fontSize: '0.8rem' }}>
                  Added {formatRelativeTime(tool.source.addedAt)}
                  {tool.source.updatedAt ? ` · updated ${formatRelativeTime(tool.source.updatedAt)}` : ''}
                  {tool.source.ref ? ` · ${tool.source.ref.slice(0, 10)}` : ''}
                </p>
                {tool.source.kind === 'git' ? (
                  <button
                    type="button"
                    className="btn btn-quiet btn-sm"
                    style={{ marginTop: '0.5rem' }}
                    disabled={busy}
                    onClick={() => setUpdatesOpen(true)}
                  >
                    Check for updates
                  </button>
                ) : null}
              </div>
            ) : null}
            {tool.url ? (
              <div>
                <div className="field-label">Local URL</div>
                <p style={{ margin: '0.25rem 0 0', color: 'var(--muted)', fontSize: '0.9rem' }}>
                  {tool.url}
                  {tool.port ? ` · port ${tool.port}` : ''}
                </p>
              </div>
            ) : null}
            {tool.notes ? (
              <div>
                <div className="field-label">Notes</div>
                <p style={{ margin: '0.25rem 0 0', color: 'var(--muted)', whiteSpace: 'pre-wrap' }}>
                  {tool.notes}
                </p>
              </div>
            ) : isDeveloper ? (
              <div className="warning-card">
                No operating notes yet. Capture inputs, common errors, and the last known
                working configuration when you edit this tool.
              </div>
            ) : null}
          </div>
        </section>
      </div>

      <UpdateSheet tool={current} open={updatesOpen} onClose={() => setUpdatesOpen(false)} />
      <ShareWithTeamDialog
        tool={current}
        open={teamShareOpen}
        onClose={() => setTeamShareOpen(false)}
      />

      <section className="panel" style={{ marginTop: '1rem' }}>
        <div className="panel-header">
          <h2 className="panel-title">Run history</h2>
          {receipts.length > 0 ? (
            <button
              type="button"
              className="btn btn-quiet btn-sm"
              onClick={() => {
                if (window.confirm('Clear run history for this tool?')) {
                  void run(clearReceipts)
                }
              }}
            >
              Clear
            </button>
          ) : null}
        </div>
        <div className="panel-body">
          <ReceiptHistory
            receipts={receipts}
            emptyLabel="No launches recorded yet. Launch this tool to start its history."
          />
        </div>
      </section>
      <ToolEnvironmentPanel key={tool.id} tool={tool} />
      <DiagnosticReportDialog report={reportPreview} onClose={() => setReportPreview(null)} onCopied={() => {
        setReportCopied(true)
        window.setTimeout(() => setReportCopied(false), 2400)
      }} />
    </>
  )
}
