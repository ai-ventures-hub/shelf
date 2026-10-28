import { checkAppUpdates, getAppUpdateState } from '../auto-update'
import { registerShelfProtocolClient } from '../desktop-integration'
import * as system from '../system-bridge'
import type { IpcContext } from './context'
import { handle } from './typed'

/** macOS system bridges (open URL / path / editor / terminal) and app updates. */
export function registerSystemIpc(ctx: IpcContext): void {
  handle('system:openUrl', (_e, url) => system.openUrl(url))
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
