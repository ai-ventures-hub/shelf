import { VerificationRunner } from '../shared/verification-runner'
import { ProjectMemoryStore } from '../shared/project-memory-store'
import {
  app,
  BrowserWindow,
  dialog,
  globalShortcut,
  Menu,
  screen,
} from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { ToolDraftStore } from '../shared/tool-draft-store'
import { CapabilityGapStore } from '../shared/capability-gap-store'
import { DesignProfileStore } from '../shared/design-profile-store'
import { resolveMcpServerPath as resolvePreferredMcpServerPath } from '../shared/mcp-server-path'
import { PrefsStore } from '../shared/prefs-store'
import { ReceiptStore } from '../shared/receipt-store'
import { TeamCatalogStore } from '../shared/team-catalog-store'
import { saveUpdateResume, takeUpdateResume } from '../shared/update-resume'
import { cleanStagingRoot } from '../shared/tool-share'
import { placeWindow } from '../shared/window-placement'
import { getAppUpdateState, initAutoUpdate, installDownloadedUpdate } from './auto-update'
import {
  applyGlobalShortcut,
  destroyTray,
  enqueueShelfUrl,
  flushPendingShelfUrls,
  handleShelfUrl,
  noteToolState,
  publishShortcutStatus,
  refreshDockBadge,
  refreshTray,
  registerShelfProtocolClient,
  setupTray,
  showOrCreateWindow,
  toggleWindow,
  type DesktopIntegrationHost,
} from './desktop-integration'
import { CompanionManager } from './companion'
import { registerIpc, type IpcContext } from './ipc'
import { LibraryStore, pinShelfUserDataPath } from './library-store'
import { flushPendingOnboarding } from './onboarding-relay'
import { ProcessManager } from './process-manager'
import * as system from './system-bridge'
import type { ToolRuntimeState } from './types'

const isDev = process.env.SHELF_DEV === '1'
let mainWindow: BrowserWindow | null = null
let store: LibraryStore
let processes: ProcessManager
let prefs: PrefsStore
let verification: VerificationRunner
let projectMemory: ProjectMemoryStore
let receipts: ReceiptStore
let capabilityGaps: CapabilityGapStore
let designProfiles: DesignProfileStore
let teamCatalogs: TeamCatalogStore
let toolDrafts: ToolDraftStore
let companion: CompanionManager
let isQuitting = false
let quitDiscardApproved = false
let quitPreparing = false
const pendingRendererMessages: Array<{ channel: string; args: unknown[] }> = []
/** Periodically adopt MCP/orphaned listeners so Stop works without relaunch. */
let externalReconcileTimer: ReturnType<typeof setTimeout> | null = null
/** Runs a reconcile now and reschedules; set once the app is ready. */
let reconcileExternalsNow: (() => void) | null = null
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

// The renderer never legitimately navigates away or opens windows: prod is a
// local file, dev is the Vite origin. Deny everything else at the source —
// external links go through the validated shell.openExternal IPC instead.
app.on('web-contents-created', (_event, contents) => {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  contents.on('will-navigate', (event, url) => {
    const isDevOrigin =
      process.env.SHELF_DEV === '1' && url.startsWith('http://127.0.0.1:5173')
    // Only the app's own bundle may load — any other file:// would carry the
    // preload API into attacker-authored local HTML.
    const ownBundle = url.startsWith(
      `file://${path.join(__dirname, '../../dist/index.html')}`,
    )
    if (!isDevOrigin && !ownBundle) event.preventDefault()
  })
})

// macOS may deliver open-url before ready — queue until host exists.
app.on('open-url', (event, url) => {
  event.preventDefault()
  if (!prefs || !store) {
    enqueueShelfUrl(url)
    return
  }
  void handleShelfUrl(getDesktopHost(), url)
})

// Folders dropped on the Dock icon or opened with Shelf. Like open-url, this
// can arrive before ready (it may be what launched the app), so queue it.
const pendingOpenFolders: string[] = []
app.on('open-file', (event, target) => {
  event.preventDefault()
  if (!prefs || !store) {
    pendingOpenFolders.push(target)
    return
  }
  openProjectFolder(target)
})

/** Hand a folder to the Add Tool review; anything that isn't a folder is ignored. */
function openProjectFolder(target: string): void {
  try {
    if (!fs.statSync(target).isDirectory()) return
  } catch {
    return
  }
  showOrCreateWindow(getDesktopHost())
  sendToRenderer('app:add-folder', target)
}

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
  const saved = prefs.get().windowBounds
  // Primary first: a position that fits no display falls back to centering there.
  const primary = screen.getPrimaryDisplay()
  const workAreas = [primary, ...screen.getAllDisplays().filter((d) => d.id !== primary.id)]
    .map((d) => d.workArea)
  const bounds = placeWindow(saved, workAreas, { width: 1280, height: 860 }, { width: 900, height: 600 })
  mainWindow = new BrowserWindow({
    ...bounds,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#090d16',
    title: 'Shelf',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // The preload requires only 'electron' (verified in the compiled
      // output), so the full renderer sandbox costs nothing.
      sandbox: true,
    },
  })

  loadRenderer(mainWindow)
  if (isDev) mainWindow.webContents.openDevTools({ mode: 'detach' })
  watchRendererHealth(mainWindow)

  // Trackpad swipes (when "Swipe between pages" allows three fingers) and,
  // on other platforms, mouse side buttons. macOS delivers mouse buttons to
  // the page instead; the renderer handles those.
  mainWindow.on('swipe', (_event, direction) => {
    if (direction === 'left') sendToRenderer('app:history', 'back')
    else if (direction === 'right') sendToRenderer('app:history', 'forward')
  })
  mainWindow.on('app-command', (_event, command) => {
    if (command === 'browser-backward') sendToRenderer('app:history', 'back')
    else if (command === 'browser-forward') sendToRenderer('app:history', 'forward')
  })
  if (saved?.fullScreen) mainWindow.setFullScreen(true)
  else if (saved?.maximized) mainWindow.maximize()
  mainWindow.webContents.on('did-finish-load', flushRendererMessages)
  mainWindow.webContents.on('will-prevent-unload', (event) => {
    if (quitDiscardApproved) { event.preventDefault(); return }
    if (!mainWindow) return
    const choice = dialog.showMessageBoxSync(mainWindow, {
      type: 'warning', title: 'Leave this page?',
      message: 'There are unsaved changes or an operation in progress.',
      detail: 'Stay to finish saving or let the operation complete. Leaving discards the form; an operation already started may continue in the background.',
      buttons: ['Stay', 'Leave page'], defaultId: 0, cancelId: 0,
    })
    if (choice === 1) event.preventDefault()
    else isQuitting = false
  })

  // Persist window geometry after interaction settles; move/resize can emit
  // hundreds of events and preferences use synchronous atomic disk writes.
  let boundsPersistTimer: ReturnType<typeof setTimeout> | null = null
  const writeBounds = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    // Normal bounds, so a zoomed or full-screen window un-zooms to its own size.
    const b = mainWindow.getNormalBounds()
    prefs.update({
      windowBounds: {
        width: b.width,
        height: b.height,
        x: b.x,
        y: b.y,
        maximized: mainWindow.isMaximized(),
        fullScreen: mainWindow.isFullScreen(),
      },
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
  // Catch up at once when the window comes back instead of waiting out the
  // slower hidden-window reconcile.
  mainWindow.on('show', () => reconcileExternalsNow?.())
  mainWindow.on('restore', () => reconcileExternalsNow?.())
  mainWindow.on('maximize', scheduleBoundsPersist)
  mainWindow.on('unmaximize', scheduleBoundsPersist)
  mainWindow.on('enter-full-screen', scheduleBoundsPersist)
  mainWindow.on('leave-full-screen', scheduleBoundsPersist)

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

function loadRenderer(win: BrowserWindow): void {
  if (isDev) {
    void win.loadURL('http://127.0.0.1:5173')
  } else {
    // Packaged: …/app.asar/dist-electron/electron → ../../dist
    void win.loadFile(path.join(__dirname, '../../dist/index.html'))
  }
}

/**
 * A crashed or hung renderer otherwise leaves a blank or frozen window with no
 * way back short of quitting. Crashes reload on their own; a repeat crash
 * within a minute asks first so a crash loop can't spin. Hangs offer a reload
 * and the prompt withdraws itself if the page recovers.
 */
function watchRendererHealth(win: BrowserWindow): void {
  const recentCrashes: number[] = []
  let hangPrompt: AbortController | null = null
  /** Set when the user chose Reload on a hang; that crash is ours, not a loop. */
  let crashRequested = false

  win.webContents.on('render-process-gone', (_event, details) => {
    if (details.reason === 'clean-exit' || win.isDestroyed() || isQuitting) return
    console.error('[shelf] renderer gone:', details.reason, details.exitCode)
    hangPrompt?.abort()
    if (crashRequested) {
      crashRequested = false
      loadRenderer(win)
      return
    }
    const now = Date.now()
    while (recentCrashes.length && now - recentCrashes[0] > 60_000) recentCrashes.shift()
    recentCrashes.push(now)
    if (recentCrashes.length === 1) {
      loadRenderer(win)
      return
    }
    void dialog.showMessageBox(win, {
      type: 'error',
      message: 'Shelf’s window stopped working.',
      detail: 'Your tools are still running. Reload the window to continue, or quit Shelf.',
      buttons: ['Reload Window', 'Quit Shelf'],
      defaultId: 0,
      cancelId: 0,
    }).then(({ response }) => {
      if (win.isDestroyed()) return
      if (response === 1) app.quit()
      else loadRenderer(win)
    })
  })

  // A paused debugger looks exactly like a hang; don't nag during development.
  if (isDev) return
  win.on('unresponsive', () => {
    if (hangPrompt || win.isDestroyed()) return
    const prompt = new AbortController()
    hangPrompt = prompt
    void dialog.showMessageBox(win, {
      type: 'warning',
      message: 'Shelf’s window isn’t responding.',
      detail: 'You can wait for it, or reload the window. Your tools keep running either way.',
      buttons: ['Wait', 'Reload Window'],
      defaultId: 0,
      cancelId: 0,
      signal: prompt.signal,
    }).then(({ response }) => {
      if (hangPrompt === prompt) hangPrompt = null
      if (prompt.signal.aborted || response !== 1 || win.isDestroyed()) return
      // Reload alone would wait on the hung page; crash it, then load fresh.
      crashRequested = true
      win.webContents.forcefullyCrashRenderer()
    })
  })
  win.on('responsive', () => {
    hangPrompt?.abort()
    hangPrompt = null
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
      label: 'Go',
      submenu: [
        {
          label: 'Back',
          accelerator: 'CmdOrCtrl+[',
          click: () => sendToRenderer('app:history', 'back'),
        },
        {
          label: 'Forward',
          accelerator: 'CmdOrCtrl+]',
          click: () => sendToRenderer('app:history', 'forward'),
        },
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

/** Everything the IPC domain modules (electron/ipc/*) may reach. */
function buildIpcContext(): IpcContext {
  return {
    store,
    processes,
    prefs,
    verification,
    projectMemory,
    receipts,
    capabilityGaps,
    designProfiles,
    teamCatalogs,
    toolDrafts,
    companion,
    getMainWindow: () => mainWindow,
    getDesktopHost,
    resolveMcpServerPath,
    applyLaunchAtLogin,
    isShuttingDown: () => isQuitting || quitPreparing,
    installUpdate,
  }
}

/** Stop tools, quit, install the downloaded update, and relaunch (app:installUpdate). */
async function installUpdate(): Promise<void> {
  if (isQuitting || quitPreparing) return
  if (getAppUpdateState().status !== 'ready') throw new Error('No downloaded update is ready.')
  quitPreparing = true
  try {
    if (!await confirmPendingChanges('Restart and update')) return
    // Remember what was running so the relaunched app can start it again.
    const resumeIds = processes.localActiveToolIds()
    await verification.stopAll()
    await processes.stopAll('Shelf is updating.', { scope: 'local' })
    saveUpdateResume(store.getRoot(), resumeIds)
    isQuitting = true
    installDownloadedUpdate()
  } catch (error) {
    isQuitting = false
    quitDiscardApproved = false
    // The app is staying open, so don't leave its tools down.
    void resumeToolsAfterUpdate(takeUpdateResume(store.getRoot()))
    throw error
  } finally { quitPreparing = false }
}

/** Start tools that were running before "Restart and update", one at a time. */
async function resumeToolsAfterUpdate(toolIds: string[]): Promise<void> {
  for (const id of toolIds) {
    if (!store.get(id)) continue
    try {
      const state = await processes.start(id, { origin: { kind: 'gui' }, openUrlWhenReady: false })
      if (state.status === 'running' || state.status === 'starting') {
        processes.appendLog(id, 'system', 'Started again after the Shelf update.')
      }
    } catch (err) {
      processes.appendLog(id, 'system', `Could not start again after the Shelf update: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}

/** Consult the renderer's active form before stopping services or invoking the updater. */
async function confirmPendingChanges(action: string): Promise<boolean> {
  const canLeave = !mainWindow || mainWindow.isDestroyed() || await mainWindow.webContents
    .executeJavaScript("window.dispatchEvent(new Event('shelf:before-quit', { cancelable: true }))")
    .catch(() => false)
  if (canLeave) return true
  const choice = await dialog.showMessageBox({
    type: 'warning', message: 'There are unsaved changes or an operation in progress.',
    detail: 'Stay to finish saving or let the operation complete. Leaving discards unsaved form changes.',
    buttons: ['Stay', action], defaultId: 0, cancelId: 0,
  })
  quitDiscardApproved = choice.response === 1
  return quitDiscardApproved
}

if (gotLock) {
  app.whenReady().then(() => {
    prefs = new PrefsStore()
    store = new LibraryStore()
    receipts = new ReceiptStore()
    projectMemory = new ProjectMemoryStore(store.getRoot())
    verification = new VerificationRunner(store, id => sendToRenderer('verification:update', id))
    capabilityGaps = new CapabilityGapStore()
    designProfiles = new DesignProfileStore()
    teamCatalogs = new TeamCatalogStore()
    toolDrafts = new ToolDraftStore()
    // Scratch clones from adds that never reached approve/cancel.
    cleanStagingRoot(store.getRoot())
    processes = new ProcessManager(store, {
      receipts,
      defaultOrigin: () => ({ kind: 'gui' }),
      onReadyUrl: (url) => system.openUrl(url),
      onEvent: (channel, payload) => {
        sendToRenderer(channel, payload)
        companion?.broadcast(channel, payload)
        if (channel === 'process:update') {
          noteToolState(getDesktopHost(), payload as ToolRuntimeState)
          const states = processes.peekStates()
          refreshTray(getDesktopHost(), states)
          refreshDockBadge(states)
        }
      },
    })
    companion = new CompanionManager({
      prefs, store, processes, receipts, verification, capabilityGaps, designProfiles, toolDrafts,
      sendToRenderer,
      dataRoot: store.getRoot(),
      staticRoot: path.join(__dirname, '../../dist'),
      iconPngPath: app.isPackaged
        ? path.join(process.resourcesPath, 'companion-icon.png')
        : path.join(__dirname, '../../build/icon.png'),
    })
    registerIpc(buildIpcContext())
    buildMenu()
    registerShelfProtocolClient()
    setupTray(getDesktopHost())
    const shortcutStatus = applyGlobalShortcut(getDesktopHost())
    createWindow()
    // Tools stopped by "Restart and update" come back without a click.
    void resumeToolsAfterUpdate(takeUpdateResume(store.getRoot()))
    // Window exists so the renderer can receive the boot conflict status.
    publishShortcutStatus(getDesktopHost(), shortcutStatus, { notify: !shortcutStatus.ok })
    void flushPendingShelfUrls(getDesktopHost())
    for (const folder of pendingOpenFolders.splice(0)) openProjectFolder(folder)
    // Retry a first-launch survey that was captured offline (silent, best-effort).
    flushPendingOnboarding(prefs)
    // Keep the OS login item in sync with the pref (covers prefs.json edits).
    applyLaunchAtLogin(prefs.get().launchAtLogin)
    // Background update checks (packaged builds only).
    initAutoUpdate(sendToRenderer)
    // Companion server follows prefs.json; off by default.
    void companion.applyPrefs()

    // Cold-start argv may include a shelf:// link (Windows/Linux; mac uses open-url).
    const bootUrl = process.argv.find((arg) => arg.startsWith('shelf://'))
    if (bootUrl) void handleShelfUrl(getDesktopHost(), bootUrl)

    // Detect tools launched via MCP (separate ProcessManager) without requiring
    // a relaunch. Port probes run every 5s while the window is on screen; with
    // it hidden only the menu bar and Dock badge need them, so every 30s.
    let reconcileInFlight = false
    const scheduleReconcile = () => {
      if (externalReconcileTimer) clearTimeout(externalReconcileTimer)
      const visible = Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible() && !mainWindow.isMinimized())
      externalReconcileTimer = setTimeout(reconcile, visible ? 5_000 : 30_000)
      externalReconcileTimer.unref?.()
    }
    const reconcile = () => {
      if (externalReconcileTimer) clearTimeout(externalReconcileTimer)
      externalReconcileTimer = null
      if (reconcileInFlight || isQuitting) return
      reconcileInFlight = true
      void processes
        .getStates()
        .then((states) => {
          refreshTray(getDesktopHost(), states)
          refreshDockBadge(states)
        })
        .finally(() => {
          reconcileInFlight = false
          if (!isQuitting) scheduleReconcile()
        })
    }
    reconcileExternalsNow = reconcile
    scheduleReconcile()

    // External writers (the MCP server in an agent session) update the shared
    // JSON stores directly; watch the data root so the GUI reflects new tools
    // and receipts without a manual refresh or relaunch. Atomic tmp+rename
    // writes surface as rename events on the directory. Best-effort: if the
    // watcher fails, the app still works — just without live pickup.
    const watchedFiles = new Set([
      'library.json',
      'receipts.json',
      'project-memory.json',
      'capability-gaps.json',
      'design-profiles.json',
      // Agents stage registrations here; the Waiting count must follow.
      'tool-drafts.json',
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
            if (filename === 'library.json') {
              refreshTray(getDesktopHost())
              companion.notifyLibraryChanged()
            }
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
  }).catch((error) => {
    // A startup failure must be visible, not an unhandled rejection. Exit
    // only when it happened before the window existed; a late failure in
    // optional setup leaves a working app open.
    const message = error instanceof Error ? error.message : String(error)
    if (!mainWindow || mainWindow.isDestroyed()) {
      dialog.showErrorBox('Shelf could not start', message)
      app.exit(1)
    } else {
      console.error('[shelf] startup step failed:', error)
    }
  })

  app.on('window-all-closed', () => {
    // Stay alive in the menu bar when configured; otherwise quit on non-mac.
    if (process.platform !== 'darwin' && !prefs?.get().menuBarEnabled) {
      app.quit()
    }
  })

  app.on('will-quit', () => {
    reconcileExternalsNow = null
    void companion?.shutdown()
    if (externalReconcileTimer) {
      clearTimeout(externalReconcileTimer)
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
    event.preventDefault()
    if (quitPreparing) return
    quitPreparing = true
    // scope 'local': quitting the GUI must not kill agent-owned tools.
    void (async () => {
      if (!await confirmPendingChanges('Quit Shelf')) { quitPreparing = false; return }
      await verification.stopAll()
      await processes.stopAll('Shelf is quitting.', { scope: 'local' })
      // A natural quit honors window lifecycle and update installation hooks.
      isQuitting = true
      quitPreparing = false
      app.quit()
    })().catch((error) => {
      isQuitting = false
      quitPreparing = false
      quitDiscardApproved = false
      void dialog.showMessageBox({ type: 'error', message: 'Shelf could not finish stopping its tools.', detail: error instanceof Error ? error.message : String(error), buttons: ['Stay in Shelf'] })
    })
  })
}
