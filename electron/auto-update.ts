import { app } from 'electron'
import { autoUpdater } from 'electron-updater'

/**
 * Background auto-update from the public GitHub releases feed.
 *
 * Updates download silently (differential when the blockmap allows it); when
 * one is ready the renderer gets `app:update-ready` and shows the restart
 * banner. Ignoring the banner still installs on the next natural quit
 * (autoInstallOnAppQuit). Checks never surface errors — offline or
 * rate-limited checks just retry on the next cycle.
 *
 * Dev builds skip entirely: unpacked apps cannot be updated in place.
 */

const FIRST_CHECK_DELAY_MS = 15_000
const RECHECK_INTERVAL_MS = 4 * 60 * 60 * 1000

export interface UpdateReadyInfo {
  version: string
}

export function initAutoUpdate(
  sendToRenderer: (channel: string, ...args: unknown[]) => void,
): void {
  if (!app.isPackaged) return

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('update-downloaded', (info) => {
    const payload: UpdateReadyInfo = { version: info.version }
    sendToRenderer('app:update-ready', payload)
  })
  autoUpdater.on('error', () => {
    // Silent by design — the next scheduled check retries.
  })

  const check = () => {
    void autoUpdater.checkForUpdates().catch(() => {})
  }
  setTimeout(check, FIRST_CHECK_DELAY_MS)
  const timer = setInterval(check, RECHECK_INTERVAL_MS)
  timer.unref?.()
}

/** Quit and install the downloaded update. Caller stops tools first. */
export function installDownloadedUpdate(): void {
  autoUpdater.quitAndInstall()
}
