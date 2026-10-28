/**
 * One-click MCP client connects (Claude Desktop / Claude Code / Cursor / Codex).
 */
import { clientObservation } from '../../shared/client-observation'
import {
  connectClaudeDesktop,
  disconnectClaudeDesktop,
  getClaudeDesktopStatus,
} from '../../shared/claude-desktop'
import {
  connectClaudeCodeMcp,
  disconnectClaudeCodeMcp,
  getClaudeCodeMcpStatus,
} from '../../shared/claude-code-mcp'
import {
  connectCodexMcp,
  disconnectCodexMcp,
  getCodexMcpStatus,
} from '../../shared/codex-mcp'
import {
  connectCursorMcp,
  disconnectCursorMcp,
  getCursorMcpStatus,
} from '../../shared/cursor-mcp'
import { detectInstalledClients } from '../../shared/mcp-client-detect'
import * as system from '../system-bridge'
import type { IpcContext } from './context'
import { handle } from './typed'

export function registerMcpConnectIpc(ctx: IpcContext): void {
  const { resolveMcpServerPath } = ctx

  handle('mcpClients:detect', () => detectInstalledClients())

  handle('claude:status', () =>
    getClaudeDesktopStatus({ serverPath: resolveMcpServerPath() }).then((status) => ({ ...status, ...clientObservation(resolveMcpServerPath(), 'claude') })),
  )
  handle('claude:connect', () =>
    connectClaudeDesktop({ serverPath: resolveMcpServerPath() }),
  )
  handle('claude:disconnect', () =>
    disconnectClaudeDesktop({ serverPath: resolveMcpServerPath() }),
  )
  handle('claude:openApp', async () => {
    await system.openApp('Claude')
  })

  handle('claudeCode:status', () =>
    getClaudeCodeMcpStatus({ serverPath: resolveMcpServerPath() }).then((status) => ({ ...status, ...clientObservation(resolveMcpServerPath(), 'claude-code') })),
  )
  handle('claudeCode:connect', () =>
    connectClaudeCodeMcp({ serverPath: resolveMcpServerPath() }),
  )
  handle('claudeCode:disconnect', () =>
    disconnectClaudeCodeMcp({ serverPath: resolveMcpServerPath() }),
  )

  handle('cursor:status', () =>
    getCursorMcpStatus({ serverPath: resolveMcpServerPath() }).then((status) => ({ ...status, ...clientObservation(resolveMcpServerPath(), 'cursor') })),
  )
  handle('cursor:connect', () =>
    connectCursorMcp({ serverPath: resolveMcpServerPath() }),
  )
  handle('cursor:disconnect', () =>
    disconnectCursorMcp({ serverPath: resolveMcpServerPath() }),
  )
  handle('cursor:openApp', async () => {
    await system.openApp('Cursor')
  })

  handle('codex:status', () =>
    getCodexMcpStatus({ serverPath: resolveMcpServerPath() }).then((status) => ({ ...status, ...clientObservation(resolveMcpServerPath(), 'codex') })),
  )
  handle('codex:connect', () =>
    connectCodexMcp({ serverPath: resolveMcpServerPath() }),
  )
  handle('codex:disconnect', () =>
    disconnectCodexMcp({ serverPath: resolveMcpServerPath() }),
  )
  // Codex desktop and CLI share the same config.toml.
  handle('codex:openApp', async () => {
    await system.openApp('Codex')
  })
}
