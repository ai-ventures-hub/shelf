import { app } from 'electron'
import { resolveShelfDataRoot } from '../shared/paths'

export { LibraryStore } from '../shared/library-store'
export { resolveShelfDataRoot } from '../shared/paths'

/**
 * Pin Electron userData to the shared Shelf folder before any userData reads.
 * Call once at process start (before app ready).
 */
export function pinShelfUserDataPath(): string {
  const root = resolveShelfDataRoot()
  app.setPath('userData', root)
  return root
}
