/** Shared tool and process types used by renderer and main process contracts. */

export type ToolStatus = 'stopped' | 'starting' | 'running' | 'error'
export type AppearanceMode = 'system' | 'light' | 'dark'
export type ViewMode = 'grid' | 'list'
export type SortMode = 'name' | 'recent' | 'status'
/** Presentation mode: 'simple' hides agent-integration surfaces. */
export type UiMode = 'simple' | 'developer'
export type AgentAccessKind = 'cli' | 'mcp' | 'http-api'
export type McpTransport = 'stdio' | 'streamable-http'
export type CapabilityReadinessState =
  | 'ready'
  | 'needs_setup'
  | 'manual_only'
  | 'unavailable'

export interface AgentAccess {
  id: string
  kind: AgentAccessKind
  entrypoint: string
  transport?: McpTransport
  setupRequired: boolean
  notes?: string
}

export interface ToolReadiness {
  /** Describes the tool's OWN agent interface — never whether Shelf can launch it. */
  state: CapabilityReadinessState
  summary: string
  reasons: string[]
  /** True unless the project folder is missing or the launch command is empty. */
  launchable: boolean
  /** Shelf MCP tools that work for this tool regardless of readiness state. */
  shelfActions: string[]
  /** What `state` is about: the tool's declared child interface. */
  childInterface: 'none' | 'declared' | 'incomplete' | 'needs_setup'
}

export interface Tool {
  id: string
  name: string
  description?: string
  /** Absolute path to a local icon image, or empty for brand mark fallback. */
  iconPath?: string
  /** Lucide PascalCase name; preferred over iconPath when set. */
  iconLucide?: string
  iconColor?: string
  iconBackground?: string
  tags: string[]
  capabilities: string[]
  agentAccess: AgentAccess[]
  favorite: boolean
  projectPath?: string
  launchCommand: string
  stopCommand?: string
  /** Local app URL opened after readiness, e.g. http://localhost:5173 */
  url?: string
  port?: number
  env?: Record<string, string>
  notes?: string
  lastLaunchedAt?: string
  createdAt: string
  updatedAt: string
  /** When capabilities last actually changed (drives resolve suggestions). */
  capabilitiesUpdatedAt?: string
}

export interface Collection {
  id: string
  name: string
  description?: string
  toolIds: string[]
  /** Design Engine binding (mirror of shared/types.ts). */
  designProfileId?: string
  createdAt: string
  updatedAt: string
}

/** DTCG-format leaf token (mirror of shared/types.ts). */
export interface DesignToken {
  $value: string | number
  $type?: string
  $description?: string
}

/** DTCG nested group; leaves carry $value (mirror of shared/types.ts). */
export interface DesignTokenGroup {
  [key: string]: DesignToken | DesignTokenGroup
}

export type DesignAssetKind = 'logo' | 'wordmark' | 'icon' | 'other'

/** Brand asset stored under the Shelf data root (mirror of shared/types.ts). */
export interface DesignAsset {
  kind: DesignAssetKind
  path: string
  mime: string
}

/** Editor upsert input (mirror of shared/design-profile-store.ts). */
export interface SaveDesignProfileInput {
  id?: string
  name: string
  isDefault?: boolean
  tokens?: DesignTokenGroup
  modes?: { light?: DesignTokenGroup; dark?: DesignTokenGroup }
  direction?: string
  assets?: DesignAsset[]
  /** Ownership marker — the main process stamps 'user' on every GUI save. */
  origin?: 'agent' | 'user'
  sourceNote?: string
}

/** Deterministic project token extraction (mirror of shared/design-extract.ts). */
export interface ExtractedTokens {
  tokens: DesignTokenGroup
  modes: { light: DesignTokenGroup; dark: DesignTokenGroup }
  counts: { color: number; typography: number; dimension: number; light: number; dark: number }
  sources: Array<{ file: string; declarations: number }>
  skipped: string[]
}

/** Design/brand profile from design-profiles.json (mirror of shared/types.ts). */
export interface DesignProfile {
  id: string
  name: string
  isDefault: boolean
  tokens: DesignTokenGroup
  modes: { light: DesignTokenGroup; dark: DesignTokenGroup }
  direction: string
  assets: DesignAsset[]
  /** 'agent' = MCP-created, still agent-owned; absent = user-owned. */
  origin?: 'agent'
  sourceNote?: string
  createdAt: string
  updatedAt: string
}

/** Structured launch/stop failure classes (mirror of shared/types.ts). */
export type LaunchErrorCode =
  | 'tool_not_found'
  | 'folder_missing'
  | 'no_launch_command'
  | 'deps_missing'
  | 'runtime_missing'
  | 'docker_not_running'
  | 'port_in_use'
  | 'port_reassign_failed'
  | 'bad_launch_command'
  | 'app_crashed'
  | 'port_timeout'
  | 'stop_refused_not_owner'

export type RemedyKind =
  | 'install_deps'
  | 'reassign_port'
  | 'open_docker'
  | 'repick_folder'
  | 'edit_command'
  | 'install_runtime'
  | 'copy_ai_report'

/** Who initiated a launch (mirror of shared/types.ts). */
export type LaunchOriginKind = 'gui' | 'tray' | 'mcp'

export interface LaunchOrigin {
  kind: LaunchOriginKind
  /** Self-reported MCP client name, e.g. "claude-code". */
  client?: string
}

export interface ToolRuntimeState {
  toolId: string
  status: ToolStatus
  pid?: number
  startedAt?: string
  message?: string
  exitCode?: number | null
  /** Present on coded failures (and timeout stops); absent on success paths. */
  code?: LaunchErrorCode
  remedy?: RemedyKind
  /** Live port once known (may differ from configured port after reassign/sniff). */
  port?: number
  /** 'local' = this Shelf process spawned it; 'external' = adopted (e.g. MCP). */
  origin?: 'local' | 'external'
  /** Provenance carried from the run receipt; absent for pre-0.8 receipts. */
  startedBy?: LaunchOrigin
}

export interface LogLine {
  toolId: string
  stream: 'stdout' | 'stderr' | 'system'
  text: string
  at: string
}

export interface UiPrefs {
  appearance: AppearanceMode
  viewMode: ViewMode
  sort: SortMode
  /** Presentation mode; existing prefs without the key resolve to 'developer'. */
  uiMode: UiMode
  sidebarWidth: number
  sidebarCollapsed: boolean
  defaultIconLucide?: string
  defaultIconColor: string
  defaultIconBackground: string
  menuBarEnabled: boolean
  closeToMenuBar: boolean
  /** Start Shelf automatically at macOS login (packaged builds only). */
  launchAtLogin: boolean
  globalShortcutEnabled: boolean
  globalShortcut: string
  windowBounds?: {
    width: number
    height: number
    x?: number
    y?: number
  }
  /** App version at which first-launch onboarding was completed or skipped. */
  onboardingCompletedVersion?: string
}

/** Renderer-side onboarding payload (main stamps version/platform/time). */
export interface OnboardingSubmissionInput {
  name?: string
  email?: string
  answers: {
    firstShelve?: string
    persona?: string
    heardFrom?: string
    agents: string[]
  }
  /** True when the contact screen was skipped or left empty. */
  skippedContact: boolean
}

/** Result of registering the macOS global show/hide hotkey. */
export interface ShortcutStatus {
  ok: boolean
  accelerator: string
  error?: string
}

/** One-click Claude Desktop MCP connection status. */
export interface ClaudeDesktopStatus {
  connected: boolean
  matches: boolean
  claudeLoaded: boolean
  configPath: string
  configExists: boolean
  serverPath: string
  serverOk: boolean
  nodeCommand: string
  nodeOk: boolean
  nodePath?: string
  message: string
}

export interface ClaudeConnectResult {
  status: ClaudeDesktopStatus
  backupPath?: string
}

/** Installed-client probe result (mirror of shared/mcp-client-detect.ts). */
export type DetectableMcpClient = 'claude' | 'claude-code' | 'cursor' | 'codex'

export interface McpClientDetection {
  kind: DetectableMcpClient
  installed: boolean
  evidence?: string
}

/** One-click Claude Code MCP connection status (~/.claude.json, user scope). */
export interface ClaudeCodeMcpStatus {
  connected: boolean
  matches: boolean
  configPath: string
  configExists: boolean
  serverPath: string
  serverOk: boolean
  nodeCommand: string
  nodeOk: boolean
  nodePath?: string
  message: string
}

export interface ClaudeCodeConnectResult {
  status: ClaudeCodeMcpStatus
  backupPath?: string
}

/** One-click Cursor MCP connection status (~/.cursor/mcp.json). */
export interface CursorMcpStatus {
  connected: boolean
  matches: boolean
  configPath: string
  configExists: boolean
  serverPath: string
  serverOk: boolean
  nodeCommand: string
  nodeOk: boolean
  nodePath?: string
  message: string
}

export interface CursorConnectResult {
  status: CursorMcpStatus
  backupPath?: string
}

/** One-click Codex MCP connection status (~/.codex/config.toml). */
export interface CodexMcpStatus {
  connected: boolean
  matches: boolean
  configPath: string
  configExists: boolean
  serverPath: string
  serverOk: boolean
  nodeCommand: string
  nodeOk: boolean
  nodePath?: string
  message: string
}

export interface CodexConnectResult {
  status: CodexMcpStatus
  backupPath?: string
}

export interface DesignMdResult {
  found: boolean
  path?: string
  content?: string
  projectPath?: string
  toolId?: string
}

export type ReceiptOutcome =
  | 'starting'
  | 'running'
  | 'stopped'
  | 'error'
  | 'failed'
  | 'interrupted'

export interface RunReceipt {
  id: string
  toolId: string
  toolName: string
  launchCommand: string
  port?: number
  url?: string
  pid?: number
  startedAt: string
  endedAt?: string
  durationMs?: number
  outcome: ReceiptOutcome
  exitCode?: number | null
  message?: string
  /** Who initiated the launch; absent on receipts written before 0.8. */
  startedBy?: LaunchOrigin
}

export type CapabilityGapStatus = 'open' | 'planned' | 'resolved' | 'dismissed'

export interface CapabilityGapExample {
  task: string
  at: string
}

export interface CapabilityGap {
  id: string
  capabilities: string[]
  task: string
  reason: string
  relatedToolIds: string[]
  suggestedAccess?: AgentAccessKind
  status: CapabilityGapStatus
  occurrenceCount: number
  examples: CapabilityGapExample[]
  createdAt: string
  updatedAt: string
  lastRequestedAt: string
  /** Tools the user declined as resolve suggestions. */
  suggestionDismissedToolIds?: string[]
}

/** Suggest-only gap resolution match (mirror of shared/gap-suggest.ts). */
export interface GapResolveSuggestion {
  gapId: string
  toolId: string
  toolName: string
  matched: string[]
  total: number
}

export interface LaunchAlternative {
  command: string
  label: string
}

export interface ProjectImportSuggestion {
  projectPath: string
  name?: string
  description?: string
  launchCommand?: string
  launchAlternatives: LaunchAlternative[]
  port?: number
  portPreferred?: number
  portFree?: boolean
  url?: string
  tags: string[]
  designMd: { found: boolean; path?: string }
  notesHint?: string
  /** Detected agent interfaces the project provides (already normalized). */
  agentAccess: AgentAccess[]
  confidence: 'high' | 'medium' | 'low'
  signals: string[]
}

/** One-shot registration (mirror of shared/register-project.ts). */
export type RegisterOutcome =
  | 'launched'
  | 'saved'
  | 'needs_setup'
  | 'saved_needs_review'
  | 'saved_launch_failed'
  | 'invalid_folder'
  | 'dry_run'

export type PortConflictPolicy = 'fail' | 'reassign'

export interface StartOptions {
  onPortConflict?: PortConflictPolicy
  origin?: LaunchOrigin
}

/** Per-tool result of a collection stack action (mirror of shared/collection-launch.ts). */
export type CollectionToolOutcome =
  | 'started'
  | 'already_running'
  | 'failed'
  | 'stopped'
  | 'not_running'
  | 'skipped_external'

export interface CollectionToolResult {
  toolId: string
  name: string
  outcome: CollectionToolOutcome
  state?: ToolRuntimeState
}

export interface CollectionActionResult {
  collectionId: string
  name: string
  results: CollectionToolResult[]
}

export interface BootstrapStep {
  command: string
  label: string
}

export interface BootstrapResult {
  ok: boolean
  exitCode: number | null
  endedBy?: 'timeout' | 'cancelled'
}

export interface PreflightIssue {
  code: LaunchErrorCode
  message: string
}

export interface RegisterProjectOptions {
  autoLaunch?: boolean
  onPortConflict?: PortConflictPolicy
  forceReview?: boolean
  runSetup?: boolean
  dryRun?: boolean
}

export interface RegisterProjectResult {
  outcome: RegisterOutcome
  tool?: Tool
  state?: ToolRuntimeState
  suggestion?: ProjectImportSuggestion
  autoRunnable: boolean
  autoRunReason: string
  setupNeeds: BootstrapStep[]
  bootstrap?: { step: BootstrapStep; result: BootstrapResult }[]
  issues: PreflightIssue[]
  created: boolean
}

/** Preload bridge API exposed on window.shelf */
export interface ShelfApi {
  listTools: () => Promise<Tool[]>
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
  getLogs: (id: string) => Promise<LogLine[]>
  getErrorReport: (id: string) => Promise<string | null>
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

declare global {
  interface Window {
    shelf: ShelfApi
  }
}

export {}
