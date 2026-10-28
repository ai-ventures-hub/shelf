import type { BrowserWindow } from 'electron'
import type { CapabilityGapStore } from '../../shared/capability-gap-store'
import type { DesignProfileStore } from '../../shared/design-profile-store'
import type { PrefsStore } from '../../shared/prefs-store'
import type { ProjectMemoryStore } from '../../shared/project-memory-store'
import type { ReceiptStore } from '../../shared/receipt-store'
import type { TeamCatalogStore } from '../../shared/team-catalog-store'
import type { ToolDraftStore } from '../../shared/tool-draft-store'
import type { VerificationRunner } from '../../shared/verification-runner'
import type { DesktopIntegrationHost } from '../desktop-integration'
import type { LibraryStore } from '../library-store'
import type { ProcessManager } from '../process-manager'

/**
 * Everything an IPC domain module may reach. main.ts builds one of these
 * after the stores exist and hands it to `registerIpc`; the modules own no
 * state of their own beyond what a handler needs between two calls.
 */
export interface IpcContext {
  store: LibraryStore
  processes: ProcessManager
  prefs: PrefsStore
  verification: VerificationRunner
  projectMemory: ProjectMemoryStore
  receipts: ReceiptStore
  capabilityGaps: CapabilityGapStore
  designProfiles: DesignProfileStore
  teamCatalogs: TeamCatalogStore
  toolDrafts: ToolDraftStore
  /** The window dialogs attach to; null while hidden to the menu bar. */
  getMainWindow: () => BrowserWindow | null
  getDesktopHost: () => DesktopIntegrationHost
  /** MCP server path for Connect and Advanced copy. */
  resolveMcpServerPath: () => string
  /** Keep the macOS login item in step with the preference. */
  applyLaunchAtLogin: (enabled: boolean) => void
  /** True while Shelf is quitting, or preparing to quit or update. */
  isShuttingDown: () => boolean
  /** Stop tools, quit, install the downloaded update, relaunch. Owned by main. */
  installUpdate: () => Promise<void>
}
