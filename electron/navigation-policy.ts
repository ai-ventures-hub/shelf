import { pathToFileURL } from 'node:url'
import type { WebContents } from 'electron'

export const SHELF_DEV_ORIGIN = 'http://127.0.0.1:5173'

interface NavigationPolicy {
  bundlePath: string
  devOrigin?: string
}

export function allowedRendererNavigation(target: string, policy: NavigationPolicy): boolean {
  try {
    const url = new URL(target)
    if (url.username || url.password) return false
    if (policy.devOrigin && url.origin === policy.devOrigin) return true
    url.hash = ''
    return url.href === pathToFileURL(policy.bundlePath).href
  } catch {
    return false
  }
}

export function installRendererNavigationGuard(contents: WebContents, policy: NavigationPolicy): void {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  const guard = (event: Electron.Event, target: string) => {
    if (!allowedRendererNavigation(target, policy)) event.preventDefault()
  }
  contents.on('will-navigate', guard)
  contents.on('will-redirect', guard)
}
