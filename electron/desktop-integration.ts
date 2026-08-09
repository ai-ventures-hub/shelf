/**
 * Menu bar tray, global shortcut, and OS-level shelf:// URL handling.
 * Keeps main.ts focused on window/IPC wiring.
 */
import {
  Menu,
  Notification,
  Tray,
  app,
  dialog,
  globalShortcut,
  nativeImage,
  shell,
  type BrowserWindow,
} from 'electron'
import path from 'node:path'
import {
  DEFAULT_GLOBAL_SHORTCUT,
  type ShortcutStatus,
} from '../shared/global-shortcut'
import { startCollection, stopCollection } from '../shared/collection-launch'
import type { PrefsStore } from '../shared/prefs-store'
import { parseShelfUrl } from '../shared/shelf-url'
import type { LibraryStore } from './library-store'
import type { ProcessManager } from './process-manager'
import { launchOriginLabel } from './types'
import type { ToolRuntimeState, UiPrefs } from './types'

export { parseShelfUrl } from '../shared/shelf-url'
export {
  DEFAULT_GLOBAL_SHORTCUT,
  GLOBAL_SHORTCUT_PRESETS,
  type ShortcutStatus,
} from '../shared/global-shortcut'

export interface DesktopIntegrationHost {
  prefs: PrefsStore
  store: LibraryStore
  processes: ProcessManager
  getMainWindow: () => BrowserWindow | null
  createWindow: () => void
  showWindow: () => void
  hideWindow: () => void
  toggleWindow: () => void
  navigate: (route: string) => void
  sendToRenderer: (channel: string, ...args: unknown[]) => void
  /** True once the user has chosen Quit (not close-to-tray). */
  isQuitting: () => boolean
}

let tray: Tray | null = null
let trayShowsActive = false
let registeredShortcut: string | null = null
/** Last registration result so Settings can show conflict state after reload. */
let lastShortcutStatus: ShortcutStatus = {
  ok: true,
  accelerator: DEFAULT_GLOBAL_SHORTCUT,
}
const pendingUrls: string[] = []

/** Prefer black+alpha Template assets; fall back to resized Dock icon. */
function resolveTrayIcon(): Electron.NativeImage {
  const templateCandidates = [
    path.join(process.resourcesPath, 'TrayIconTemplate.png'),
    path.join(app.getAppPath(), 'build', 'TrayIconTemplate.png'),
    path.join(__dirname, '../../build/TrayIconTemplate.png'),
  ]
  for (const candidate of templateCandidates) {
    try {
      const img = nativeImage.createFromPath(candidate)
      if (!img.isEmpty()) {
        // Filename already includes Template; still mark so dark/light menus invert correctly.
        img.setTemplateImage(true)
        return img
      }
    } catch {
      // try next
    }
  }

  const fallbackCandidates = [
    path.join(process.resourcesPath, 'icon.png'),
    path.join(app.getAppPath(), 'build', 'icon.png'),
    path.join(__dirname, '../../build/icon.png'),
  ]
  for (const candidate of fallbackCandidates) {
    try {
      const img = nativeImage.createFromPath(candidate)
      if (!img.isEmpty()) {
        const sized = img.resize({ width: 18, height: 18 })
        sized.setTemplateImage(true)
        return sized
      }
    } catch {
      // try next
    }
  }
  return nativeImage.createEmpty()
}

/** Brand-colored (non-template) glyph shown while any tool is running. */
function resolveTrayIconActive(): Electron.NativeImage | null {
  const candidates = [
    path.join(process.resourcesPath, 'TrayIconActive.png'),
    path.join(app.getAppPath(), 'build', 'TrayIconActive.png'),
    path.join(__dirname, '../../build/TrayIconActive.png'),
  ]
  for (const candidate of candidates) {
    try {
      const img = nativeImage.createFromPath(candidate)
      if (!img.isEmpty()) return img
    } catch {
      // try next
    }
  }
  return null
}

/** Swap the menu-bar glyph: brand-lit when tools run, template when idle. */
function applyTrayActivity(active: boolean): void {
  if (!tray) return
  if (active === trayShowsActive) return
  const img = active ? resolveTrayIconActive() : null
  tray.setImage(img && !img.isEmpty() ? img : resolveTrayIcon())
  trayShowsActive = active && Boolean(img)
}

export function showOrCreateWindow(host: DesktopIntegrationHost): BrowserWindow {
  let win = host.getMainWindow()
  if (!win || win.isDestroyed()) {
    host.createWindow()
    win = host.getMainWindow()
  }
  if (!win) throw new Error('Failed to create Shelf window')
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
  return win
}

export function toggleWindow(host: DesktopIntegrationHost): void {
  const win = host.getMainWindow()
  if (!win || win.isDestroyed()) {
    showOrCreateWindow(host)
    return
  }
  if (win.isVisible() && win.isFocused()) {
    win.hide()
  } else {
    showOrCreateWindow(host)
  }
}

/** Live port from runtime state (reassign/sniff aware), plus agent provenance. */
function trayLabelForRunning(
  tool: { port?: number; name: string },
  state?: ToolRuntimeState,
): string {
  const port = state?.port ?? tool.port
  let label = port != null ? `${tool.name} · :${port}` : tool.name
  // Only agents get a suffix — "via You" would just be noise.
  if (state?.startedBy?.kind === 'mcp') {
    const who = launchOriginLabel(state.startedBy)
    if (who) label += ` · via ${who}`
  }
  return label
}

async function rebuildTrayMenu(host: DesktopIntegrationHost): Promise<void> {
  if (!tray) return
  // Probe ports so MCP-launched tools appear under Running / Stop.
  const states = await host.processes.getStates()
  const stateById = new Map(states.map((s) => [s.toolId, s]))
  const runningIds = new Set(
    states.filter((s) => s.status === 'running').map((s) => s.toolId),
  )
  const allTools = host.store.list()
  const running = allTools.filter((t) => runningIds.has(t.id))
  applyTrayActivity(running.length > 0)
  // Favorites not already running: one-click launch from anywhere.
  const favorites = allTools.filter((t) => t.favorite && !runningIds.has(t.id))
  // Stacks: only collections that still have members.
  const collections = host.store
    .listCollections()
    .filter((c) => c.toolIds.some((id) => allTools.some((t) => t.id === id)))

  // Submenu per tool: open detail, open URL, stop — not just a flat Stop list.
  const runningItems: Electron.MenuItemConstructorOptions[] =
    running.length === 0
      ? [{ label: 'No tools running', enabled: false }]
      : running.map((tool) => {
          const state = stateById.get(tool.id)
          const label = trayLabelForRunning(tool, state)
          const url = tool.url
          return {
            label,
            submenu: [
              {
                label: 'Open in Shelf',
                click: () => {
                  showOrCreateWindow(host)
                  host.navigate(`/tools/${tool.id}`)
                },
              },
              ...(url
                ? [
                    {
                      label: 'Open URL',
                      click: () => {
                        void shell.openExternal(url)
                      },
                    } satisfies Electron.MenuItemConstructorOptions,
                  ]
                : []),
              {
                label: 'Stop',
                click: () => {
                  void host.processes.stop(tool.id).then(() => {
                    void refreshTray(host)
                  })
                },
              },
            ],
          }
        })

  const menu = Menu.buildFromTemplate([
    {
      label: 'Open Shelf',
      click: () => showOrCreateWindow(host),
    },
    {
      label: 'Quick Open…',
      click: () => {
        showOrCreateWindow(host)
        host.sendToRenderer('app:quick-open')
      },
    },
    { type: 'separator' },
    {
      label: running.length ? `Running (${running.length})` : 'Running',
      enabled: false,
    },
    ...runningItems,
    ...(running.length > 0
      ? ([
          {
            label: 'Stop all',
            click: () => {
              // scope 'all': stop everything Shelf owns, including adopted
              // MCP-launched tools; untrusted listeners are refused per-tool.
              void host.processes
                .stopAll('Stopped from the Shelf menu.', { scope: 'all' })
                .then(() => refreshTray(host))
            },
          },
        ] satisfies Electron.MenuItemConstructorOptions[])
      : []),
    // Simple mode heals busy ports on launch, matching in-app behavior.
    ...(favorites.length > 0
      ? ([
          { type: 'separator' },
          { label: 'Favorites', enabled: false },
          ...favorites.map((tool) => ({
            label: tool.name,
            click: () => {
              void host.processes
                .start(tool.id, {
                  onPortConflict:
                    host.prefs.get().uiMode === 'simple' ? 'reassign' : 'fail',
                  origin: { kind: 'tray' },
                })
                .then(() => refreshTray(host))
            },
          })),
        ] satisfies Electron.MenuItemConstructorOptions[])
      : []),
    ...(collections.length > 0
      ? ([
          { type: 'separator' },
          { label: 'Collections', enabled: false },
          ...collections.map((collection) => {
            const memberIds = collection.toolIds.filter((id) =>
              allTools.some((t) => t.id === id),
            )
            const runningMembers = memberIds.filter((id) => runningIds.has(id)).length
            return {
              label: `${collection.name} (${runningMembers}/${memberIds.length})`,
              submenu: [
                {
                  label: 'Start stack',
                  enabled: runningMembers < memberIds.length,
                  click: () => {
                    void startCollection(
                      collection.id,
                      { store: host.store, processes: host.processes },
                      {
                        onPortConflict:
                          host.prefs.get().uiMode === 'simple' ? 'reassign' : 'fail',
                        origin: { kind: 'tray' },
                      },
                    ).then(() => refreshTray(host))
                  },
                },
                {
                  label: 'Stop stack',
                  enabled: runningMembers > 0,
                  click: () => {
                    void stopCollection(collection.id, {
                      store: host.store,
                      processes: host.processes,
                    }).then(() => refreshTray(host))
                  },
                },
                {
                  label: 'Open in Shelf',
                  click: () => {
                    showOrCreateWindow(host)
                    host.navigate(`/collections/${collection.id}`)
                  },
                },
              ],
            } satisfies Electron.MenuItemConstructorOptions
          }),
        ] satisfies Electron.MenuItemConstructorOptions[])
      : []),
    { type: 'separator' },
    {
      label: 'Add Tool',
      click: () => {
        showOrCreateWindow(host)
        host.navigate('/tools/new')
      },
    },
    {
      label: 'Settings…',
      click: () => {
        showOrCreateWindow(host)
        host.navigate('/settings')
      },
    },
    { type: 'separator' },
    {
      label: 'Quit Shelf',
      click: () => {
        app.quit()
      },
    },
  ])
  tray.setContextMenu(menu)
}

export function setupTray(host: DesktopIntegrationHost): void {
  destroyTray()
  if (!host.prefs.get().menuBarEnabled) return

  tray = new Tray(resolveTrayIcon())
  tray.setToolTip('Shelf')
  tray.on('click', () => toggleWindow(host))
  void rebuildTrayMenu(host)
}

export function refreshTray(host: DesktopIntegrationHost): void {
  if (!host.prefs.get().menuBarEnabled) {
    destroyTray()
    return
  }
  if (!tray) setupTray(host)
  else void rebuildTrayMenu(host)
}

export function destroyTray(): void {
  if (tray) {
    tray.destroy()
    tray = null
  }
}

export function getShortcutStatus(): ShortcutStatus {
  return lastShortcutStatus
}

/**
 * Register (or clear) the global show/hide hotkey and remember status for the UI.
 */
export function applyGlobalShortcut(host: DesktopIntegrationHost): ShortcutStatus {
  if (registeredShortcut) {
    globalShortcut.unregister(registeredShortcut)
    registeredShortcut = null
  }

  const prefs = host.prefs.get()
  if (!prefs.globalShortcutEnabled) {
    lastShortcutStatus = { ok: true, accelerator: prefs.globalShortcut }
    return lastShortcutStatus
  }

  const accelerator = (prefs.globalShortcut || DEFAULT_GLOBAL_SHORTCUT).trim()
  if (!accelerator) {
    lastShortcutStatus = {
      ok: false,
      accelerator: '',
      error: 'Global shortcut is empty. Pick a preset or enter an Electron accelerator.',
    }
    return lastShortcutStatus
  }

  let ok = false
  try {
    ok = globalShortcut.register(accelerator, () => toggleWindow(host))
  } catch (err) {
    lastShortcutStatus = {
      ok: false,
      accelerator,
      error:
        err instanceof Error
          ? err.message
          : `Invalid accelerator: ${accelerator}`,
    }
    return lastShortcutStatus
  }

  if (ok) {
    registeredShortcut = accelerator
    lastShortcutStatus = { ok: true, accelerator }
    return lastShortcutStatus
  }

  lastShortcutStatus = {
    ok: false,
    accelerator,
    error: `${accelerator} is already in use by another app. Choose a different shortcut in Settings.`,
  }
  return lastShortcutStatus
}

/** Push status to the renderer and optionally show a macOS notification on conflict. */
export function publishShortcutStatus(
  host: DesktopIntegrationHost,
  status: ShortcutStatus,
  opts?: { notify?: boolean },
): void {
  host.sendToRenderer('app:shortcut-status', status)
  if (opts?.notify && !status.ok && status.error && Notification.isSupported()) {
    new Notification({
      title: 'Shelf shortcut unavailable',
      body: status.error,
    }).show()
  }
}

export async function handleShelfUrl(
  host: DesktopIntegrationHost,
  raw: string,
): Promise<void> {
  const parsed = parseShelfUrl(raw)
  showOrCreateWindow(host)

  if (parsed.action === 'quick-open') {
    host.sendToRenderer('app:quick-open')
    return
  }

  if (parsed.action === 'navigate' && parsed.route) {
    host.navigate(parsed.route)
    return
  }

  if (parsed.action === 'open') {
    host.navigate(parsed.route || '/')
    return
  }

  let toolId = parsed.toolId
  if (!toolId && parsed.toolName) {
    toolId = host.store.findByName(parsed.toolName)?.id
  }
  if (!toolId && (parsed.action === 'launch' || parsed.action === 'stop' || parsed.action === 'restart')) {
    return
  }

  const tool = toolId ? host.store.get(toolId) : undefined
  if (toolId && !tool) {
    host.navigate('/')
    return
  }
  if (
    toolId &&
    tool &&
    (parsed.action === 'launch' || parsed.action === 'stop' || parsed.action === 'restart')
  ) {
    host.navigate(`/tools/${toolId}`)
    const verb = parsed.action === 'launch' ? 'Launch' : parsed.action === 'stop' ? 'Stop' : 'Restart'
    const options: Electron.MessageBoxOptions = {
      type: parsed.action === 'stop' ? 'warning' : 'question',
      title: `${verb} tool`,
      message: `${verb} “${tool.name}”?`,
      detail: 'This request came from a shelf:// link outside the Shelf window.',
      buttons: [verb, 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    }
    const window = host.getMainWindow()
    const result = window
      ? await dialog.showMessageBox(window, options)
      : await dialog.showMessageBox(options)
    if (result.response !== 0) return
  }

  if (parsed.action === 'launch' && toolId) {
    void host.processes.start(toolId)
    return
  }
  if (parsed.action === 'stop' && toolId) {
    void host.processes.stop(toolId)
    return
  }
  if (parsed.action === 'restart' && toolId) {
    void host.processes.restart(toolId)
    return
  }

  host.navigate('/')
}

export function enqueueShelfUrl(url: string): void {
  pendingUrls.push(url)
}

export async function flushPendingShelfUrls(
  host: DesktopIntegrationHost,
): Promise<void> {
  while (pendingUrls.length) {
    const next = pendingUrls.shift()
    if (next) await handleShelfUrl(host, next)
  }
}

/** Register as the default handler for shelf:// (dev + packaged). */
export function registerShelfProtocolClient(): void {
  if (process.defaultApp) {
    if (process.argv.length >= 2) {
      app.setAsDefaultProtocolClient('shelf', process.execPath, [
        path.resolve(process.argv[1]),
      ])
    }
  } else {
    app.setAsDefaultProtocolClient('shelf')
  }
}

export function prefsPatchAffectsDesktop(patch: Partial<UiPrefs>): boolean {
  return (
    patch.menuBarEnabled !== undefined ||
    patch.closeToMenuBar !== undefined ||
    patch.globalShortcutEnabled !== undefined ||
    patch.globalShortcut !== undefined
  )
}
