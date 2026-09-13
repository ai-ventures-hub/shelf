import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { AppUpdateState } from '../shared/contracts'
import { nextAppUpdateState } from '../shared/app-update-state'

const FIRST_CHECK_DELAY_MS = 15_000
const RECHECK_INTERVAL_MS = 4 * 60 * 60 * 1000
let state: AppUpdateState = {
  status: app.isPackaged ? 'idle' : 'unsupported',
  currentVersion: app.getVersion(),
}
let send: (channel: string, ...args: unknown[]) => void = () => {}
let pending: Promise<AppUpdateState> | null = null
function update(patch: Partial<AppUpdateState>) {
  state = nextAppUpdateState(state, patch)
  send('app:update-state', state)
}
export function getAppUpdateState(): AppUpdateState {
  return { ...state }
}

export function checkAppUpdates(): Promise<AppUpdateState> {
  if (!app.isPackaged || state.status === 'ready' || state.status === 'downloading')
    return Promise.resolve(getAppUpdateState())
  if (pending) return pending
  update({ status: 'checking' })
  pending = autoUpdater
    .checkForUpdates()
    .then(() => getAppUpdateState())
    .catch(() => {
      update({
        status: 'error',
        error: 'Could not check for updates. Check your connection and try again.',
      })
      return getAppUpdateState()
    })
    .finally(() => {
      pending = null
    })
  return pending
}

export function initAutoUpdate(sendToRenderer: typeof send): void {
  send = sendToRenderer
  if (!app.isPackaged) return
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on('checking-for-update', () => update({ status: 'checking' }))
  autoUpdater.on('update-available', (info) =>
    update({ status: 'downloading', version: info.version, checkedAt: new Date().toISOString() }),
  )
  autoUpdater.on('download-progress', (progress) =>
    update({ status: 'downloading', percent: Math.round(progress.percent) }),
  )
  autoUpdater.on('update-not-available', () =>
    update({ status: 'idle', checkedAt: new Date().toISOString() }),
  )
  autoUpdater.on('update-downloaded', (info) => {
    update({ status: 'ready', version: info.version })
    send('app:update-ready', { version: info.version })
  })
  autoUpdater.on('error', () =>
    update({
      status: 'error',
      error: 'Update check or download failed. Check your connection and retry.',
    }),
  )
  setTimeout(() => {
    void checkAppUpdates()
  }, FIRST_CHECK_DELAY_MS).unref()
  setInterval(() => {
    void checkAppUpdates()
  }, RECHECK_INTERVAL_MS).unref()
}

export function installDownloadedUpdate(): void {
  if (state.status !== 'ready') throw new Error('No downloaded update is ready.')
  autoUpdater.quitAndInstall()
}
