import fs from 'node:fs'
import path from 'node:path'
import { atomicWriteFileSync } from './atomic-file'

/**
 * Tools the user had running when they chose "Restart and update".
 *
 * An update is an app-initiated interruption, not a request to stop work:
 * before this, every release stopped the user's dev servers and left them
 * down. The list is written just before the updater quits and consumed once
 * on the next launch. A normal quit never writes it, so quitting still means
 * "stop my tools".
 */
const FILE_NAME = 'resume-after-update.json'
/** Older than this, the restart did not follow the update; don't surprise the user. */
const MAX_AGE_MS = 15 * 60_000

interface ResumeFile {
  version: 1
  savedAt: string
  toolIds: string[]
}

export function saveUpdateResume(root: string, toolIds: readonly string[]): void {
  const ids = [...new Set(toolIds)].filter((id) => typeof id === 'string' && id)
  const target = path.join(root, FILE_NAME)
  if (!ids.length) {
    fs.rmSync(target, { force: true })
    return
  }
  const data: ResumeFile = { version: 1, savedAt: new Date().toISOString(), toolIds: ids }
  atomicWriteFileSync(target, JSON.stringify(data, null, 2))
}

/** Read and delete the list. Returns [] when absent, stale, or malformed. */
export function takeUpdateResume(root: string, now = Date.now()): string[] {
  const target = path.join(root, FILE_NAME)
  let raw: string
  try {
    raw = fs.readFileSync(target, 'utf8')
  } catch {
    return []
  }
  try { fs.rmSync(target, { force: true }) } catch { return [] /* never resume a list we cannot consume */ }
  try {
    const data = JSON.parse(raw) as Partial<ResumeFile>
    const savedAt = Date.parse(String(data.savedAt))
    if (data.version !== 1 || !Number.isFinite(savedAt) || now - savedAt > MAX_AGE_MS || now < savedAt) return []
    if (!Array.isArray(data.toolIds)) return []
    return [...new Set(data.toolIds.filter((id): id is string => typeof id === 'string' && id.length > 0))].slice(0, 100)
  } catch {
    return []
  }
}
