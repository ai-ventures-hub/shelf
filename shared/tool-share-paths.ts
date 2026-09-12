import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { StagedShare } from './contracts'
import { pendingImportIds } from './import-journal'
import { resolveShelfDataRoot } from './paths'
import { ShareError } from './tool-share-errors'

/** Default destination parent for received tools. */
export function defaultToolsRoot(): string {
  const override = process.env.SHELF_TOOLS_ROOT?.trim()
  if (override) return path.resolve(override)
  return path.join(os.homedir(), 'Shelf Tools')
}

/** Scratch area for staged (not yet approved) adds. */
export function stagingRoot(dataRoot = resolveShelfDataRoot()): string {
  return path.join(dataRoot, 'staging')
}

/** Remove leftovers from adds that never reached confirm/discard (app start). */
export function cleanStagingRoot(dataRoot = resolveShelfDataRoot()): void {
  try {
    const protectedIds = new Set(pendingImportIds(dataRoot))
    for (const name of fs.readdirSync(stagingRoot(dataRoot))) {
      if (!protectedIds.has(name)) fs.rmSync(path.join(stagingRoot(dataRoot), name), { recursive: true, force: true })
    }
  } catch {
    // best-effort
  }
}

export function sameDir(a: string, b: string): boolean {
  try {
    return fs.realpathSync(a) === fs.realpathSync(b)
  } catch {
    return false
  }
}

export function uniqueDestination(
  parent: string,
  folderName: string,
  isTaken: (destination: string) => boolean = () => false,
): string {
  let candidate = path.join(parent, folderName)
  let n = 2
  while (fs.existsSync(candidate) || isTaken(candidate)) {
    candidate = path.join(parent, `${folderName}-${n}`)
    n += 1
    if (n > 500) throw new ShareError('destination_invalid', 'Could not find a free folder name.')
  }
  return candidate
}

/** Validate a destination chosen on the sheet: absolute, not yet existing (or empty), outside the stage. */
export function validateDestination(
  destination: string,
  stage: Pick<StagedShare, 'stagePath'>,
): { ok: true; destination: string } | { ok: false; reason: string } {
  const resolved = path.resolve(destination.trim())
  if (!path.isAbsolute(resolved) || resolved === path.parse(resolved).root) {
    return { ok: false, reason: 'Choose a folder on this Mac (not the root of a disk).' }
  }
  const stageRoot = path.resolve(stage.stagePath)
  if (resolved === stageRoot || resolved.startsWith(stageRoot + path.sep)) {
    return { ok: false, reason: 'That folder is Shelf’s scratch area.' }
  }
  if (fs.existsSync(resolved)) {
    try {
      const stat = fs.lstatSync(resolved)
      if (stat.isSymbolicLink()) return { ok: false, reason: 'That path is a symlink; choose a real folder.' }
      if (!stat.isDirectory()) return { ok: false, reason: 'That path is a file, not a folder.' }
      if (fs.readdirSync(resolved).length > 0) {
        return { ok: false, reason: 'That folder already has files in it — pick an empty or new folder.' }
      }
    } catch {
      return { ok: false, reason: 'That folder cannot be used.' }
    }
  }
  return { ok: true, destination: resolved }
}

export function moveDir(from: string, to: string): void {
  try {
    fs.renameSync(from, to)
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code !== 'EXDEV') throw err
    fs.cpSync(from, to, { recursive: true, verbatimSymlinks: true })
    fs.rmSync(from, { recursive: true, force: true })
  }
}
