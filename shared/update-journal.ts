import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { atomicWriteFileSync } from './atomic-file'
import type { Tool } from './types'
import type { ApplyUpdateInput } from './tool-share'
import type { ToolManifest } from './tool-manifest'

export interface UpdateJournal {
  id: string
  toolId: string
  projectPath: string
  input: ApplyUpdateInput
  beforeManifest: ToolManifest | null
  phase: 'prepared' | 'files_applied' | 'metadata_saved' | 'setup_failed'
  restoreRef?: string
  appliedFingerprint?: string
  completedSetup: string[]
}
export function updateJournalPath(root: string, projectPath: string): string {
  return path.join(root, 'updates', `${createHash('sha256').update(path.resolve(projectPath)).digest('hex')}.json`)
}
export function readUpdateJournal(root: string, tool: Pick<Tool, 'projectPath'>): UpdateJournal | undefined {
  if (!tool.projectPath) return undefined
  const file = updateJournalPath(root, tool.projectPath)
  if (!fs.existsSync(file)) return undefined
  const value = JSON.parse(fs.readFileSync(file, 'utf8')) as UpdateJournal
  if (!value.id || path.resolve(value.projectPath) !== path.resolve(tool.projectPath) || !value.input?.expectedTargetRef) {
    throw new Error('The update recovery record is invalid. Keep it for recovery before trying another update.')
  }
  return value
}
export function writeUpdateJournal(root: string, value: UpdateJournal): void {
  const file = updateJournalPath(root, value.projectPath)
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  atomicWriteFileSync(file, JSON.stringify(value, null, 2))
}
export function clearUpdateJournal(root: string, projectPath: string): void {
  fs.rmSync(updateJournalPath(root, projectPath), { force: true })
}
