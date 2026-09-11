import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import type {
  ApplyUpdateInput,
  ApplyUpdateResult,
  ConfirmShareInput,
  ConfirmShareResult,
  CatalogPublishResult,
  CatalogSyncView,
  ShareFailure,
  ShareSource,
  StagedShare,
  TeamCatalog,
  UpdateCheck,
  RegisterProjectOptions,
  RegisterProjectResult,
  StartOptions,
  ClaudeCodeConnectResult,
  ClaudeCodeMcpStatus,
  ClaudeConnectResult,
  ClaudeDesktopStatus,
  McpClientDetection,
  AgentAccessKind,
  CapabilityGap,
  CapabilityGapStatus,
  CodexConnectResult,
  CodexMcpStatus,
  Collection,
  CollectionActionResult,
  CursorConnectResult,
  CursorMcpStatus,
  DesignAsset,
  DesignAssetKind,
  DesignMdResult,
  DesignProfile,
  ExtractedTokens,
  GapResolveSuggestion,
  SaveDesignProfileInput,
  LogLine,
  OnboardingSubmissionInput,
  ProjectImportSuggestion,
  ReceiptOutcome,
  RunReceipt,
  ShortcutStatus,
  Tool,
  ToolHealth,
  ToolReadiness,
  ToolRuntimeState,
  UiPrefs,
} from './types'

/**
 * Narrow, typed bridge for the renderer.
 * No Node APIs are exposed directly — all file/process work goes through IPC.
 */
const api = {
  getPendingImports: (): Promise<{ id: string; name: string; destination: string }[]> => ipcRenderer.invoke('share:pendingImports'),
  resumeImport: (id: string): Promise<Omit<StagedShare, 'stagePath'>> => ipcRenderer.invoke('share:resumeImport', id),
  getLibraryRecovery: (): Promise<string | null> => ipcRenderer.invoke('tools:recovery'),
  listTools: (): Promise<Tool[]> => ipcRenderer.invoke('tools:list'),
  /** Launchability snapshot for every tool — one batched port scan. */
  getToolHealth: (): Promise<ToolHealth[]> => ipcRenderer.invoke('tools:health'),
  saveTool: (tool: Tool): Promise<Tool> => ipcRenderer.invoke('tools:save', tool),
  deleteTool: (id: string): Promise<void> => ipcRenderer.invoke('tools:delete', id),
  pickFolder: (): Promise<string | null> => ipcRenderer.invoke('tools:pickFolder'),
  inspectProject: (projectPath: string): Promise<ProjectImportSuggestion> =>
    ipcRenderer.invoke('tools:inspectProject', projectPath),
  /** One-shot register: inspect → save → (consented) setup → launch. */
  registerProject: (
    projectPath: string,
    options?: RegisterProjectOptions,
  ): Promise<RegisterProjectResult> =>
    ipcRenderer.invoke('tools:registerProject', projectPath, options),
  /** Absolute path for a dropped File (drag-and-drop folder support). */
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),
  pickIcon: (): Promise<string | null> => ipcRenderer.invoke('tools:pickIcon'),
  /** Read a local icon file and return a data URL safe for <img src>. */
  getIconDataUrl: (iconPath: string): Promise<string | null> =>
    ipcRenderer.invoke('tools:iconDataUrl', iconPath),

  listCollections: (): Promise<Collection[]> =>
    ipcRenderer.invoke('collections:list'),
  saveCollection: (collection: Collection): Promise<Collection> =>
    ipcRenderer.invoke('collections:save', collection),
  deleteCollection: (id: string): Promise<void> =>
    ipcRenderer.invoke('collections:delete', id),
  /** Launch every stopped member of a collection ("Start stack"). */
  startCollection: (
    id: string,
    options?: StartOptions,
  ): Promise<CollectionActionResult> =>
    ipcRenderer.invoke('collections:start', id, options),
  /** Stop every running member Shelf owns ("Stop stack"). */
  stopCollection: (id: string): Promise<CollectionActionResult> =>
    ipcRenderer.invoke('collections:stop', id),
  /** Design Engine profiles — the GUI is the only write surface (agents read over MCP). */
  listDesignProfiles: (): Promise<DesignProfile[]> =>
    ipcRenderer.invoke('designProfiles:list'),
  saveDesignProfile: (input: SaveDesignProfileInput): Promise<DesignProfile> =>
    ipcRenderer.invoke('designProfiles:save', input),
  deleteDesignProfile: (id: string): Promise<void> =>
    ipcRenderer.invoke('designProfiles:delete', id),
  setDefaultDesignProfile: (id: string): Promise<DesignProfile> =>
    ipcRenderer.invoke('designProfiles:setDefault', id),
  /** Native file picker → copy into brand-assets; null when canceled. */
  pickDesignAsset: (profileId: string, kind: DesignAssetKind): Promise<DesignAsset | null> =>
    ipcRenderer.invoke('designProfiles:pickAsset', profileId, kind),
  /** Import a known path (drag-and-drop) into brand-assets. */
  importDesignAsset: (
    profileId: string,
    sourcePath: string,
    kind: DesignAssetKind,
  ): Promise<DesignAsset> =>
    ipcRenderer.invoke('designProfiles:importAsset', profileId, sourcePath, kind),
  removeDesignAsset: (profileId: string, assetPath: string): Promise<void> =>
    ipcRenderer.invoke('designProfiles:removeAsset', profileId, assetPath),
  /** Paste-ready markdown brand brief (secrets masked); null for unknown ids. */
  designBrief: (id: string): Promise<string | null> =>
    ipcRenderer.invoke('designProfiles:brief', id),
  /** Preview data-url for a brand asset; null for non-image assets. */
  designAssetDataUrl: (assetPath: string): Promise<string | null> =>
    ipcRenderer.invoke('designProfiles:assetDataUrl', assetPath),
  /** Deterministic token extraction from a project folder (Phase 3 assist). */
  extractDesignTokens: (projectPath: string): Promise<ExtractedTokens> =>
    ipcRenderer.invoke('designProfiles:extractTokens', projectPath),

  /** Tool Sharing (1.2) — send side. Writes shelf.json, copies the link when a remote exists. */
  exportToolManifest: (
    id: string,
  ): Promise<{
    manifestPath: string
    remote?: string
    link?: string
    linkNote?: string
    copied: boolean
    envKeys: string[]
  }> => ipcRenderer.invoke('share:exportManifest', id),
  exportToolBundle: (id: string): Promise<{ saved: boolean; path?: string; bytes?: number }> =>
    ipcRenderer.invoke('share:exportBundle', id),
  /** Receive: fetch into scratch and describe for the consent sheet (runs nothing). */
  stageSharedTool: (
    source: ShareSource,
  ): Promise<{ ok: true; stage: Omit<StagedShare, 'stagePath'> } | ShareFailure> =>
    ipcRenderer.invoke('share:stage', source),
  pickShareBundle: (): Promise<string | null> => ipcRenderer.invoke('share:pickBundle'),
  pickShareDestination: (
    stageId: string,
  ): Promise<{ ok: true; destination: string | null } | ShareFailure> =>
    ipcRenderer.invoke('share:pickDestination', stageId),
  /** The approval: move, save, consented setup, launch. */
  confirmSharedTool: (
    stageId: string,
    input: ConfirmShareInput,
  ): Promise<{ ok: true; result: ConfirmShareResult } | ShareFailure> =>
    ipcRenderer.invoke('share:confirm', stageId, input),
  discardSharedTool: (stageId: string): Promise<void> =>
    ipcRenderer.invoke('share:discard', stageId),
  checkToolUpdates: (id: string): Promise<UpdateCheck> =>
    ipcRenderer.invoke('share:checkUpdates', id),
  applyToolUpdate: (id: string, input: ApplyUpdateInput): Promise<ApplyUpdateResult> =>
    ipcRenderer.invoke('share:applyUpdate', id, input),
  /** Team Tools catalogs (1.4): subscribe, refresh, publish an entry. */
  listTeamCatalogs: (): Promise<TeamCatalog[]> => ipcRenderer.invoke('catalog:list'),
  addTeamCatalog: (url: string): Promise<CatalogSyncView | ShareFailure> =>
    ipcRenderer.invoke('catalog:add', url),
  refreshTeamCatalog: (id: string): Promise<CatalogSyncView | ShareFailure> =>
    ipcRenderer.invoke('catalog:refresh', id),
  removeTeamCatalog: (id: string): Promise<boolean> => ipcRenderer.invoke('catalog:remove', id),
  publishToTeamCatalog: (
    catalogId: string,
    toolId: string,
  ): Promise<
    { ok: true; result: CatalogPublishResult; catalog?: TeamCatalog } | ShareFailure
  > => ipcRenderer.invoke('catalog:publish', catalogId, toolId),
  /** A shelf://add link arrived — renderer opens the Add-from-URL sheet. */
  onAddShared: (cb: (info: { repo: string }) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, info: { repo: string }) => cb(info)
    ipcRenderer.on('app:add-shared', listener)
    return () => ipcRenderer.removeListener('app:add-shared', listener)
  },

  getPrefs: (): Promise<UiPrefs> => ipcRenderer.invoke('prefs:get'),
  updatePrefs: (
    patch: Partial<UiPrefs>,
  ): Promise<{ prefs: UiPrefs; shortcutStatus: ShortcutStatus }> =>
    ipcRenderer.invoke('prefs:update', patch),
  getShortcutStatus: (): Promise<ShortcutStatus> =>
    ipcRenderer.invoke('desktop:shortcutStatus'),
  submitOnboarding: (
    input: OnboardingSubmissionInput,
  ): Promise<{ appVersion: string }> =>
    ipcRenderer.invoke('onboarding:submit', input),

  getDesignMd: (opts: {
    id?: string
    projectPath?: string
  }): Promise<DesignMdResult> => ipcRenderer.invoke('designMd:get', opts),
  checkToolReadiness: (id: string): Promise<ToolReadiness> =>
    ipcRenderer.invoke('tools:readiness', id),
  listCapabilityGaps: (opts?: {
    status?: CapabilityGapStatus
    limit?: number
  }): Promise<CapabilityGap[]> => ipcRenderer.invoke('capabilityGaps:list', opts),
  recordCapabilityGap: (input: {
    task: string
    capabilities: string[]
    reason: string
    relatedToolIds?: string[]
    suggestedAccess?: AgentAccessKind
  }): Promise<{ action: 'created' | 'updated'; gap: CapabilityGap }> =>
    ipcRenderer.invoke('capabilityGaps:record', input),
  updateCapabilityGapStatus: (
    id: string,
    status: CapabilityGapStatus,
  ): Promise<CapabilityGap> =>
    ipcRenderer.invoke('capabilityGaps:updateStatus', id, status),
  updateCapabilityGap: (
    id: string,
    patch: { status?: CapabilityGapStatus; relatedToolIds?: string[] },
  ): Promise<CapabilityGap> =>
    ipcRenderer.invoke('capabilityGaps:update', id, patch),
  deleteCapabilityGap: (id: string): Promise<void> =>
    ipcRenderer.invoke('capabilityGaps:delete', id),
  /** Paste-ready build brief for a capability gap (markdown). */
  getGapBrief: (id: string): Promise<string> =>
    ipcRenderer.invoke('capabilityGaps:brief', id),
  listGapSuggestions: (): Promise<GapResolveSuggestion[]> =>
    ipcRenderer.invoke('capabilityGaps:suggestions'),
  dismissGapSuggestion: (id: string, toolId: string): Promise<CapabilityGap> =>
    ipcRenderer.invoke('capabilityGaps:dismissSuggestion', id, toolId),

  getRuntimeStates: (): Promise<ToolRuntimeState[]> =>
    ipcRenderer.invoke('process:states'),
  startTool: (id: string, options?: StartOptions): Promise<ToolRuntimeState> =>
    ipcRenderer.invoke('process:start', id, options),
  stopTool: (id: string): Promise<ToolRuntimeState> =>
    ipcRenderer.invoke('process:stop', id),
  restartTool: (id: string): Promise<ToolRuntimeState> =>
    ipcRenderer.invoke('process:restart', id),
  getLogs: (id: string): Promise<LogLine[]> => ipcRenderer.invoke('process:logs', id),
  /** Paste-ready failure report (secrets already masked). */
  getErrorReport: (id: string): Promise<string | null> =>
    ipcRenderer.invoke('process:errorReport', id),
  listReceipts: (opts?: {
    toolId?: string
    limit?: number
    outcomes?: ReceiptOutcome[]
    query?: string
  }): Promise<RunReceipt[]> => ipcRenderer.invoke('receipts:list', opts),
  clearReceipts: (opts?: { toolId?: string }): Promise<{ removed: number }> =>
    ipcRenderer.invoke('receipts:clear', opts),
  exportReceipts: (opts?: {
    format?: 'json' | 'csv'
    toolId?: string
    outcomes?: ReceiptOutcome[]
    query?: string
  }): Promise<{ saved: boolean; path?: string }> =>
    ipcRenderer.invoke('receipts:export', opts),
  /** A process outside this window (MCP server) changed a shared data file. */
  onExternalDataChange: (cb: (filename: string) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, filename: string) => cb(filename)
    ipcRenderer.on('data:external-change', listener)
    return () => ipcRenderer.removeListener('data:external-change', listener)
  },
  onReceiptUpdate: (cb: (receipt: RunReceipt) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, receipt: RunReceipt) => cb(receipt)
    ipcRenderer.on('receipts:update', listener)
    return () => ipcRenderer.removeListener('receipts:update', listener)
  },
  openUrl: (url: string): Promise<void> => ipcRenderer.invoke('system:openUrl', url),
  openPath: (targetPath: string): Promise<void> =>
    ipcRenderer.invoke('system:openPath', targetPath),
  openEditor: (projectPath: string): Promise<void> =>
    ipcRenderer.invoke('system:openEditor', projectPath),
  openTerminal: (projectPath: string): Promise<void> =>
    ipcRenderer.invoke('system:openTerminal', projectPath),
  getMcpServerPath: (): Promise<string> => ipcRenderer.invoke('system:mcpServerPath'),
  getClaudeDesktopStatus: (): Promise<ClaudeDesktopStatus> =>
    ipcRenderer.invoke('claude:status'),
  connectClaudeDesktop: (): Promise<ClaudeConnectResult> =>
    ipcRenderer.invoke('claude:connect'),
  disconnectClaudeDesktop: (): Promise<ClaudeConnectResult> =>
    ipcRenderer.invoke('claude:disconnect'),
  openClaudeDesktop: (): Promise<void> => ipcRenderer.invoke('claude:openApp'),
  detectMcpClients: (): Promise<McpClientDetection[]> =>
    ipcRenderer.invoke('mcpClients:detect'),
  getClaudeCodeMcpStatus: (): Promise<ClaudeCodeMcpStatus> =>
    ipcRenderer.invoke('claudeCode:status'),
  connectClaudeCodeMcp: (): Promise<ClaudeCodeConnectResult> =>
    ipcRenderer.invoke('claudeCode:connect'),
  disconnectClaudeCodeMcp: (): Promise<ClaudeCodeConnectResult> =>
    ipcRenderer.invoke('claudeCode:disconnect'),
  getCursorMcpStatus: (): Promise<CursorMcpStatus> =>
    ipcRenderer.invoke('cursor:status'),
  connectCursorMcp: (): Promise<CursorConnectResult> =>
    ipcRenderer.invoke('cursor:connect'),
  disconnectCursorMcp: (): Promise<CursorConnectResult> =>
    ipcRenderer.invoke('cursor:disconnect'),
  openCursorApp: (): Promise<void> => ipcRenderer.invoke('cursor:openApp'),
  getCodexMcpStatus: (): Promise<CodexMcpStatus> =>
    ipcRenderer.invoke('codex:status'),
  connectCodexMcp: (): Promise<CodexConnectResult> =>
    ipcRenderer.invoke('codex:connect'),
  disconnectCodexMcp: (): Promise<CodexConnectResult> =>
    ipcRenderer.invoke('codex:disconnect'),
  openCodexApp: (): Promise<void> => ipcRenderer.invoke('codex:openApp'),
  onRuntimeUpdate: (cb: (state: ToolRuntimeState) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, state: ToolRuntimeState) => cb(state)
    ipcRenderer.on('process:update', listener)
    return () => ipcRenderer.removeListener('process:update', listener)
  },
  onLogLine: (cb: (line: LogLine) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, line: LogLine) => cb(line)
    ipcRenderer.on('logs:line', listener)
    return () => ipcRenderer.removeListener('logs:line', listener)
  },
  /** Menu / shortcut navigation from the main process. */
  onNavigate: (cb: (path: string) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, route: string) => cb(route)
    ipcRenderer.on('app:navigate', listener)
    return () => ipcRenderer.removeListener('app:navigate', listener)
  },
  onFocusSearch: (cb: () => void): (() => void) => {
    const listener = () => cb()
    ipcRenderer.on('app:focus-search', listener)
    return () => ipcRenderer.removeListener('app:focus-search', listener)
  },
  /** Menu ⌘K — renderer toggles the Quick Open palette. */
  onQuickOpen: (cb: () => void): (() => void) => {
    const listener = () => cb()
    ipcRenderer.on('app:quick-open', listener)
    return () => ipcRenderer.removeListener('app:quick-open', listener)
  },
  /** Global hotkey registration result (conflict / success). */
  onShortcutStatus: (cb: (status: ShortcutStatus) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, status: ShortcutStatus) => cb(status)
    ipcRenderer.on('app:shortcut-status', listener)
    return () => ipcRenderer.removeListener('app:shortcut-status', listener)
  },
  /** A downloaded update is ready — renderer shows the restart banner. */
  onUpdateReady: (cb: (info: { version: string }) => void): (() => void) => {
    const listener = (_event: IpcRendererEvent, info: { version: string }) => cb(info)
    ipcRenderer.on('app:update-ready', listener)
    return () => ipcRenderer.removeListener('app:update-ready', listener)
  },
  /** Stop tools, quit, install the downloaded update, and relaunch. */
  installUpdate: (): Promise<void> => ipcRenderer.invoke('app:installUpdate'),
}

contextBridge.exposeInMainWorld('shelf', api)
