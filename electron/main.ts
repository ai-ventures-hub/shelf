import {
  app,
  BrowserWindow,
  Menu,
  dialog,
  globalShortcut,
  ipcMain,
  net,
  protocol,
} from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { pathToFileURL } from 'node:url'
import { initAutoUpdate, installDownloadedUpdate } from './auto-update'
import { startCollection, stopCollection } from '../shared/collection-launch'
import { resolveDesignMd } from '../shared/design-md'
import { buildDesignBrief } from '../shared/design-brief'
import { buildGapBrief } from '../shared/gap-brief'
import { suggestGapResolutions } from '../shared/gap-suggest'
import { deriveToolReadiness } from '../shared/capability-intelligence'
import { CapabilityGapStore } from '../shared/capability-gap-store'
import {
  DesignProfileStore,
  type SaveDesignProfileInput,
} from '../shared/design-profile-store'
import { resolveProfileForGap } from '../shared/design-resolve'
import { resolveMcpServerPath as resolvePreferredMcpServerPath } from '../shared/mcp-server-path'
import { PrefsStore } from '../shared/prefs-store'
import { buildErrorReport } from '../shared/launch-diagnostics'
import { inspectProject } from '../shared/project-import'
import {
  registerProject,
  type RegisterProjectOptions,
} from '../shared/register-project'
import {
  receiptsToCsv,
  receiptsToJson,
  type ReceiptFilterOpts,
} from '../shared/receipt-export'
import { ReceiptStore } from '../shared/receipt-store'
import {
  applyGlobalShortcut,
  destroyTray,
  enqueueShelfUrl,
  flushPendingShelfUrls,
  getShortcutStatus,
  handleShelfUrl,
  prefsPatchAffectsDesktop,
  publishShortcutStatus,
  refreshTray,
  registerShelfProtocolClient,
  setupTray,
  showOrCreateWindow,
  toggleWindow,
  type DesktopIntegrationHost,
} from './desktop-integration'
import { LibraryStore, pinShelfUserDataPath } from './library-store'
import { registerMcpConnectIpc } from './mcp-connect-ipc'
import { flushPendingOnboarding, submitOnboarding } from './onboarding-relay'
import { ProcessManager, type StartOptions } from './process-manager'
import * as system from './system-bridge'
import type {
  AgentAccessKind,
  CapabilityGapStatus,
  Collection,
  DesignAssetKind,
  OnboardingSubmissionInput,
  Tool,
  UiPrefs,
} from './types'

const isDev = process.env.SHELF_DEV === '1'
let mainWindow: BrowserWindow | null = null
let store: LibraryStore
let processes: ProcessManager
let prefs: PrefsStore
let receipts: ReceiptStore
let capabilityGaps: CapabilityGapStore
let designProfiles: DesignProfileStore
let isQuitting = false
const pendingRendererMessages: Array<{ channel: string; args: unknown[] }> = []
/** Periodically adopt MCP/orphaned listeners so Stop works without relaunch. */
let externalReconcileTimer: ReturnType<typeof setInterval> | null = null
let dataRootWatcher: fs.FSWatcher | null = null

/** Register/unregister the packaged app as a macOS login item. Dev runs
 *  would register the bare Electron binary, so they are a no-op. */
function applyLaunchAtLogin(enabled: boolean): void {
  if (!app.isPackaged) return
  try {
    app.setLoginItemSettings({ openAtLogin: enabled })
  } catch (err) {
    console.error('Login item update failed:', err)
  }
}

// Stable data directory before any userData reads (avoids empty library after relaunch).
pinShelfUserDataPath()
app.setName('Shelf')

// Dev loads from vite over HTTP; never let Chromium cache those responses.
// (A wrong server once squatting the vite port can otherwise poison the shared
// userData HTTP cache and blank the window on every later launch.)
if (isDev) app.commandLine.appendSwitch('disable-http-cache')

// Single instance so shelf:// and Dock re-opens forward into this process.
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
}

// Must register before app ready so <img src="shelf-icon://…"> can load local icons.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'shelf-icon',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      bypassCSP: true,
      stream: true,
    },
  },
])

// macOS may deliver open-url before ready — queue until host exists.
app.on('open-url', (event, url) => {
  event.preventDefault()
  if (!prefs || !store) {
    enqueueShelfUrl(url)
    return
  }
  void handleShelfUrl(getDesktopHost(), url)
})

app.on('second-instance', (_event, argv) => {
  const url = argv.find((arg) => arg.startsWith('shelf://'))
  if (url && prefs && store) {
    void handleShelfUrl(getDesktopHost(), url)
    return
  }
  showOrCreateWindow(getDesktopHost())
})

function sendToRenderer(channel: string, ...args: unknown[]): void {
  if (
    !mainWindow ||
    mainWindow.isDestroyed() ||
    mainWindow.webContents.isLoadingMainFrame()
  ) {
    pendingRendererMessages.push({ channel, args })
    // Prevent a long-hidden or failed window from growing this queue forever.
    if (pendingRendererMessages.length > 200) pendingRendererMessages.shift()
    return
  }
  mainWindow.webContents.send(channel, ...args)
}

function flushRendererMessages(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  const queued = pendingRendererMessages.splice(0)
  for (const item of queued) {
    mainWindow.webContents.send(item.channel, ...item.args)
  }
}

function navigate(route: string): void {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow()
  mainWindow?.show()
  sendToRenderer('app:navigate', route)
}

function getDesktopHost(): DesktopIntegrationHost {
  return {
    prefs,
    store,
    processes,
    getMainWindow: () => mainWindow,
    createWindow,
    showWindow: () => showOrCreateWindow(getDesktopHost()),
    hideWindow: () => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide()
    },
    toggleWindow: () => toggleWindow(getDesktopHost()),
    navigate,
    sendToRenderer,
    isQuitting: () => isQuitting,
  }
}

function createWindow(): void {
  const bounds = prefs.get().windowBounds
  mainWindow = new BrowserWindow({
    width: bounds?.width || 1280,
    height: bounds?.height || 860,
    x: bounds?.x,
    y: bounds?.y,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#090d16',
    title: 'Shelf',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  if (isDev) {
    void mainWindow.loadURL('http://127.0.0.1:5173')
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    // Packaged: …/app.asar/dist-electron/electron → ../../dist
    void mainWindow.loadFile(path.join(__dirname, '../../dist/index.html'))
  }
  mainWindow.webContents.on('did-finish-load', flushRendererMessages)

  // Persist window geometry after interaction settles; move/resize can emit
  // hundreds of events and preferences use synchronous atomic disk writes.
  let boundsPersistTimer: ReturnType<typeof setTimeout> | null = null
  const writeBounds = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    const b = mainWindow.getBounds()
    prefs.update({
      windowBounds: { width: b.width, height: b.height, x: b.x, y: b.y },
    })
  }
  const scheduleBoundsPersist = () => {
    if (boundsPersistTimer) clearTimeout(boundsPersistTimer)
    boundsPersistTimer = setTimeout(() => {
      boundsPersistTimer = null
      writeBounds()
    }, 150)
  }
  const flushBounds = () => {
    if (boundsPersistTimer) {
      clearTimeout(boundsPersistTimer)
      boundsPersistTimer = null
    }
    writeBounds()
  }
  mainWindow.on('resize', scheduleBoundsPersist)
  mainWindow.on('move', scheduleBoundsPersist)

  // Close to menu bar when enabled (Quit still exits via tray / ⌘Q).
  mainWindow.on('close', (event) => {
    flushBounds()
    if (isQuitting) return
    const p = prefs.get()
    if (p.menuBarEnabled && p.closeToMenuBar) {
      event.preventDefault()
      mainWindow?.hide()
    }
  })

  mainWindow.on('closed', () => {
    if (boundsPersistTimer) clearTimeout(boundsPersistTimer)
    mainWindow = null
  })
}

function buildMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        {
          label: 'Settings…',
          accelerator: 'CmdOrCtrl+,',
          click: () => navigate('/settings'),
        },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'File',
      submenu: [
        {
          label: 'Add Tool',
          accelerator: 'CmdOrCtrl+N',
          click: () => navigate('/tools/new'),
        },
        { type: 'separator' },
        { role: 'close' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        {
          // Palette lives in the renderer; main only toggles visibility.
          label: 'Quick Open…',
          accelerator: 'CmdOrCtrl+K',
          click: () => sendToRenderer('app:quick-open'),
        },
        {
          label: 'Focus Search',
          accelerator: 'CmdOrCtrl+F',
          click: () => sendToRenderer('app:focus-search'),
        },
        {
          label: 'Library',
          accelerator: 'CmdOrCtrl+1',
          click: () => navigate('/'),
        },
        {
          label: 'MCP Connect',
          accelerator: 'CmdOrCtrl+2',
          click: () => navigate('/mcp'),
        },
        {
          label: 'Design',
          accelerator: 'CmdOrCtrl+3',
          click: () => navigate('/design'),
        },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'front' }],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

/**
 * MCP path for Connect + Advanced copy.
 * Prefers /Applications/Shelf.app over ~/Desktop when both exist.
 */
function resolveMcpServerPath(): string {
  return resolvePreferredMcpServerPath({
    resourcesPath: process.resourcesPath,
    appPath: app.getAppPath(),
    extraCandidates: [path.join(__dirname, '../../dist-mcp/mcp/server.js')],
  })
}

function registerIpc(): void {
  ipcMain.handle('tools:list', () => store.list())
  ipcMain.handle('tools:save', (_e, tool: Tool) => store.save(tool))
  ipcMain.handle('tools:delete', (_e, id: string) => {
    void processes.stop(id)
    store.delete(id)
  })
  ipcMain.handle('tools:readiness', (_e, id: string) => {
    const tool = store.get(id)
    if (!tool) throw new Error(`Tool not found: ${id}`)
    return deriveToolReadiness(tool)
  })

  ipcMain.handle(
    'capabilityGaps:list',
    (_e, opts?: { status?: CapabilityGapStatus; limit?: number }) =>
      capabilityGaps.list(opts || {}),
  )
  ipcMain.handle(
    'capabilityGaps:record',
    (
      _e,
      input: {
        task: string
        capabilities: string[]
        reason: string
        relatedToolIds?: string[]
        suggestedAccess?: AgentAccessKind
      },
    ) => {
      const knownIds = new Set(store.list().map((tool) => tool.id))
      return capabilityGaps.record({
        ...input,
        relatedToolIds: (input.relatedToolIds || []).filter((id) => knownIds.has(id)),
      })
    },
  )
  ipcMain.handle(
    'capabilityGaps:updateStatus',
    (_e, id: string, status: CapabilityGapStatus) =>
      capabilityGaps.updateStatus(id, status),
  )
  ipcMain.handle(
    'capabilityGaps:update',
    (_e, id: string, patch: { status?: CapabilityGapStatus; relatedToolIds?: string[] }) => {
      const knownIds = new Set(store.list().map((tool) => tool.id))
      const validToolIds = (patch.relatedToolIds || []).filter((toolId) =>
        knownIds.has(toolId),
      )
      // Resolve-with-tool must record WHICH tool resolved the gap; if the
      // tool vanished since the suggestion rendered, fail instead of
      // resolving with no provenance.
      if (patch.relatedToolIds?.length && validToolIds.length === 0) {
        throw new Error('That tool no longer exists in the library.')
      }
      return capabilityGaps.update(id, { ...patch, relatedToolIds: validToolIds })
    },
  )
  ipcMain.handle('capabilityGaps:delete', (_e, id: string) => {
    capabilityGaps.delete(id)
  })
  // Paste-ready build brief ("Copy brief for your AI tool").
  ipcMain.handle('capabilityGaps:brief', (_e, id: string) => {
    const gap = capabilityGaps.get(id)
    if (!gap) throw new Error(`Capability gap not found: ${id}`)
    const related = gap.relatedToolIds
      .map((toolId) => store.get(toolId))
      .filter((tool): tool is Tool => Boolean(tool))
    const brand = resolveProfileForGap(gap, store.listCollections(), designProfiles.list())
    return buildGapBrief(gap, related, brand.profile ? { profile: brand.profile } : undefined)
  })
  // Suggest-only resolve matching; the user confirms in the GUI. Uncapped
  // read — list()'s 200 cap would silently starve older gaps.
  ipcMain.handle('capabilityGaps:suggestions', () =>
    suggestGapResolutions(capabilityGaps.listAll(), store.list()),
  )
  ipcMain.handle(
    'capabilityGaps:dismissSuggestion',
    (_e, id: string, toolId: string) =>
      capabilityGaps.dismissSuggestion(id, toolId),
  )

  // Design Engine (v1.0): list + editor mutations. Agents stay read-only over
  // MCP; the GUI is the only write surface.
  ipcMain.handle('designProfiles:list', () => designProfiles.list())
  // Any GUI save transfers ownership to the user: agents may then no longer
  // overwrite the profile via shelf_upsert_design_profile.
  ipcMain.handle('designProfiles:save', (_e, input: SaveDesignProfileInput) =>
    designProfiles.save({ ...input, origin: 'user' }),
  )
  ipcMain.handle('designProfiles:delete', (_e, id: string) => {
    designProfiles.delete(id)
  })
  ipcMain.handle('designProfiles:setDefault', (_e, id: string) =>
    designProfiles.setDefault(id),
  )
  ipcMain.handle(
    'designProfiles:pickAsset',
    async (_e, profileId: string, kind: DesignAssetKind) => {
      const result = await dialog.showOpenDialog(mainWindow!, {
        properties: ['openFile'],
        filters: [
          {
            name: 'Brand assets',
            extensions: [
              'svg', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'ico',
              'pdf', 'woff2', 'woff', 'ttf', 'otf',
            ],
          },
        ],
      })
      if (result.canceled || !result.filePaths[0]) return null
      return designProfiles.importAsset(profileId, result.filePaths[0], kind)
    },
  )
  ipcMain.handle(
    'designProfiles:importAsset',
    (_e, profileId: string, sourcePath: string, kind: DesignAssetKind) =>
      designProfiles.importAsset(profileId, sourcePath, kind),
  )
  ipcMain.handle(
    'designProfiles:removeAsset',
    (_e, profileId: string, assetPath: string) => {
      designProfiles.removeAsset(profileId, assetPath)
    },
  )
  ipcMain.handle('designProfiles:brief', (_e, id: string) => {
    const profile = designProfiles.get(id)
    return profile ? buildDesignBrief(profile) : null
  })
  // Data-url previews for the editor. Restricted to the brand-assets root so
  // the renderer cannot read arbitrary files through this channel.
  ipcMain.handle('designProfiles:assetDataUrl', (_e, assetPath: string) => {
    const assetsRoot = path.join(designProfiles.getRoot(), 'brand-assets') + path.sep
    if (!fs.existsSync(assetPath)) return null
    // realpath, not resolve: a symlink planted inside brand-assets must not
    // read files outside it through this channel.
    const resolved = fs.realpathSync(assetPath)
    if (!resolved.startsWith(assetsRoot)) return null
    const ext = path.extname(resolved).toLowerCase()
    const mime =
      ext === '.svg'
        ? 'image/svg+xml'
        : ext === '.jpg' || ext === '.jpeg'
          ? 'image/jpeg'
          : ext === '.webp'
            ? 'image/webp'
            : ext === '.gif'
              ? 'image/gif'
              : ext === '.ico'
                ? 'image/x-icon'
                : ext === '.png'
                  ? 'image/png'
                  : null
    if (!mime) return null // non-previewable (pdf/fonts) — renderer shows a glyph tile
    const buf = fs.readFileSync(resolved)
    return `data:${mime};base64,${buf.toString('base64')}`
  })

  ipcMain.handle('collections:list', () => store.listCollections())
  ipcMain.handle('collections:save', (_e, collection: Collection) =>
    store.saveCollection(collection),
  )
  ipcMain.handle('collections:delete', (_e, id: string) => {
    store.deleteCollection(id)
  })
  ipcMain.handle('collections:start', (_e, id: string, options?: StartOptions) =>
    startCollection(id, { store, processes }, options),
  )
  ipcMain.handle('collections:stop', (_e, id: string) =>
    stopCollection(id, { store, processes }),
  )

  ipcMain.handle('prefs:get', () => prefs.get())
  ipcMain.handle('prefs:update', (_e, patch: Partial<UiPrefs>) => {
    const next = prefs.update(patch)
    let shortcutStatus = getShortcutStatus()
    if (prefsPatchAffectsDesktop(patch)) {
      refreshTray(getDesktopHost())
      shortcutStatus = applyGlobalShortcut(getDesktopHost())
      // Settings listens for live status; avoid a second OS notification on every tweak.
      publishShortcutStatus(getDesktopHost(), shortcutStatus, { notify: false })
    }
    if ('launchAtLogin' in patch) applyLaunchAtLogin(next.launchAtLogin)
    return { prefs: next, shortcutStatus }
  })
  ipcMain.handle('desktop:shortcutStatus', () => getShortcutStatus())

  ipcMain.handle('onboarding:submit', (_e, input: OnboardingSubmissionInput) =>
    submitOnboarding(prefs, input),
  )

  ipcMain.handle(
    'designMd:get',
    (_e, opts: { id?: string; projectPath?: string }) => {
      const tool = opts.id ? store.get(opts.id) : undefined
      const projectPath = opts.projectPath || tool?.projectPath
      return resolveDesignMd(projectPath, tool?.id || opts.id)
    },
  )

  ipcMain.handle('tools:pickFolder', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openDirectory', 'createDirectory'],
    })
    return result.canceled ? null : result.filePaths[0] || null
  })

  // Smart import: suggest launch/port/tags from a chosen project folder.
  ipcMain.handle('tools:inspectProject', (_e, projectPath: string) =>
    inspectProject(projectPath),
  )

  // One-shot register: inspect → save → (consented) setup → launch.
  // Consent flow is two calls: first without runSetup (may return
  // needs_setup), then again with runSetup: true after the user agrees.
  ipcMain.handle(
    'tools:registerProject',
    (_e, projectPath: string, options?: RegisterProjectOptions) => {
      const uiPrefs = prefs.get()
      return registerProject(
        projectPath,
        { store, processes },
        {
          ...options,
          toolDefaults: {
            iconLucide: uiPrefs.defaultIconLucide,
            iconColor: uiPrefs.defaultIconColor,
            iconBackground: uiPrefs.defaultIconBackground,
          },
        },
      )
    },
  )

  ipcMain.handle('tools:pickIcon', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openFile'],
      filters: [
        { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'icns'] },
      ],
    })
    if (result.canceled || !result.filePaths[0]) return null

    const src = result.filePaths[0]
    const ext = path.extname(src) || '.png'
    const dest = path.join(store.getIconsDir(), `${Date.now()}${ext}`)
    fs.copyFileSync(src, dest)
    return dest
  })

  ipcMain.handle('tools:iconDataUrl', (_e, iconPath: string) => {
    if (!iconPath || !fs.existsSync(iconPath)) return null
    const ext = path.extname(iconPath).toLowerCase().replace('.', '')
    const mime =
      ext === 'jpg' || ext === 'jpeg'
        ? 'image/jpeg'
        : ext === 'webp'
          ? 'image/webp'
          : ext === 'gif'
            ? 'image/gif'
            : 'image/png'
    const buf = fs.readFileSync(iconPath)
    return `data:${mime};base64,${buf.toString('base64')}`
  })

  ipcMain.handle('process:states', () => processes.getStates())
  ipcMain.handle('process:start', (_e, id: string, options?: StartOptions) =>
    processes.start(id, options),
  )
  ipcMain.handle('process:stop', (_e, id: string) => processes.stop(id))
  ipcMain.handle('process:restart', (_e, id: string) => processes.restart(id))
  ipcMain.handle('process:logs', (_e, id: string) => processes.getLogs(id))
  // Paste-ready failure report for "Copy report for your AI tool".
  ipcMain.handle('process:errorReport', async (_e, id: string) => {
    const tool = store.get(id)
    if (!tool) return null
    const state = await processes.getState(id)
    return buildErrorReport(tool, state, processes.getLogs(id))
  })

  ipcMain.handle('receipts:list', (_e, opts?: ReceiptFilterOpts) =>
    receipts.list(opts || {}),
  )
  ipcMain.handle('receipts:clear', (_e, opts?: { toolId?: string }) =>
    receipts.clear(opts || {}),
  )
  ipcMain.handle(
    'receipts:export',
    async (
      _e,
      opts?: ReceiptFilterOpts & { format?: 'json' | 'csv' },
    ): Promise<{ saved: boolean; path?: string }> => {
      const format = opts?.format === 'csv' ? 'csv' : 'json'
      const list = receipts.list({
        toolId: opts?.toolId,
        outcomes: opts?.outcomes,
        query: opts?.query,
        limit: 400,
      })
      const content = format === 'csv' ? receiptsToCsv(list) : receiptsToJson(list)
      const stamp = new Date().toISOString().slice(0, 10)
      const saveOpts: Electron.SaveDialogOptions = {
        title: 'Export run receipts',
        defaultPath: `shelf-receipts-${stamp}.${format}`,
        filters:
          format === 'csv'
            ? [{ name: 'CSV', extensions: ['csv'] }]
            : [{ name: 'JSON', extensions: ['json'] }],
      }
      // Parent window is optional — export still works if the UI is hidden to tray.
      const result = mainWindow
        ? await dialog.showSaveDialog(mainWindow, saveOpts)
        : await dialog.showSaveDialog(saveOpts)
      if (result.canceled || !result.filePath) return { saved: false }
      fs.writeFileSync(result.filePath, content, 'utf8')
      return { saved: true, path: result.filePath }
    },
  )

  ipcMain.handle('system:openUrl', (_e, url: string) => system.openUrl(url))
  ipcMain.handle('system:openPath', (_e, target: string) => system.openPath(target))
  ipcMain.handle('system:openEditor', (_e, projectPath: string) =>
    system.openEditor(projectPath),
  )
  ipcMain.handle('system:openTerminal', (_e, projectPath: string) =>
    system.openTerminal(projectPath),
  )
  ipcMain.handle('system:mcpServerPath', () => resolveMcpServerPath())
  ipcMain.handle('system:registerShelfProtocol', () => {
    registerShelfProtocolClient()
    return true
  })
  ipcMain.handle('app:installUpdate', async () => {
    // Bypass the before-quit interception: stop tools here, then hand the
    // quit to Squirrel so the downloaded update installs and relaunches.
    isQuitting = true
    try {
      // Only our own children — agent-launched tools survive the update restart.
      await processes.stopAll('Shelf is updating.', { scope: 'local' })
    } catch {
      // Updating matters more than a clean tool shutdown at this point.
    }
    installDownloadedUpdate()
  })
  registerMcpConnectIpc(resolveMcpServerPath)
}

if (gotLock) {
  app.whenReady().then(() => {
    protocol.handle('shelf-icon', async (request) => {
      try {
        const parsed = new URL(request.url)
        const filePath = parsed.searchParams.get('path')
        if (!filePath || !fs.existsSync(filePath)) {
          return new Response('Icon not found', { status: 404 })
        }
        return net.fetch(pathToFileURL(filePath).href)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return new Response(message, { status: 500 })
      }
    })

    prefs = new PrefsStore()
    store = new LibraryStore()
    receipts = new ReceiptStore()
    capabilityGaps = new CapabilityGapStore()
    designProfiles = new DesignProfileStore()
    processes = new ProcessManager(store, {
      receipts,
      defaultOrigin: () => ({ kind: 'gui' }),
      onReadyUrl: (url) => system.openUrl(url),
      onEvent: (channel, payload) => {
        sendToRenderer(channel, payload)
        if (channel === 'process:update') {
          refreshTray(getDesktopHost())
        }
      },
    })
    registerIpc()
    buildMenu()
    registerShelfProtocolClient()
    setupTray(getDesktopHost())
    const shortcutStatus = applyGlobalShortcut(getDesktopHost())
    createWindow()
    // Window exists so the renderer can receive the boot conflict status.
    publishShortcutStatus(getDesktopHost(), shortcutStatus, { notify: !shortcutStatus.ok })
    void flushPendingShelfUrls(getDesktopHost())
    // Retry a first-launch survey that was captured offline (silent, best-effort).
    flushPendingOnboarding(prefs)
    // Keep the OS login item in sync with the pref (covers prefs.json edits).
    applyLaunchAtLogin(prefs.get().launchAtLogin)
    // Background update checks (packaged builds only).
    initAutoUpdate(sendToRenderer)

    // Cold-start argv may include a shelf:// link (Windows/Linux; mac uses open-url).
    const bootUrl = process.argv.find((arg) => arg.startsWith('shelf://'))
    if (bootUrl) void handleShelfUrl(getDesktopHost(), bootUrl)

    // Detect tools launched via MCP (separate ProcessManager) without requiring a relaunch.
    let reconcileInFlight = false
    externalReconcileTimer = setInterval(() => {
      if (reconcileInFlight) return
      reconcileInFlight = true
      void processes
        .getStates()
        .then(() => refreshTray(getDesktopHost()))
        .finally(() => {
          reconcileInFlight = false
        })
    }, 5_000)
    externalReconcileTimer.unref?.()

    // External writers (the MCP server in an agent session) update the shared
    // JSON stores directly; watch the data root so the GUI reflects new tools
    // and receipts without a manual refresh or relaunch. Atomic tmp+rename
    // writes surface as rename events on the directory. Best-effort: if the
    // watcher fails, the app still works — just without live pickup.
    const watchedFiles = new Set([
      'library.json',
      'receipts.json',
      'capability-gaps.json',
      'design-profiles.json',
    ])
    const changeDebounce = new Map<string, ReturnType<typeof setTimeout>>()
    try {
      dataRootWatcher = fs.watch(store.getRoot(), (_event, filename) => {
        if (!filename || !watchedFiles.has(filename)) return
        clearTimeout(changeDebounce.get(filename))
        changeDebounce.set(
          filename,
          setTimeout(() => {
            changeDebounce.delete(filename)
            sendToRenderer('data:external-change', filename)
            if (filename === 'library.json') refreshTray(getDesktopHost())
          }, 400),
        )
      })
    } catch (err) {
      console.error('Data root watcher unavailable:', err)
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
      else showOrCreateWindow(getDesktopHost())
    })
  })

  app.on('window-all-closed', () => {
    // Stay alive in the menu bar when configured; otherwise quit on non-mac.
    if (process.platform !== 'darwin' && !prefs?.get().menuBarEnabled) {
      app.quit()
    }
  })

  app.on('will-quit', () => {
    if (externalReconcileTimer) {
      clearInterval(externalReconcileTimer)
      externalReconcileTimer = null
    }
    if (dataRootWatcher) {
      dataRootWatcher.close()
      dataRootWatcher = null
    }
    destroyTray()
    globalShortcut.unregisterAll()
  })

  app.on('before-quit', (event) => {
    if (isQuitting) return
    isQuitting = true
    event.preventDefault()
    // scope 'local': quitting the GUI must not kill tools an agent's MCP
    // server launched — that server still owns and manages them.
    void processes.stopAll('Shelf is quitting.', { scope: 'local' }).finally(() => {
      app.exit(0)
    })
  })
}
