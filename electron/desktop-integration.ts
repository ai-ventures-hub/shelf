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
import type { PrefsStore } from '../shared/prefs-store'
import { parseShelfUrl } from '../shared/shelf-url'
import type { LibraryStore } from './library-store'
import type { ProcessManager } from './process-manager'
import type { UiPrefs } from './types'

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

/** Prefer live port from status message when launch reassigned the configured port. */
function portLabelForRunning(
  tool: { port?: number; name: string },
  message?: string,
): string {
  const sniffed = message?.match(/port\s+(\d+)/i)
  const port = sniffed?.[1] || (tool.port != null ? String(tool.port) : '')
  return port ? `${tool.name} · :${port}` : tool.name
}

async function rebuildTrayMenu(host: DesktopIntegrationHost): Promise<void> {
  if (!tray) return
  // Probe ports so MCP-launched tools appear under Running / Stop.
  const states = await host.processes.getStates()
  const stateById = new Map(states.map((s) => [s.toolId, s]))
  const runningIds = new Set(
    states.filter((s) => s.status === 'running').map((s) => s.toolId),
  )
  const running = host.store.list().filter((t) => runningIds.has(t.id))

  // Submenu per tool: open detail, open URL, stop — not just a flat Stop list.
  const runningItems: Electron.MenuItemConstructorOptions[] =
    running.length === 0
      ? [{ label: 'No tools running', enabled: false }]
      : running.map((tool) => {
          const state = stateById.get(tool.id)
          const label = portLabelForRunning(tool, state?.message)
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
