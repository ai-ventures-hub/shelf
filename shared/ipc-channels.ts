/**
 * The one typed map of desktop IPC channels.
 *
 * Every `invoke` channel is bound to the `ShelfApi` method it implements, so
 * the channel's argument list and result are declared exactly once (in
 * desktop-api.ts) and both ends are checked against it:
 *
 * - main registers handlers through `electron/ipc/typed.ts` → `handle()`,
 *   which types the arguments and the awaited result from this map;
 * - the preload builds its bridge through a typed `invoke()` whose result
 *   must then satisfy `ShelfApi`.
 *
 * Adding a channel means adding it here; a handler for an unknown channel,
 * a preload call with the wrong arguments, or a handler returning the wrong
 * shape all fail `npm run typecheck` instead of surfacing at first click.
 *
 * Push channels (main → renderer) are listed separately with their payloads.
 */
import type { CompanionStatus } from './companion-contracts'
import type { ShelfApi } from './desktop-api'
import type {
  AppUpdateState,
  LogLine,
  RunReceipt,
  ShortcutStatus,
  ToolRuntimeState,
} from './contracts'

export interface IpcInvokeMap {
  // Verification workflows
  'verification:activity': ShelfApi['getVerificationActivity']
  'verification:get': ShelfApi['getVerification']
  'verification:save': ShelfApi['saveVerification']
  'verification:suggest': ShelfApi['suggestVerification']
  'verification:start': ShelfApi['startVerification']
  'verification:cancel': ShelfApi['cancelVerification']
  'verification:logs': ShelfApi['getVerificationLogs']
  'verification:handoff': ShelfApi['prepareVerificationHandoff']
  // Project memory and handoffs
  'context:getMemory': ShelfApi['getProjectMemory']
  'context:saveMemory': ShelfApi['saveProjectMemory']
  'context:handoff': ShelfApi['prepareProjectHandoff']
  // Library tools
  'tools:list': ShelfApi['listTools']
  'tools:recovery': ShelfApi['getLibraryRecovery']
  'tools:save': ShelfApi['saveTool']
  'tools:delete': ShelfApi['deleteTool']
  'tools:readiness': ShelfApi['checkToolReadiness']
  'tools:health': ShelfApi['getToolHealth']
  'tools:environment': ShelfApi['inspectToolEnvironment']
  'tools:pickFolder': ShelfApi['pickFolder']
  'tools:inspectProject': ShelfApi['inspectProject']
  'tools:registerProject': ShelfApi['registerProject']
  'tools:pickIcon': ShelfApi['pickIcon']
  'tools:iconDataUrl': ShelfApi['getIconDataUrl']
  'designMd:get': ShelfApi['getDesignMd']
  // Capability gaps
  'capabilityGaps:list': ShelfApi['listCapabilityGaps']
  'capabilityGaps:record': ShelfApi['recordCapabilityGap']
  'capabilityGaps:updateStatus': ShelfApi['updateCapabilityGapStatus']
  'capabilityGaps:update': ShelfApi['updateCapabilityGap']
  'capabilityGaps:delete': ShelfApi['deleteCapabilityGap']
  'capabilityGaps:brief': ShelfApi['getGapBrief']
  'capabilityGaps:suggestions': ShelfApi['listGapSuggestions']
  'capabilityGaps:dismissSuggestion': ShelfApi['dismissGapSuggestion']
  // Design Engine profiles
  'designProfiles:list': ShelfApi['listDesignProfiles']
  'designProfiles:save': ShelfApi['saveDesignProfile']
  'designProfiles:delete': ShelfApi['deleteDesignProfile']
  'designProfiles:setDefault': ShelfApi['setDefaultDesignProfile']
  'designProfiles:pickAsset': ShelfApi['pickDesignAsset']
  'designProfiles:importAsset': ShelfApi['importDesignAsset']
  'designProfiles:removeAsset': ShelfApi['removeDesignAsset']
  'designProfiles:brief': ShelfApi['designBrief']
  'designProfiles:extractTokens': ShelfApi['extractDesignTokens']
  'designProfiles:assetDataUrl': ShelfApi['designAssetDataUrl']
  // Activity board and agent registration drafts
  'activity:board': ShelfApi['getActivityBoard']
  'drafts:list': ShelfApi['listToolDrafts']
  'drafts:accept': ShelfApi['acceptToolDraft']
  'drafts:reject': ShelfApi['rejectToolDraft']
  // Start a new tool
  'starter:prepare': ShelfApi['prepareToolStarter']
  'starter:create': ShelfApi['createToolFromIdea']
  'starter:chooseFolder': ShelfApi['chooseToolsFolder']
  'starter:openAgent': ShelfApi['openToolInAgent']
  // Collections
  'collections:list': ShelfApi['listCollections']
  'collections:save': ShelfApi['saveCollection']
  'collections:delete': ShelfApi['deleteCollection']
  'collections:start': ShelfApi['startCollection']
  'collections:stop': ShelfApi['stopCollection']
  // Preferences, desktop integration, onboarding
  'prefs:get': ShelfApi['getPrefs']
  'prefs:update': ShelfApi['updatePrefs']
  'desktop:shortcutStatus': ShelfApi['getShortcutStatus']
  'onboarding:submit': ShelfApi['submitOnboarding']
  // Processes and run receipts
  'process:states': ShelfApi['getRuntimeStates']
  'process:start': ShelfApi['startTool']
  'process:stop': ShelfApi['stopTool']
  'process:restart': ShelfApi['restartTool']
  'process:logs': ShelfApi['getLogs']
  'process:errorReport': ShelfApi['getErrorReport']
  'receipts:list': ShelfApi['listReceipts']
  'receipts:clear': ShelfApi['clearReceipts']
  'receipts:export': ShelfApi['exportReceipts']
  // Tool Sharing (1.2)
  'share:exportManifest': ShelfApi['exportToolManifest']
  'share:exportBundle': ShelfApi['exportToolBundle']
  'share:stage': ShelfApi['stageSharedTool']
  'share:pickBundle': ShelfApi['pickShareBundle']
  'share:pickDestination': ShelfApi['pickShareDestination']
  'share:confirm': ShelfApi['confirmSharedTool']
  'share:pendingImports': ShelfApi['getPendingImports']
  'share:resumeImport': ShelfApi['resumeImport']
  'share:discard': ShelfApi['discardSharedTool']
  'share:checkUpdates': ShelfApi['checkToolUpdates']
  'share:applyUpdate': ShelfApi['applyToolUpdate']
  // Team Tools catalogs (1.4)
  'catalog:prepareStarter': ShelfApi['prepareCatalogStarter']
  'catalog:exportStarter': ShelfApi['exportCatalogStarter']
  'catalog:list': ShelfApi['listTeamCatalogs']
  'catalog:add': ShelfApi['addTeamCatalog']
  'catalog:refresh': ShelfApi['refreshTeamCatalog']
  'catalog:remove': ShelfApi['removeTeamCatalog']
  'catalog:publish': ShelfApi['publishToTeamCatalog']
  // System bridges and app updates
  'system:openUrl': ShelfApi['openUrl']
  'system:openPath': ShelfApi['openPath']
  'system:openEditor': ShelfApi['openEditor']
  'system:openTerminal': ShelfApi['openTerminal']
  'system:mcpServerPath': ShelfApi['getMcpServerPath']
  /** Registered for completeness; the preload does not expose it. */
  'system:registerShelfProtocol': () => Promise<boolean>
  'app:updateState': ShelfApi['getAppUpdateState']
  'app:checkUpdates': ShelfApi['checkAppUpdates']
  'app:installUpdate': ShelfApi['installUpdate']
  // Companion (2.4)
  'companion:status': ShelfApi['getCompanionStatus']
  'companion:beginPairing': ShelfApi['beginCompanionPairing']
  'companion:cancelPairing': ShelfApi['cancelCompanionPairing']
  'companion:revokeDevice': ShelfApi['revokeCompanionDevice']
  'companion:renameDevice': ShelfApi['renameCompanionDevice']
  'companion:exportCertificate': ShelfApi['exportCompanionCertificate']
  // One-click MCP client connects
  'mcpClients:detect': ShelfApi['detectMcpClients']
  'claude:status': ShelfApi['getClaudeDesktopStatus']
  'claude:connect': ShelfApi['connectClaudeDesktop']
  'claude:disconnect': ShelfApi['disconnectClaudeDesktop']
  'claude:openApp': ShelfApi['openClaudeDesktop']
  'claudeCode:status': ShelfApi['getClaudeCodeMcpStatus']
  'claudeCode:connect': ShelfApi['connectClaudeCodeMcp']
  'claudeCode:disconnect': ShelfApi['disconnectClaudeCodeMcp']
  'cursor:status': ShelfApi['getCursorMcpStatus']
  'cursor:connect': ShelfApi['connectCursorMcp']
  'cursor:disconnect': ShelfApi['disconnectCursorMcp']
  'cursor:openApp': ShelfApi['openCursorApp']
  'codex:status': ShelfApi['getCodexMcpStatus']
  'codex:connect': ShelfApi['connectCodexMcp']
  'codex:disconnect': ShelfApi['disconnectCodexMcp']
  'codex:openApp': ShelfApi['openCodexApp']
}

export type IpcInvokeChannel = keyof IpcInvokeMap
/** Arguments the renderer sends on a channel (the `_event` is not among them). */
export type IpcArgs<K extends IpcInvokeChannel> = Parameters<IpcInvokeMap[K]>
/** The awaited value a handler must produce for a channel. */
export type IpcResult<K extends IpcInvokeChannel> = Awaited<ReturnType<IpcInvokeMap[K]>>

/** Messages main pushes to the renderer, with their argument lists. */
export interface IpcEventMap {
  'verification:update': [id: string]
  'process:update': [state: ToolRuntimeState]
  'logs:line': [line: LogLine]
  'receipts:update': [receipt: RunReceipt]
  'data:external-change': [filename: string]
  'app:update-state': [state: AppUpdateState]
  'app:update-ready': [info: { version: string }]
  'app:shortcut-status': [status: ShortcutStatus]
  'app:navigate': [route: string]
  'app:focus-search': []
  'app:quick-open': []
  'app:history': [direction: 'back' | 'forward']
  'app:add-folder': [projectPath: string]
  'app:add-shared': [info: { repo: string }]
  'companion:status': [status: CompanionStatus]
}

export type IpcEventChannel = keyof IpcEventMap
