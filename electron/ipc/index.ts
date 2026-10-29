/**
 * Desktop IPC, one module per domain. Every handler is registered through
 * the typed `handle()` in ./typed.ts against the channel map in
 * shared/ipc-channels.ts, which the preload consumes too — so main and
 * preload cannot drift from each other or from the renderer's ShelfApi.
 */
import { registerActivityIpc } from './activity'
import { registerCapabilityGapsIpc } from './capability-gaps'
import { registerCollectionsIpc } from './collections'
import { registerCompanionIpc } from './companion'
import type { IpcContext } from './context'
import { registerDesignProfilesIpc } from './design-profiles'
import { registerMcpConnectIpc } from './mcp-connect'
import { registerPrefsIpc } from './prefs'
import { registerProcessIpc } from './process'
import { registerShareIpc } from './share'
import { registerStarterIpc } from './starter'
import { registerSystemIpc } from './system'
import { registerToolsIpc } from './tools'
import { registerVerificationIpc } from './verification'

export type { IpcContext } from './context'

export function registerIpc(ctx: IpcContext): void {
  registerVerificationIpc(ctx)
  registerToolsIpc(ctx)
  registerCapabilityGapsIpc(ctx)
  registerDesignProfilesIpc(ctx)
  registerActivityIpc(ctx)
  registerStarterIpc(ctx)
  registerCollectionsIpc(ctx)
  registerPrefsIpc(ctx)
  registerProcessIpc(ctx)
  registerShareIpc(ctx)
  registerSystemIpc(ctx)
  registerMcpConnectIpc(ctx)
  registerCompanionIpc(ctx)
}
