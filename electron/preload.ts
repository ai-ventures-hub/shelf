import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import type { ShelfApi } from '../shared/desktop-api'
import type {
  IpcArgs,
  IpcEventChannel,
  IpcEventMap,
  IpcInvokeChannel,
  IpcResult,
} from '../shared/ipc-channels'

/**
 * Narrow, typed bridge for the renderer.
 * No Node APIs are exposed directly — all file/process work goes through IPC.
 *
 * Both helpers are typed from shared/ipc-channels.ts, the same map main's
 * handlers register against, so a channel name, argument list, or result
 * that disagrees with the renderer contract fails `npm run typecheck`.
 */
function invoke<K extends IpcInvokeChannel>(channel: K, ...args: IpcArgs<K>): Promise<IpcResult<K>> {
  return ipcRenderer.invoke(channel, ...args)
}

function on<K extends IpcEventChannel>(
  channel: K,
  cb: (...args: IpcEventMap[K]) => void,
): () => void {
  const listener = (_event: IpcRendererEvent, ...args: unknown[]) => cb(...(args as IpcEventMap[K]))
  ipcRenderer.on(channel, listener)
  return () => { ipcRenderer.removeListener(channel, listener) }
}

const api = {
  getVerificationActivity: () => invoke('verification:activity'),
  getVerification: (id) => invoke('verification:get', id),
  saveVerification: (input) => invoke('verification:save', input),
  suggestVerification: (id) => invoke('verification:suggest', id),
  startVerification: (input) => invoke('verification:start', input),
  cancelVerification: (id, runId) => invoke('verification:cancel', id, runId),
  getVerificationLogs: (id, runId, stepId) => invoke('verification:logs', id, runId, stepId),
  prepareVerificationHandoff: (id, runId) => invoke('verification:handoff', id, runId),
  onVerificationUpdate: (cb) => on('verification:update', cb),
  getProjectMemory: (id) => invoke('context:getMemory', id),
  saveProjectMemory: (input) => invoke('context:saveMemory', input),
  prepareProjectHandoff: (id, options) => invoke('context:handoff', id, options),
  inspectToolEnvironment: (id) => invoke('tools:environment', id),
  getAppUpdateState: () => invoke('app:updateState'),
  checkAppUpdates: () => invoke('app:checkUpdates'),
  onAppUpdateState: (cb) => on('app:update-state', cb),
  getPendingImports: () => invoke('share:pendingImports'),
  resumeImport: (id) => invoke('share:resumeImport', id),
  getLibraryRecovery: () => invoke('tools:recovery'),
  listTools: () => invoke('tools:list'),
  /** Launchability snapshot for every tool — one batched port scan. */
  getToolHealth: () => invoke('tools:health'),
  saveTool: (tool) => invoke('tools:save', tool),
  deleteTool: (id) => invoke('tools:delete', id),
  pickFolder: () => invoke('tools:pickFolder'),
  inspectProject: (projectPath) => invoke('tools:inspectProject', projectPath),
  /** One-shot register: inspect → save → (consented) setup → launch. */
  registerProject: (projectPath, options) => invoke('tools:registerProject', projectPath, options),
  /** Absolute path for a dropped File (drag-and-drop folder support). */
  getPathForFile: (file) => webUtils.getPathForFile(file),
  pickIcon: () => invoke('tools:pickIcon'),
  /** Read a local icon file and return a data URL safe for <img src>. */
  getIconDataUrl: (iconPath) => invoke('tools:iconDataUrl', iconPath),

  getActivityBoard: () => invoke('activity:board'),
  listToolDrafts: () => invoke('drafts:list'),
  acceptToolDraft: (id, expectedUpdatedAt) => invoke('drafts:accept', id, expectedUpdatedAt),
  rejectToolDraft: (id) => invoke('drafts:reject', id),
  prepareToolStarter: () => invoke('starter:prepare'),
  createToolFromIdea: (input) => invoke('starter:create', input),
  chooseToolsFolder: () => invoke('starter:chooseFolder'),
  openToolInAgent: (toolId, agent) => invoke('starter:openAgent', toolId, agent),
  listCollections: () => invoke('collections:list'),
  saveCollection: (collection) => invoke('collections:save', collection),
  deleteCollection: (id) => invoke('collections:delete', id),
  /** Launch every stopped member of a collection ("Start stack"). */
  startCollection: (id, options) => invoke('collections:start', id, options),
  /** Stop every running member Shelf owns ("Stop stack"). */
  stopCollection: (id) => invoke('collections:stop', id),
  /** Design Engine profiles — the GUI is the only write surface (agents read over MCP). */
  listDesignProfiles: () => invoke('designProfiles:list'),
  saveDesignProfile: (input) => invoke('designProfiles:save', input),
  deleteDesignProfile: (id) => invoke('designProfiles:delete', id),
  setDefaultDesignProfile: (id) => invoke('designProfiles:setDefault', id),
  /** Native file picker → copy into brand-assets; null when canceled. */
  pickDesignAsset: (profileId, kind) => invoke('designProfiles:pickAsset', profileId, kind),
  /** Import a known path (drag-and-drop) into brand-assets. */
  importDesignAsset: (profileId, sourcePath, kind) =>
    invoke('designProfiles:importAsset', profileId, sourcePath, kind),
  removeDesignAsset: (profileId, assetPath) => invoke('designProfiles:removeAsset', profileId, assetPath),
  /** Paste-ready markdown brand brief (secrets masked); null for unknown ids. */
  designBrief: (id) => invoke('designProfiles:brief', id),
  /** Preview data-url for a brand asset; null for non-image assets. */
  designAssetDataUrl: (assetPath) => invoke('designProfiles:assetDataUrl', assetPath),
  /** Deterministic token extraction from a project folder (Phase 3 assist). */
  extractDesignTokens: (projectPath) => invoke('designProfiles:extractTokens', projectPath),

  /** Tool Sharing (1.2) — send side. Writes shelf.json, copies the link when a remote exists. */
  exportToolManifest: (id) => invoke('share:exportManifest', id),
  exportToolBundle: (id) => invoke('share:exportBundle', id),
  /** Receive: fetch into scratch and describe for the consent sheet (runs nothing). */
  stageSharedTool: (source) => invoke('share:stage', source),
  pickShareBundle: () => invoke('share:pickBundle'),
  pickShareDestination: (stageId) => invoke('share:pickDestination', stageId),
  /** The approval: move, save, consented setup, launch. */
  confirmSharedTool: (stageId, input) => invoke('share:confirm', stageId, input),
  discardSharedTool: (stageId) => invoke('share:discard', stageId),
  checkToolUpdates: (id) => invoke('share:checkUpdates', id),
  applyToolUpdate: (id, input) => invoke('share:applyUpdate', id, input),
  /** Team Tools catalogs (1.4): subscribe, refresh, publish an entry. */
  prepareCatalogStarter: (name, toolIds) => invoke('catalog:prepareStarter', name, toolIds),
  exportCatalogStarter: (content) => invoke('catalog:exportStarter', content),
  listTeamCatalogs: () => invoke('catalog:list'),
  addTeamCatalog: (url) => invoke('catalog:add', url),
  refreshTeamCatalog: (id) => invoke('catalog:refresh', id),
  removeTeamCatalog: (id) => invoke('catalog:remove', id),
  publishToTeamCatalog: (catalogId, toolId) => invoke('catalog:publish', catalogId, toolId),
  /** A shelf://add link arrived — renderer opens the Add-from-URL sheet. */
  onAddShared: (cb) => on('app:add-shared', cb),

  getPrefs: () => invoke('prefs:get'),
  updatePrefs: (patch) => invoke('prefs:update', patch),
  getShortcutStatus: () => invoke('desktop:shortcutStatus'),
  getCompanionStatus: () => invoke('companion:status'),
  beginCompanionPairing: () => invoke('companion:beginPairing'),
  cancelCompanionPairing: () => invoke('companion:cancelPairing'),
  revokeCompanionDevice: (id) => invoke('companion:revokeDevice', id),
  renameCompanionDevice: (id, name) => invoke('companion:renameDevice', id, name),
  exportCompanionCertificate: () => invoke('companion:exportCertificate'),
  replaceCompanionCertificate: () => invoke('companion:replaceCertificate'),
  onCompanionStatus: (cb) => on('companion:status', cb),
  submitOnboarding: (input) => invoke('onboarding:submit', input),

  getDesignMd: (opts) => invoke('designMd:get', opts),
  checkToolReadiness: (id) => invoke('tools:readiness', id),
  listCapabilityGaps: (opts) => invoke('capabilityGaps:list', opts),
  recordCapabilityGap: (input) => invoke('capabilityGaps:record', input),
  updateCapabilityGapStatus: (id, status) => invoke('capabilityGaps:updateStatus', id, status),
  updateCapabilityGap: (id, patch) => invoke('capabilityGaps:update', id, patch),
  deleteCapabilityGap: (id) => invoke('capabilityGaps:delete', id),
  /** Paste-ready build brief for a capability gap (markdown). */
  getGapBrief: (id) => invoke('capabilityGaps:brief', id),
  listGapSuggestions: () => invoke('capabilityGaps:suggestions'),
  dismissGapSuggestion: (id, toolId) => invoke('capabilityGaps:dismissSuggestion', id, toolId),

  getRuntimeStates: () => invoke('process:states'),
  startTool: (id, options) => invoke('process:start', id, options),
  stopTool: (id) => invoke('process:stop', id),
  restartTool: (id) => invoke('process:restart', id),
  getLogs: (id, runId) => invoke('process:logs', id, runId),
  /** Paste-ready failure report (secrets already masked). */
  getErrorReport: (id, runId) => invoke('process:errorReport', id, runId),
  listReceipts: (opts) => invoke('receipts:list', opts),
  clearReceipts: (opts) => invoke('receipts:clear', opts),
  exportReceipts: (opts) => invoke('receipts:export', opts),
  /** A process outside this window (MCP server) changed a shared data file. */
  onExternalDataChange: (cb) => on('data:external-change', cb),
  onReceiptUpdate: (cb) => on('receipts:update', cb),
  openUrl: (url) => invoke('system:openUrl', url),
  openPath: (targetPath) => invoke('system:openPath', targetPath),
  openEditor: (projectPath) => invoke('system:openEditor', projectPath),
  openTerminal: (projectPath) => invoke('system:openTerminal', projectPath),
  getMcpServerPath: () => invoke('system:mcpServerPath'),
  getClaudeDesktopStatus: () => invoke('claude:status'),
  connectClaudeDesktop: () => invoke('claude:connect'),
  disconnectClaudeDesktop: () => invoke('claude:disconnect'),
  openClaudeDesktop: () => invoke('claude:openApp'),
  detectMcpClients: () => invoke('mcpClients:detect'),
  getClaudeCodeMcpStatus: () => invoke('claudeCode:status'),
  connectClaudeCodeMcp: () => invoke('claudeCode:connect'),
  disconnectClaudeCodeMcp: () => invoke('claudeCode:disconnect'),
  getCursorMcpStatus: () => invoke('cursor:status'),
  connectCursorMcp: () => invoke('cursor:connect'),
  disconnectCursorMcp: () => invoke('cursor:disconnect'),
  openCursorApp: () => invoke('cursor:openApp'),
  getCodexMcpStatus: () => invoke('codex:status'),
  connectCodexMcp: () => invoke('codex:connect'),
  disconnectCodexMcp: () => invoke('codex:disconnect'),
  openCodexApp: () => invoke('codex:openApp'),
  onRuntimeUpdate: (cb) => on('process:update', cb),
  onLogLine: (cb) => on('logs:line', cb),
  /** Menu / shortcut navigation from the main process. */
  onNavigate: (cb) => on('app:navigate', cb),
  onFocusSearch: (cb) => on('app:focus-search', cb),
  /** Menu ⌘K — renderer toggles the Quick Open palette. */
  onQuickOpen: (cb) => on('app:quick-open', cb),
  onHistory: (cb) => on('app:history', cb),
  onAddFolder: (cb) => on('app:add-folder', cb),
  /** Global hotkey registration result (conflict / success). */
  onShortcutStatus: (cb) => on('app:shortcut-status', cb),
  /** A downloaded update is ready — renderer shows the restart banner. */
  onUpdateReady: (cb) => on('app:update-ready', cb),
  /** Stop tools, quit, install the downloaded update, and relaunch. */
  installUpdate: () => invoke('app:installUpdate'),
} satisfies ShelfApi

// Compile-time parity includes payloads and callbacks, not only channel names.
const checkedApi: ShelfApi = api
contextBridge.exposeInMainWorld('shelf', checkedApi)
