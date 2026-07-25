/**
 * IPC handlers for one-click MCP client connects (Claude / Cursor / Codex).
 * Kept out of main.ts so window/bootstrap wiring stays readable.
 */
import { ipcMain } from 'electron'
import {
  connectClaudeDesktop,
  disconnectClaudeDesktop,
  getClaudeDesktopStatus,
} from '../shared/claude-desktop'
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
import * as system from './system-bridge'

export function registerMcpConnectIpc(resolveMcpServerPath: () => string): void {
  ipcMain.handle('claude:status', () =>
    getClaudeDesktopStatus({ serverPath: resolveMcpServerPath() }),
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

  ipcMain.handle('cursor:status', () =>
    getCursorMcpStatus({ serverPath: resolveMcpServerPath() }),
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
    getCodexMcpStatus({ serverPath: resolveMcpServerPath() }),
  )
  ipcMain.handle('codex:connect', () =>
    connectCodexMcp({ serverPath: resolveMcpServerPath() }),
  )
  ipcMain.handle('codex:disconnect', () =>
    disconnectCodexMcp({ serverPath: resolveMcpServerPath() }),
  )
  // Codex desktop lives inside ChatGPT.app; CLI shares the same config.toml.
  ipcMain.handle('codex:openApp', async () => {
    await system.openApp('ChatGPT')
  })
}
