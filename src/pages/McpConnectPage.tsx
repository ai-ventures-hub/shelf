import { useCallback, useEffect, useMemo, useState } from 'react'
import { ClientConnectionRow } from '../components/mcp/ClientConnectionRow'
import { McpAdvancedPanel } from '../components/mcp/McpAdvancedPanel'
import type { OverflowMenuItem } from '../components/mcp/OverflowMenu'
import { MCP_TEST_PROMPT } from '../lib/mcpClientGuides'
import {
  buildClientSnapshot,
  summarizeClients,
  type McpClientKind,
} from '../lib/mcpConnectionStatus'
import type {
  ClaudeDesktopStatus,
  CodexMcpStatus,
  CursorMcpStatus,
} from '../types'

/**
 * MCP Connections — overview + compact client rows + collapsed Advanced.
 * Connection IPC unchanged; this page is presentation + progressive disclosure.
 */
export function McpConnectPage() {
  const [serverPath, setServerPath] = useState(
    '/path/to/Shelf.app/Contents/Resources/mcp/mcp/server.js',
  )
  const [claudeStatus, setClaudeStatus] = useState<ClaudeDesktopStatus | null>(null)
  const [cursorStatus, setCursorStatus] = useState<CursorMcpStatus | null>(null)
  const [codexStatus, setCodexStatus] = useState<CodexMcpStatus | null>(null)
  const [busy, setBusy] = useState<Partial<Record<McpClientKind, boolean>>>({})
  const [errors, setErrors] = useState<Partial<Record<McpClientKind, string>>>({})
  const [flash, setFlash] = useState<Partial<Record<McpClientKind, string>>>({})
  /** Soft “reload client” hint after Cursor/Codex connect until user refreshes. */
  const [needsRestart, setNeedsRestart] = useState<Partial<Record<McpClientKind, boolean>>>(
    {},
  )

  const refreshAll = useCallback(async () => {
    if (!window.shelf?.getClaudeDesktopStatus) return
    try {
      const [claude, cursor, codex] = await Promise.all([
        window.shelf.getClaudeDesktopStatus(),
        window.shelf.getCursorMcpStatus(),
        window.shelf.getCodexMcpStatus(),
      ])
      setClaudeStatus(claude)
      setCursorStatus(cursor)
      setCodexStatus(codex)
      setErrors({})
      // Clear soft restart once Claude is live / Cursor+Codex still match.
      setNeedsRestart((prev) => ({
        claude: claude.claudeLoaded ? false : prev.claude,
        cursor: false,
        codex: false,
      }))
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setErrors({ claude: message, cursor: message, codex: message })
    }
  }, [])

  useEffect(() => {
    if (!window.shelf?.getMcpServerPath) {
      void refreshAll()
      return
    }
    void window.shelf
      .getMcpServerPath()
      .then(setServerPath)
      .finally(() => {
        void refreshAll()
      })
  }, [refreshAll])

  function setClientBusy(kind: McpClientKind, value: boolean) {
    setBusy((prev) => ({ ...prev, [kind]: value }))
  }

  function showFlash(kind: McpClientKind, message: string) {
    setFlash((prev) => ({ ...prev, [kind]: message }))
    window.setTimeout(() => {
      setFlash((prev) => ({ ...prev, [kind]: undefined }))
    }, 2800)
  }

  async function connect(kind: McpClientKind) {
    setClientBusy(kind, true)
    setErrors((prev) => ({ ...prev, [kind]: undefined }))
    try {
      if (kind === 'claude') {
        const result = await window.shelf.connectClaudeDesktop()
        setClaudeStatus(result.status)
        showFlash('claude', 'Settings updated.')
      } else if (kind === 'cursor') {
        const result = await window.shelf.connectCursorMcp()
        setCursorStatus(result.status)
        setNeedsRestart((prev) => ({ ...prev, cursor: true }))
        showFlash('cursor', 'Settings updated.')
      } else {
        const result = await window.shelf.connectCodexMcp()
        setCodexStatus(result.status)
        setNeedsRestart((prev) => ({ ...prev, codex: true }))
        showFlash('codex', 'Settings updated.')
      }
    } catch (err) {
      setErrors((prev) => ({
        ...prev,
        [kind]: err instanceof Error ? err.message : String(err),
      }))
    } finally {
      setClientBusy(kind, false)
    }
  }

  async function disconnect(kind: McpClientKind) {
    if (!window.confirm(`Disconnect Shelf from ${labelFor(kind)}?`)) return
    setClientBusy(kind, true)
    try {
      if (kind === 'claude') {
        setClaudeStatus((await window.shelf.disconnectClaudeDesktop()).status)
      } else if (kind === 'cursor') {
        setCursorStatus((await window.shelf.disconnectCursorMcp()).status)
      } else {
        setCodexStatus((await window.shelf.disconnectCodexMcp()).status)
      }
      setNeedsRestart((prev) => ({ ...prev, [kind]: false }))
      showFlash(kind, 'Disconnected.')
    } catch (err) {
      setErrors((prev) => ({
        ...prev,
        [kind]: err instanceof Error ? err.message : String(err),
      }))
    } finally {
      setClientBusy(kind, false)
    }
  }

  async function openApp(kind: McpClientKind) {
    if (kind === 'claude') await window.shelf.openClaudeDesktop()
    else if (kind === 'cursor') await window.shelf.openCursorApp()
    else await window.shelf.openCodexApp()
  }

  async function copyPrompt() {
    await navigator.clipboard.writeText(MCP_TEST_PROMPT)
  }

  const clients = useMemo(() => {
    return [
      buildClientSnapshot('claude', claudeStatus, {
        busy: busy.claude,
        error: errors.claude,
      }),
      buildClientSnapshot('cursor', cursorStatus, {
        busy: busy.cursor,
        error: errors.cursor,
        needsRestart: needsRestart.cursor,
      }),
      buildClientSnapshot('codex', codexStatus, {
        busy: busy.codex,
        error: errors.codex,
        needsRestart: needsRestart.codex,
      }),
    ]
  }, [claudeStatus, cursorStatus, codexStatus, busy, errors, needsRestart])

  const summary = summarizeClients(clients)

  function menuFor(kind: McpClientKind): OverflowMenuItem[] {
    const connected =
      kind === 'claude'
        ? Boolean(claudeStatus?.connected)
        : kind === 'cursor'
          ? Boolean(cursorStatus?.connected)
          : Boolean(codexStatus?.connected)

    const items: OverflowMenuItem[] = [
      {
        id: 'open',
        label: kind === 'codex' ? 'Open ChatGPT' : `Open ${labelFor(kind)}`,
        onSelect: () => void openApp(kind),
      },
      {
        id: 'prompt',
        label: 'Copy test prompt',
        onSelect: () => void copyPrompt().then(() => showFlash(kind, 'Prompt copied.')),
      },
      {
        id: 'refresh',
        label: 'Refresh status',
        onSelect: () => void refreshAll(),
      },
    ]
    if (connected) {
      items.push({
        id: 'disconnect',
        label: 'Disconnect',
        danger: true,
        onSelect: () => void disconnect(kind),
      })
    }
    return items
  }

  function onPrimary(kind: McpClientKind) {
    const client = clients.find((c) => c.kind === kind)
    if (!client?.primaryKind) return
    if (client.primaryKind === 'restart') {
      void openApp(kind)
      return
    }
    void connect(kind)
  }

  return (
    <div className="mcp-page">
      <header className="page-header page-header-compact mcp-overview">
        <div className="page-header-copy">
          <h1 className="page-title">MCP Connections</h1>
          <p className="page-meta">Connect Shelf to your AI tools.</p>
        </div>
        <div className="mcp-overview-aside">
          <p className="mcp-overview-stats" aria-live="polite">
            <span>
              <strong>{summary.connected}</strong> connected
            </span>
            <span className="mcp-overview-dot" aria-hidden>
              ·
            </span>
            <span>
              <strong>{summary.attention}</strong> attention needed
            </span>
          </p>
          <button
            type="button"
            className="btn btn-quiet btn-sm"
            onClick={() => void refreshAll()}
          >
            Refresh status
          </button>
        </div>
      </header>

      <section className="mcp-clients" aria-label="Supported clients">
        <h2 className="mcp-section-label">Supported clients</h2>
        <div className="mcp-client-list">
          {clients.map((client) => (
            <ClientConnectionRow
              key={client.kind}
              client={client}
              flash={flash[client.kind]}
              onPrimary={() => onPrimary(client.kind)}
              menuItems={menuFor(client.kind)}
            />
          ))}
        </div>
      </section>

      <McpAdvancedPanel
        serverPath={serverPath}
        configPaths={{
          claude: claudeStatus?.configPath,
          cursor: cursorStatus?.configPath,
          codex: codexStatus?.configPath,
        }}
      />
    </div>
  )
}

function labelFor(kind: McpClientKind): string {
  if (kind === 'claude') return 'Claude Desktop'
  if (kind === 'cursor') return 'Cursor'
  return 'Codex'
}
