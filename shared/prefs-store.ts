/**
 * Persists UI preferences separately from the tool library.
 * Path: ~/Library/Application Support/Shelf/prefs.json
 */
import fs from 'node:fs'
import path from 'node:path'
import { resolveShelfDataRoot } from './paths'
import { DEFAULT_UI_PREFS, type UiPrefs } from './types'

export class PrefsStore {
  private readonly filePath: string

  constructor(root = resolveShelfDataRoot()) {
    fs.mkdirSync(root, { recursive: true })
    this.filePath = path.join(root, 'prefs.json')
    if (!fs.existsSync(this.filePath)) {
      this.write({ ...DEFAULT_UI_PREFS })
    }
  }

  get(): UiPrefs {
    return this.read()
  }

  /** Shallow-merge patch onto current prefs and persist. */
  update(patch: Partial<UiPrefs>): UiPrefs {
    const next: UiPrefs = {
      ...this.read(),
      ...patch,
      windowBounds: patch.windowBounds
        ? { ...this.read().windowBounds, ...patch.windowBounds }
        : this.read().windowBounds,
    }
    // Clamp sidebar width to the desktop IA range.
    next.sidebarWidth = Math.min(280, Math.max(210, Number(next.sidebarWidth) || 250))
    this.write(next)
    return next
  }

  private read(): UiPrefs {
    try {
      const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as Partial<UiPrefs>
      return {
        ...DEFAULT_UI_PREFS,
        ...raw,
        windowBounds: raw.windowBounds || DEFAULT_UI_PREFS.windowBounds,
      }
    } catch {
      return { ...DEFAULT_UI_PREFS }
    }
  }

  private write(data: UiPrefs): void {
    const tmp = `${this.filePath}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8')
    fs.renameSync(tmp, this.filePath)
  }
}
