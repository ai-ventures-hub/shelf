import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { LogPanel } from '../components/LogPanel'
import { ReceiptHistory } from '../components/ReceiptHistory'
import { StatusPill } from '../components/StatusPill'
import { ToolIcon } from '../components/ToolIcon'
import { useLibrary } from '../hooks/useLibrary'
import { useReceipts } from '../hooks/useReceipts'
import type { DesignMdResult, LogLine } from '../types'

function formatRelative(iso?: string): string {
  if (!iso) return 'Unknown'
  const then = new Date(iso).getTime()
  if (!Number.isFinite(then)) return 'Unknown'
  const delta = Date.now() - then
  const mins = Math.round(delta / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 48) return `${hours}h ago`
  const days = Math.round(hours / 24)
  return `${days}d ago`
}

export function ToolDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const {
    tools,
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
  const [logs, setLogs] = useState<LogLine[]>([])
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [designMd, setDesignMd] = useState<DesignMdResult | null>(null)
  const { receipts, clear: clearReceipts } = useReceipts({
    toolId: id,
    limit: 25,
  })

  useEffect(() => {
    if (!id) return
    let active = true
    void getLogs(id).then((lines) => {
      if (active) setLogs(lines)
    })
    const off = subscribeLogs(id, (line) => {
      setLogs((prev) => [...prev, line])
    })
    return () => {
      active = false
      off()
    }
  }, [id, getLogs, subscribeLogs])

  useEffect(() => {
    if (!id || !window.shelf?.getDesignMd) {
      setDesignMd(null)
      return
    }
    let active = true
    void window.shelf.getDesignMd({ id }).then((result) => {
      if (active) setDesignMd(result)
    })
    return () => {
      active = false
    }
  }, [id, tool?.projectPath])

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

  const canStop = status === 'running' || status === 'starting'
  const canStart = status === 'stopped' || status === 'error'

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

  return (
    <>
      <header className="page-header">
        <div className="page-header-copy">
          <p className="eyebrow">Tool detail</p>
          <h1 className="page-title">{tool.name}</h1>
          <p className="page-lede">
            {tool.description || 'No description yet. Edit this tool to document what it does.'}
          </p>
        </div>
        <Link className="btn btn-quiet" to={`/tools/${tool.id}/edit`}>
          Edit
        </Link>
      </header>

      <div className="detail-hero">
        <ToolIcon
          name={tool.name}
          iconPath={tool.iconPath}
          iconLucide={tool.iconLucide}
          iconColor={tool.iconColor}
          iconBackground={tool.iconBackground}
        />
        <div className="stack" style={{ gap: '0.45rem' }}>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <StatusPill status={status} message={state?.message} />
            {tool.favorite ? <span className="tag-chip">Favorite</span> : null}
            {tool.tags.map((tag) => (
              <span key={tag} className="tag-chip">
                {tag}
              </span>
            ))}
          </div>
          <p style={{ margin: 0, color: 'var(--muted)' }}>
            {state?.message ||
              (tool.lastLaunchedAt
                ? `Stopped · last launch ${formatRelative(tool.lastLaunchedAt)}`
                : 'Stopped · never launched')}
          </p>
          {state?.pid ? (
            <p style={{ margin: 0, color: 'var(--subtle)', fontSize: '0.82rem' }}>
              pid {state.pid}
              {state.startedAt ? ` · started ${formatRelative(state.startedAt)}` : ''}
            </p>
          ) : null}
        </div>
      </div>

      {actionError ? (
        <div className="warning-card" role="alert" style={{ marginBottom: '1rem' }}>
          {actionError}
        </div>
      ) : null}

      <div className="action-row">
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy || !canStart}
          onClick={() => void run(() => startTool(tool.id))}
        >
          Launch
        </button>
        <button
          type="button"
          className="btn btn-quiet"
          disabled={busy || !canStop}
          onClick={() => void run(() => stopTool(tool.id))}
        >
          Stop
        </button>
        <button
          type="button"
          className="btn btn-quiet"
          disabled={busy}
          onClick={() => void run(() => restartTool(tool.id))}
        >
          Restart
        </button>
        {tool.url ? (
          <button
            type="button"
            className="btn btn-quiet btn-sm"
            onClick={() => void window.shelf.openUrl(tool.url!)}
          >
            Open URL
          </button>
        ) : null}
        {tool.projectPath ? (
          <>
            <button
              type="button"
              className="btn btn-quiet btn-sm"
              onClick={() => void window.shelf.openPath(tool.projectPath!)}
            >
              Open folder
            </button>
            <button
              type="button"
              className="btn btn-quiet btn-sm"
              onClick={() => void window.shelf.openEditor(tool.projectPath!)}
            >
              Open editor
            </button>
            <button
              type="button"
              className="btn btn-quiet btn-sm"
              onClick={() => void window.shelf.openTerminal(tool.projectPath!)}
            >
              Open Terminal
            </button>
          </>
        ) : null}
        <button
          type="button"
          className="btn btn-danger btn-sm"
          disabled={busy}
          onClick={() => {
            if (
              !window.confirm(
                `Remove “${tool.name}” from Shelf? This does not delete the project files.`,
              )
            ) {
              return
            }
            void run(async () => {
              await deleteTool(tool.id)
              navigate('/')
            })
          }}
        >
          Remove
        </button>
      </div>

      <div className="detail-layout">
        <section className="panel">
          <div className="panel-header">
            <h2 className="panel-title">Live logs</h2>
          </div>
          <div className="panel-body">
            <LogPanel lines={logs} />
          </div>
        </section>

        <section className="panel">
          <div className="panel-header">
            <h2 className="panel-title">Configuration</h2>
          </div>
          <div className="panel-body stack">
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
                    onClick={() => void window.shelf.openPath(designMd.path!)}
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
            ) : (
              <div className="warning-card">
                No operating notes yet. Capture inputs, common errors, and the last known
                working configuration when you edit this tool.
              </div>
            )}
          </div>
        </section>
      </div>

      <section className="panel" style={{ marginTop: '1rem' }}>
        <div className="panel-header">
          <h2 className="panel-title">Run history</h2>
          {receipts.length > 0 ? (
            <button
              type="button"
              className="btn btn-quiet btn-sm"
              onClick={() => {
                if (window.confirm('Clear run history for this tool?')) {
                  void clearReceipts()
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
            emptyLabel="No launches recorded yet. Launch this tool to create a receipt."
          />
        </div>
      </section>
    </>
  )
}
