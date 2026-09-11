/**
 * IPC handlers for one-click MCP client connects
 * (Claude Desktop / Claude Code / Cursor / Codex).
 * Kept out of main.ts so window/bootstrap wiring stays readable.
 */
import { clientObservation } from '../shared/client-observation'
import { ipcMain } from 'electron'
import {
  connectClaudeDesktop,
  disconnectClaudeDesktop,
  getClaudeDesktopStatus,
} from '../shared/claude-desktop'
import {
  connectClaudeCodeMcp,
  disconnectClaudeCodeMcp,
  getClaudeCodeMcpStatus,
} from '../shared/claude-code-mcp'
import {
  connectCodexMcp,
  disconnectCodexMcp,
  getCodexMcpStatus,
} from '../shared/codex-mcp'
import {
  connectCursorMcp,
  disconnectCursorMcp,
  getCursorMcpStatus,
} from '../shared/cursor-mcp'
import { detectInstalledClients } from '../shared/mcp-client-detect'
import * as system from './system-bridge'

export function registerMcpConnectIpc(resolveMcpServerPath: () => string): void {
  ipcMain.handle('mcpClients:detect', () => detectInstalledClients())

  ipcMain.handle('claude:status', () =>
    getClaudeDesktopStatus({ serverPath: resolveMcpServerPath() }).then((status) => ({ ...status, ...clientObservation(resolveMcpServerPath(), 'claude') })),
  )
  ipcMain.handle('claude:connect', () =>
    connectClaudeDesktop({ serverPath: resolveMcpServerPath() }),
  )
  ipcMain.handle('claude:disconnect', () =>
    disconnectClaudeDesktop({ serverPath: resolveMcpServerPath() }),
  )
  ipcMain.handle('claude:openApp', async () => {
    await system.openApp('Claude')
  })

  ipcMain.handle('claudeCode:status', () =>
    getClaudeCodeMcpStatus({ serverPath: resolveMcpServerPath() }).then((status) => ({ ...status, ...clientObservation(resolveMcpServerPath(), 'claude-code') })),
  )
  ipcMain.handle('claudeCode:connect', () =>
    connectClaudeCodeMcp({ serverPath: resolveMcpServerPath() }),
  )
  ipcMain.handle('claudeCode:disconnect', () =>
    disconnectClaudeCodeMcp({ serverPath: resolveMcpServerPath() }),
  )

  ipcMain.handle('cursor:status', () =>
    getCursorMcpStatus({ serverPath: resolveMcpServerPath() }).then((status) => ({ ...status, ...clientObservation(resolveMcpServerPath(), 'cursor') })),
  )
  ipcMain.handle('cursor:connect', () =>
    connectCursorMcp({ serverPath: resolveMcpServerPath() }),
  )
  ipcMain.handle('cursor:disconnect', () =>
    disconnectCursorMcp({ serverPath: resolveMcpServerPath() }),
  )
  ipcMain.handle('cursor:openApp', async () => {
    await system.openApp('Cursor')
  })

  ipcMain.handle('codex:status', () =>
    getCodexMcpStatus({ serverPath: resolveMcpServerPath() }).then((status) => ({ ...status, ...clientObservation(resolveMcpServerPath(), 'codex') })),
  )
  ipcMain.handle('codex:connect', () =>
    connectCodexMcp({ serverPath: resolveMcpServerPath() }),
  )
  ipcMain.handle('codex:disconnect', () =>
    disconnectCodexMcp({ serverPath: resolveMcpServerPath() }),
  )
  // Codex desktop and CLI share the same config.toml.
  ipcMain.handle('codex:openApp', async () => {
    await system.openApp('Codex')
  })
}
