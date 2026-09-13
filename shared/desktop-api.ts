/// <reference lib="dom" />
/** The desktop bridge contract, checked by both preload and renderer. */
import type {
  ToolEnvironment,
  AppUpdateState,
  AgentAccessKind,
  ApplyUpdateInput,
  ApplyUpdateResult,
  CapabilityGap,
  CapabilityGapStatus,
  CatalogPublishResult,
  CatalogSyncView,
  ClaudeCodeConnectResult,
  ClaudeCodeMcpStatus,
  ClaudeConnectResult,
  ClaudeDesktopStatus,
  CodexConnectResult,
  CodexMcpStatus,
  Collection,
  CollectionActionResult,
  ConfirmShareInput,
  ConfirmShareResult,
  CursorConnectResult,
  CursorMcpStatus,
  DesignAsset,
  DesignAssetKind,
  DesignMdResult,
  DesignProfile,
  ExtractedTokens,
  GapResolveSuggestion,
  LogLine,
  McpClientDetection,
  OnboardingSubmissionInput,
  ProjectImportSuggestion,
  ReceiptOutcome,
  RegisterProjectOptions,
  RegisterProjectResult,
  RunReceipt,
  SaveDesignProfileInput,
  ShareFailure,
  ShareSource,
  ShortcutStatus,
  StagedShareView,
  StartOptions,
  TeamCatalog,
  Tool,
  ToolHealth,
  ToolReadiness,
  ToolRuntimeState,
  UiPrefs,
  UpdateCheck,
} from './contracts'

export interface ShelfApi {
  inspectToolEnvironment: (id: string) => Promise<ToolEnvironment>
  getAppUpdateState: () => Promise<AppUpdateState>
  checkAppUpdates: () => Promise<AppUpdateState>
  onAppUpdateState: (cb: (state: AppUpdateState) => void) => () => void
  getPendingImports: () => Promise<{ id: string; name: string; destination: string }[]>
  resumeImport: (id: string) => Promise<StagedShareView>
  getLibraryRecovery: () => Promise<string | null>
  listTools: () => Promise<Tool[]>
  getToolHealth: () => Promise<ToolHealth[]>
  saveTool: (tool: Tool) => Promise<Tool>
  deleteTool: (id: string) => Promise<void>
  pickFolder: () => Promise<string | null>
  inspectProject: (projectPath: string) => Promise<ProjectImportSuggestion>
  registerProject: (
    projectPath: string,
    options?: RegisterProjectOptions,
  ) => Promise<RegisterProjectResult>
  getPathForFile: (file: File) => string
  pickIcon: () => Promise<string | null>
  getIconDataUrl: (iconPath: string) => Promise<string | null>
  listCollections: () => Promise<Collection[]>
  saveCollection: (collection: Collection) => Promise<Collection>
  deleteCollection: (id: string) => Promise<void>
  listDesignProfiles: () => Promise<DesignProfile[]>
  saveDesignProfile: (input: SaveDesignProfileInput) => Promise<DesignProfile>
  deleteDesignProfile: (id: string) => Promise<void>
  setDefaultDesignProfile: (id: string) => Promise<DesignProfile>
  pickDesignAsset: (profileId: string, kind: DesignAssetKind) => Promise<DesignAsset | null>
  importDesignAsset: (
    profileId: string,
    sourcePath: string,
    kind: DesignAssetKind,
  ) => Promise<DesignAsset>
  removeDesignAsset: (profileId: string, assetPath: string) => Promise<void>
  designBrief: (id: string) => Promise<string | null>
  designAssetDataUrl: (assetPath: string) => Promise<string | null>
  extractDesignTokens: (projectPath: string) => Promise<ExtractedTokens>
  startCollection: (
    id: string,
    options?: StartOptions,
  ) => Promise<CollectionActionResult>
  stopCollection: (id: string) => Promise<CollectionActionResult>
  exportToolManifest: (id: string) => Promise<{
    manifestPath: string
    remote?: string
    link?: string
    linkNote?: string
    copied: boolean
    envKeys: string[]
  }>
  exportToolBundle: (id: string) => Promise<{ saved: boolean; path?: string; bytes?: number }>
  stageSharedTool: (
    source: ShareSource,
  ) => Promise<{ ok: true; stage: StagedShareView } | ShareFailure>
  pickShareBundle: () => Promise<string | null>
  pickShareDestination: (
    stageId: string,
  ) => Promise<{ ok: true; destination: string | null } | ShareFailure>
  confirmSharedTool: (
    stageId: string,
    input: ConfirmShareInput,
  ) => Promise<{ ok: true; result: ConfirmShareResult } | ShareFailure>
  discardSharedTool: (stageId: string) => Promise<void>
  checkToolUpdates: (id: string) => Promise<UpdateCheck>
  applyToolUpdate: (id: string, input: ApplyUpdateInput) => Promise<ApplyUpdateResult>
  prepareCatalogStarter: (name: string, toolIds: string[]) => Promise<{ content: string; warnings: string[] }>
  exportCatalogStarter: (content: string) => Promise<{ saved: boolean; path?: string }>
  listTeamCatalogs: () => Promise<TeamCatalog[]>
  addTeamCatalog: (url: string) => Promise<CatalogSyncView | ShareFailure>
  refreshTeamCatalog: (id: string) => Promise<CatalogSyncView | ShareFailure>
  removeTeamCatalog: (id: string) => Promise<boolean>
  publishToTeamCatalog: (
    catalogId: string,
    toolId: string,
  ) => Promise<{ ok: true; result: CatalogPublishResult; catalog?: TeamCatalog } | ShareFailure>
  onAddShared: (cb: (info: { repo: string }) => void) => () => void
  getPrefs: () => Promise<UiPrefs>
  updatePrefs: (
    patch: Partial<UiPrefs>,
  ) => Promise<{ prefs: UiPrefs; shortcutStatus: ShortcutStatus }>
  getShortcutStatus: () => Promise<ShortcutStatus>
  submitOnboarding: (input: OnboardingSubmissionInput) => Promise<{ appVersion: string }>
  getDesignMd: (opts: { id?: string; projectPath?: string }) => Promise<DesignMdResult>
  checkToolReadiness: (id: string) => Promise<ToolReadiness>
  listCapabilityGaps: (opts?: {
    status?: CapabilityGapStatus
    limit?: number
  }) => Promise<CapabilityGap[]>
  recordCapabilityGap: (input: {
    task: string
    capabilities: string[]
    reason: string
    relatedToolIds?: string[]
    suggestedAccess?: AgentAccessKind
  }) => Promise<{ action: 'created' | 'updated'; gap: CapabilityGap }>
  updateCapabilityGapStatus: (
    id: string,
    status: CapabilityGapStatus,
  ) => Promise<CapabilityGap>
  updateCapabilityGap: (
    id: string,
    patch: { status?: CapabilityGapStatus; relatedToolIds?: string[] },
  ) => Promise<CapabilityGap>
  deleteCapabilityGap: (id: string) => Promise<void>
  getGapBrief: (id: string) => Promise<string>
  listGapSuggestions: () => Promise<GapResolveSuggestion[]>
  dismissGapSuggestion: (id: string, toolId: string) => Promise<CapabilityGap>
  getRuntimeStates: () => Promise<ToolRuntimeState[]>
  startTool: (id: string, options?: StartOptions) => Promise<ToolRuntimeState>
  stopTool: (id: string) => Promise<ToolRuntimeState>
  restartTool: (id: string) => Promise<ToolRuntimeState>
  getLogs: (id: string, runId?: string) => Promise<LogLine[]>
  getErrorReport: (id: string, runId?: string) => Promise<string | null>
  listReceipts: (opts?: {
    toolId?: string
    limit?: number
    outcomes?: ReceiptOutcome[]
    query?: string
  }) => Promise<RunReceipt[]>
  clearReceipts: (opts?: { toolId?: string }) => Promise<{ removed: number }>
  exportReceipts: (opts?: {
    format?: 'json' | 'csv'
    toolId?: string
    outcomes?: ReceiptOutcome[]
    query?: string
  }) => Promise<{ saved: boolean; path?: string }>
  onReceiptUpdate: (cb: (receipt: RunReceipt) => void) => () => void
  onExternalDataChange: (cb: (filename: string) => void) => () => void
  openUrl: (url: string) => Promise<void>
  openPath: (targetPath: string) => Promise<void>
  openEditor: (projectPath: string) => Promise<void>
  openTerminal: (projectPath: string) => Promise<void>
  getMcpServerPath: () => Promise<string>
  getClaudeDesktopStatus: () => Promise<ClaudeDesktopStatus>
  connectClaudeDesktop: () => Promise<ClaudeConnectResult>
  disconnectClaudeDesktop: () => Promise<ClaudeConnectResult>
  openClaudeDesktop: () => Promise<void>
  detectMcpClients: () => Promise<McpClientDetection[]>
  getClaudeCodeMcpStatus: () => Promise<ClaudeCodeMcpStatus>
  connectClaudeCodeMcp: () => Promise<ClaudeCodeConnectResult>
  disconnectClaudeCodeMcp: () => Promise<ClaudeCodeConnectResult>
  getCursorMcpStatus: () => Promise<CursorMcpStatus>
  connectCursorMcp: () => Promise<CursorConnectResult>
  disconnectCursorMcp: () => Promise<CursorConnectResult>
  openCursorApp: () => Promise<void>
  getCodexMcpStatus: () => Promise<CodexMcpStatus>
  connectCodexMcp: () => Promise<CodexConnectResult>
  disconnectCodexMcp: () => Promise<CodexConnectResult>
  openCodexApp: () => Promise<void>
  onRuntimeUpdate: (cb: (state: ToolRuntimeState) => void) => () => void
  onLogLine: (cb: (line: LogLine) => void) => () => void
  onNavigate: (cb: (path: string) => void) => () => void
  onFocusSearch: (cb: () => void) => () => void
  onQuickOpen: (cb: () => void) => () => void
  onShortcutStatus: (cb: (status: ShortcutStatus) => void) => () => void
  onUpdateReady: (cb: (info: { version: string }) => void) => () => void
  installUpdate: () => Promise<void>
}
