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
      next.idleStopMinutes = clampIdleStopMinutes(next.idleStopMinutes)
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

/** Whole minutes between 2 and 240; anything unreadable falls back to 15. */
export function clampIdleStopMinutes(value: unknown): number {
  const minutes = Math.round(Number(value))
  return Number.isFinite(minutes) && minutes > 0 ? Math.min(240, Math.max(2, minutes)) : 15
}

/**
 * Current prefs without creating or locking the file. For the MCP server,
 * which only reads what the user chose in the app.
 */
export function readPrefsSnapshot(root = resolveShelfDataRoot()): UiPrefs {
  const file = path.join(root, 'prefs.json')
  let text: string
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch {
    // No prefs yet: the user has changed nothing, so the defaults are theirs.
    return { ...DEFAULT_UI_PREFS }
  }
  try {
    const raw = JSON.parse(text) as Partial<UiPrefs>
    if (!raw || typeof raw !== 'object') throw new Error('not an object')
    const merged = { ...DEFAULT_UI_PREFS, ...raw }
    return { ...merged, gatewayBlockedToolIds: Array.isArray(merged.gatewayBlockedToolIds) ? merged.gatewayBlockedToolIds : [] }
  } catch {
    // The file is there but unreadable, so what the user chose is unknown.
    // Do not guess "allowed": agent use and idle stop stay off until it reads.
    return { ...DEFAULT_UI_PREFS, gatewayEnabled: false, idleStopEnabled: false }
  }
}
