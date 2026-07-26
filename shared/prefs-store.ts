/**
 * Persists UI preferences separately from the tool library.
 * Path: ~/Library/Application Support/Shelf/prefs.json
 */
import fs from 'node:fs'
import path from 'node:path'
import { atomicWriteFileSync, withFileLockSync } from './atomic-file'
import { resolveShelfDataRoot } from './paths'
import { DEFAULT_UI_PREFS, type UiPrefs } from './types'

export class PrefsStore {
  private readonly filePath: string

  constructor(root = resolveShelfDataRoot()) {
    fs.mkdirSync(root, { recursive: true })
    this.filePath = path.join(root, 'prefs.json')
    withFileLockSync(this.filePath, () => {
      if (!fs.existsSync(this.filePath)) {
        this.write({ ...DEFAULT_UI_PREFS })
        return
      }
      try {
        const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'))
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new Error('invalid preferences object')
        }
      } catch {
        const stamp = new Date().toISOString().replace(/[:.]/g, '-')
        fs.copyFileSync(
          this.filePath,
          path.join(root, `prefs.corrupt-backup-${stamp}.json`),
        )
        this.write({ ...DEFAULT_UI_PREFS })
      }
    })
  }

  get(): UiPrefs {
    return this.read()
  }

  /** Shallow-merge patch onto current prefs and persist. */
  update(patch: Partial<UiPrefs>): UiPrefs {
    return withFileLockSync(this.filePath, () => {
      const current = this.read()
      const next: UiPrefs = {
        ...current,
        ...patch,
        windowBounds: patch.windowBounds
          ? { ...current.windowBounds, ...patch.windowBounds }
          : current.windowBounds,
      }
      next.sidebarWidth = Math.min(280, Math.max(210, Number(next.sidebarWidth) || 250))
      this.write(next)
      return next
    })
  }

  private read(): UiPrefs {
    try {
      const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as Partial<UiPrefs>
      return {
        ...DEFAULT_UI_PREFS,
        ...raw,
        windowBounds: raw.windowBounds || DEFAULT_UI_PREFS.windowBounds,
      }
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      throw new Error(`Shelf could not read prefs.json: ${detail}`)
    }
  }

  private write(data: UiPrefs): void {
    atomicWriteFileSync(this.filePath, JSON.stringify(data, null, 2))
  }
}
