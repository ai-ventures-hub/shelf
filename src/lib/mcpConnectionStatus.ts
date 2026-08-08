/**
 * Normalize Claude / Claude Code / Cursor / Codex status into one
 * product-facing state machine.
 */

export type McpClientKind = 'claude' | 'claude-code' | 'cursor' | 'codex'

/** Product-facing connection states shown in the UI. */
export type McpUiState =
  | 'connected'
  | 'update'
  | 'disconnected'
  | 'restart'
  | 'connecting'
  | 'error'

export interface McpClientSnapshot {
  kind: McpClientKind
  name: string
  /** Short product mark letter for the row icon. */
  mark: string
  state: McpUiState
  /** One-line status under the product name. */
  detail: string
  badge: string
  tone: 'success' | 'warning' | 'danger' | 'neutral'
  configPath?: string
  primaryLabel: string | null
  primaryKind: 'connect' | 'update' | 'reconnect' | 'restart' | null
}

interface RawStatus {
  connected: boolean
  matches: boolean
  serverOk: boolean
  nodeOk: boolean
  message: string
  configPath?: string
  /** Claude-only: MCP process actually loaded. */
  claudeLoaded?: boolean
}

export function deriveMcpUiState(
  status: RawStatus | null,
  opts: { busy?: boolean; error?: string | null; needsRestart?: boolean } = {},
): Pick<McpClientSnapshot, 'state' | 'detail' | 'badge' | 'tone' | 'primaryLabel' | 'primaryKind'> {
  if (opts.busy) {
    return {
      state: 'connecting',
      detail: 'Updating connection…',
      badge: 'Working',
      tone: 'neutral',
      primaryLabel: null,
      primaryKind: null,
    }
  }

  if (opts.error) {
    return {
      state: 'error',
      detail: opts.error,
      badge: 'Error',
      tone: 'danger',
      primaryLabel: 'Retry',
      primaryKind: 'reconnect',
    }
  }

  if (!status) {
    return {
      state: 'disconnected',
      detail: 'Checking status…',
      badge: 'Checking',
      tone: 'neutral',
      primaryLabel: null,
      primaryKind: null,
    }
  }

  if (!status.serverOk) {
    return {
      state: 'error',
      detail: 'Shelf MCP server file is missing.',
      badge: 'MCP missing',
      tone: 'danger',
      primaryLabel: 'Retry',
      primaryKind: 'reconnect',
    }
  }

  if (!status.nodeOk) {
    return {
      state: 'error',
      detail: 'Node.js was not found on this Mac.',
      badge: 'Node needed',
      tone: 'danger',
      primaryLabel: 'Retry',
      primaryKind: 'reconnect',
    }
  }

  if (status.connected && !status.matches) {
    return {
      state: 'update',
      // Prefer server message (e.g. Desktop → /Applications migration hint).
      detail: status.message || 'Connection settings have changed.',
      badge: 'Update available',
      tone: 'warning',
      primaryLabel: 'Update',
      primaryKind: 'update',
    }
  }

  // Claude: config written but Desktop has not spawned Shelf yet.
  if (status.connected && status.matches && status.claudeLoaded === false) {
    return {
      state: 'restart',
      detail: 'Restart Claude to finish setup.',
      badge: 'Restart required',
      tone: 'warning',
      primaryLabel: 'Restart app',
      primaryKind: 'restart',
    }
  }

  // Soft restart hint after Cursor/Codex connect (caller sets needsRestart).
  if (status.connected && status.matches && opts.needsRestart) {
    return {
      state: 'restart',
      detail: 'Reload or restart the client to finish.',
      badge: 'Restart required',
      tone: 'warning',
      primaryLabel: 'Open app',
      primaryKind: 'restart',
    }
  }

  if (status.connected && status.matches) {
    return {
      state: 'connected',
      detail: 'Shelf is available to this client.',
      badge: 'Connected',
      tone: 'success',
      primaryLabel: null,
      primaryKind: null,
    }
  }

  return {
    state: 'disconnected',
    detail: 'Connect Shelf to use your local tools.',
    badge: 'Disconnected',
    tone: 'neutral',
    primaryLabel: 'Connect',
    primaryKind: 'connect',
  }
}

export function buildClientSnapshot(
  kind: McpClientKind,
  status: RawStatus | null,
  opts: { busy?: boolean; error?: string | null; needsRestart?: boolean } = {},
): McpClientSnapshot {
  const meta =
    kind === 'claude'
      ? { name: 'Claude Desktop', mark: 'C' }
      : kind === 'claude-code'
        ? { name: 'Claude Code', mark: 'CC' }
        : kind === 'cursor'
          ? { name: 'Cursor', mark: 'Cu' }
          : { name: 'OpenAI Codex', mark: 'Cx' }

  const derived = deriveMcpUiState(status, opts)
  const detail =
    derived.state === 'connected'
      ? `Shelf is available in ${meta.name}.`
      : derived.detail

  // Claude Code is a terminal app: no app to reopen — a new session picks
  // up the config, so the restart state is informational only.
  if (kind === 'claude-code' && derived.state === 'restart') {
    return {
      kind,
      name: meta.name,
      mark: meta.mark,
      configPath: status?.configPath,
      ...derived,
      detail: 'Start a new Claude Code session to finish.',
      primaryLabel: null,
      primaryKind: null,
    }
  }

  return {
    kind,
    name: meta.name,
    mark: meta.mark,
    configPath: status?.configPath,
    ...derived,
    detail,
  }
}

export function summarizeClients(clients: McpClientSnapshot[]): {
  connected: number
  attention: number
} {
  let connected = 0
  let attention = 0
  for (const c of clients) {
    if (c.state === 'connected') connected += 1
    if (c.state === 'update' || c.state === 'restart' || c.state === 'error') attention += 1
  }
  return { connected, attention }
}
