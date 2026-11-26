import { checkAppUpdates, getAppUpdateState } from '../auto-update'
import { registerShelfProtocolClient } from '../desktop-integration'
import { isLoopbackHost } from '../../shared/companion-preview-policy'
import * as system from '../system-bridge'
import type { IpcContext } from './context'
import { handle } from './typed'

/** macOS system bridges (open URL / path / editor / terminal) and app updates. */
export function registerSystemIpc(ctx: IpcContext): void {
  handle('system:openUrl', (_e, url) => {
    // Opening a running tool in the browser is using it. Shelf cannot see the
    // browser, so this is the moment a tool it started for an agent becomes yours.
    try {
      const target = new URL(url)
      if (isLoopbackHost(target.hostname) && target.port) {
        for (const tool of ctx.store.list()) {
          if (String(tool.port || '') === target.port) ctx.claimTool(tool.id)
        }
      }
    } catch { /* openUrl reports a bad URL itself */ }
    return system.openUrl(url)
  })
  handle('system:openPath', (_e, target) => system.openPath(target))
  handle('system:openEditor', (_e, projectPath) => system.openEditor(projectPath))
  handle('system:openTerminal', (_e, projectPath) => system.openTerminal(projectPath))
  handle('system:mcpServerPath', () => ctx.resolveMcpServerPath())
  handle('system:registerShelfProtocol', () => {
    registerShelfProtocolClient()
    return true
  })

  handle('app:updateState', () => getAppUpdateState())
  handle('app:checkUpdates', () => checkAppUpdates())
  handle('app:installUpdate', () => ctx.installUpdate())
}
