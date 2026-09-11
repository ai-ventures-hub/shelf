import fs from 'node:fs'
import path from 'node:path'
import { atomicWriteFileSync } from './atomic-file'
import type { StagedShare } from './tool-share'

function fileFor(root: string, id: string): string {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error('Invalid import recovery id.')
  return path.join(root, 'imports', `${id}.json`)
}
export function preserveImport(root: string, stage: StagedShare, destination: string): void {
  const file = fileFor(root, stage.stageId)
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  atomicWriteFileSync(file, JSON.stringify({ stage, destination }))
}
export function readImport(root: string, id: string): { stage: StagedShare; destination: string } | undefined {
  const file = fileFor(root, id)
  if (!fs.existsSync(file)) return undefined
  const value = JSON.parse(fs.readFileSync(file, 'utf8')) as { stage: StagedShare; destination: string }
  const stageRoot = path.join(root, 'staging', id)
  if (value.stage.stageId !== id || !(path.resolve(value.stage.stagePath) === stageRoot || path.resolve(value.stage.stagePath).startsWith(stageRoot + path.sep)) || !path.isAbsolute(value.destination)) {
    throw new Error('Invalid import recovery record. Keep the files for manual recovery.')
  }
  return value
}
export function pendingImportIds(root: string): string[] {
  const dir = path.join(root, 'imports')
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir).filter((name) => /^[a-f0-9-]{36}\.json$/.test(name)).map((name) => name.slice(0, -5))
}
export function finishImport(root: string, id: string): void { fs.rmSync(fileFor(root, id), { force: true }) }
export function importMarker(destination: string, id: string): string { return path.join(destination, `.shelf-import-${id}`) }
