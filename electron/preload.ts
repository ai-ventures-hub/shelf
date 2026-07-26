import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type {
  ClaudeConnectResult,
  ClaudeDesktopStatus,
  AgentAccessKind,
  CapabilityGap,
  CapabilityGapStatus,
  CodexConnectResult,
  CodexMcpStatus,
  Collection,
  CursorConnectResult,
  CursorMcpStatus,
  DesignMdResult,
  LogLine,
  ProjectImportSuggestion,
  ReceiptOutcome,
  RunReceipt,
  ShortcutStatus,
  Tool,
  ToolReadiness,
  ToolRuntimeState,
  UiPrefs,
} from './types'

/**
 * Narrow, typed bridge for the renderer.
 * No Node APIs are exposed directly — all file/process work goes through IPC.
 */
const api = {
  listTools: (): Promise<Tool[]> => ipcRenderer.invoke('tools:list'),
  saveTool: (tool: Tool): Promise<Tool> => ipcRenderer.invoke('tools:save', tool),
  deleteTool: (id: string): Promise<void> => ipcRenderer.invoke('tools:delete', id),
  pickFolder: (): Promise<string | null> => ipcRenderer.invoke('tools:pickFolder'),
  inspectProject: (projectPath: string): Promise<ProjectImportSuggestion> =>
    ipcRenderer.invoke('tools:inspectProject', projectPath),
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

  getPrefs: (): Promise<UiPrefs> => ipcRenderer.invoke('prefs:get'),
  updatePrefs: (
    patch: Partial<UiPrefs>,
  ): Promise<{ prefs: UiPrefs; shortcutStatus: ShortcutStatus }> =>
    ipcRenderer.invoke('prefs:update', patch),
  getShortcutStatus: (): Promise<ShortcutStatus> =>
    ipcRenderer.invoke('desktop:shortcutStatus'),

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
  deleteCapabilityGap: (id: string): Promise<void> =>
    ipcRenderer.invoke('capabilityGaps:delete', id),

  getRuntimeStates: (): Promise<ToolRuntimeState[]> =>
    ipcRenderer.invoke('process:states'),
  startTool: (id: string): Promise<ToolRuntimeState> =>
    ipcRenderer.invoke('process:start', id),
  stopTool: (id: string): Promise<ToolRuntimeState> =>
    ipcRenderer.invoke('process:stop', id),
  restartTool: (id: string): Promise<ToolRuntimeState> =>
    ipcRenderer.invoke('process:restart', id),
  getLogs: (id: string): Promise<LogLine[]> => ipcRenderer.invoke('process:logs', id),
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
}

contextBridge.exposeInMainWorld('shelf', api)
