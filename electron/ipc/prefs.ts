import {
  applyGlobalShortcut,
  getShortcutStatus,
  prefsPatchAffectsDesktop,
  publishShortcutStatus,
  refreshTray,
} from '../desktop-integration'
import { submitOnboarding } from '../onboarding-relay'
import type { IpcContext } from './context'
import { handle } from './typed'

/** Preferences, desktop-integration status, and the first-launch survey. */
export function registerPrefsIpc(ctx: IpcContext): void {
  const { prefs } = ctx

  handle('prefs:get', () => prefs.get())
  handle('prefs:update', (_e, patch) => {
    const next = prefs.update(patch)
    let shortcutStatus = getShortcutStatus()
    if (prefsPatchAffectsDesktop(patch)) {
      refreshTray(ctx.getDesktopHost())
      shortcutStatus = applyGlobalShortcut(ctx.getDesktopHost())
      // Settings listens for live status; avoid a second OS notification on every tweak.
      publishShortcutStatus(ctx.getDesktopHost(), shortcutStatus, { notify: false })
    }
    if ('launchAtLogin' in patch) ctx.applyLaunchAtLogin(next.launchAtLogin)
    return { prefs: next, shortcutStatus }
  })
  handle('desktop:shortcutStatus', () => getShortcutStatus())

  handle('onboarding:submit', (_e, input) => submitOnboarding(prefs, input))
}
