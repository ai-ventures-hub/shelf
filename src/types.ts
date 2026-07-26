/** Shared tool and process types used by renderer and main process contracts. */

export type ToolStatus = 'stopped' | 'starting' | 'running' | 'error'
export type AppearanceMode = 'system' | 'light' | 'dark'
export type ViewMode = 'grid' | 'list'
export type SortMode = 'name' | 'recent' | 'status'
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
  state: CapabilityReadinessState
  summary: string
  reasons: string[]
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
}

export interface Collection {
  id: string
  name: string
  description?: string
  toolIds: string[]
  createdAt: string
  updatedAt: string
}

export interface ToolRuntimeState {
  toolId: string
  status: ToolStatus
  pid?: number
  startedAt?: string
  message?: string
  exitCode?: number | null
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
  sidebarWidth: number
  sidebarCollapsed: boolean
  defaultIconLucide?: string
  defaultIconColor: string
  defaultIconBackground: string
  menuBarEnabled: boolean
  closeToMenuBar: boolean
  globalShortcutEnabled: boolean
  globalShortcut: string
  windowBounds?: {
    width: number
    height: number
    x?: number
    y?: number
  }
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
  confidence: 'high' | 'medium' | 'low'
  signals: string[]
}

/** Preload bridge API exposed on window.shelf */
export interface ShelfApi {
  listTools: () => Promise<Tool[]>
  saveTool: (tool: Tool) => Promise<Tool>
  deleteTool: (id: string) => Promise<void>
  pickFolder: () => Promise<string | null>
  inspectProject: (projectPath: string) => Promise<ProjectImportSuggestion>
  pickIcon: () => Promise<string | null>
  getIconDataUrl: (iconPath: string) => Promise<string | null>
  listCollections: () => Promise<Collection[]>
  saveCollection: (collection: Collection) => Promise<Collection>
  deleteCollection: (id: string) => Promise<void>
  getPrefs: () => Promise<UiPrefs>
  updatePrefs: (
    patch: Partial<UiPrefs>,
  ) => Promise<{ prefs: UiPrefs; shortcutStatus: ShortcutStatus }>
  getShortcutStatus: () => Promise<ShortcutStatus>
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
  deleteCapabilityGap: (id: string) => Promise<void>
  getRuntimeStates: () => Promise<ToolRuntimeState[]>
  startTool: (id: string) => Promise<ToolRuntimeState>
  stopTool: (id: string) => Promise<ToolRuntimeState>
  restartTool: (id: string) => Promise<ToolRuntimeState>
  getLogs: (id: string) => Promise<LogLine[]>
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
  openUrl: (url: string) => Promise<void>
  openPath: (targetPath: string) => Promise<void>
  openEditor: (projectPath: string) => Promise<void>
  openTerminal: (projectPath: string) => Promise<void>
  getMcpServerPath: () => Promise<string>
  getClaudeDesktopStatus: () => Promise<ClaudeDesktopStatus>
  connectClaudeDesktop: () => Promise<ClaudeConnectResult>
  disconnectClaudeDesktop: () => Promise<ClaudeConnectResult>
  openClaudeDesktop: () => Promise<void>
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
}

declare global {
  interface Window {
    shelf: ShelfApi
  }
}

export {}
