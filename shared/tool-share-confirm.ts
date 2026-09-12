import fs from 'node:fs'
import path from 'node:path'
import { atomicWriteFileSync } from './atomic-file'
import type { ConfirmShareInput, ConfirmShareResult, StagedShare } from './contracts'
import { finishImport, importMarker, preserveImport, readImport } from './import-journal'
import type { LibraryStore } from './library-store'
import type { ProcessManager } from './process-manager'
import { ProcessOperations } from './process-operation'
import { registerProject, type RegisterProjectOptions, type RegisterProjectResult } from './register-project'
import { ShareError } from './tool-share-errors'
import { moveDir, stagingRoot, validateDestination } from './tool-share-paths'
import type { ToolSource } from './types'

/**
 * The approval: move the staged files to the destination, then run the
 * existing register pipeline seeded from the manifest with the user's env
 * values and consented setup steps. Records provenance on the saved tool.
 */
export async function confirmStagedShare(
  stage: StagedShare,
  input: ConfirmShareInput,
  deps: {
    store: LibraryStore
    processes: ProcessManager
    toolDefaults?: RegisterProjectOptions['toolDefaults']
    dataRoot?: string
  },
): Promise<ConfirmShareResult> {
  const dataRoot = deps.dataRoot || deps.store.getRoot()
  return new ProcessOperations(dataRoot).run(`import:${stage.stageId}`, () => confirmImportLocked(stage, input, deps))
}

async function confirmImportLocked(
  stage: StagedShare, input: ConfirmShareInput,
  deps: { store: LibraryStore; processes: ProcessManager; toolDefaults?: RegisterProjectOptions['toolDefaults']; dataRoot?: string },
): Promise<ConfirmShareResult> {
  const dataRoot = deps.dataRoot || deps.store.getRoot()
  const pending = readImport(dataRoot, stage.stageId)
  const resuming = Boolean(pending && pending.destination === path.resolve(input.destination) &&
    !fs.existsSync(stage.stagePath) && fs.existsSync(importMarker(pending.destination, stage.stageId)))
  const valid = resuming ? { ok: true as const, destination: pending!.destination } : validateDestination(input.destination, stage)
  if (!valid.ok) throw new ShareError('destination_invalid', valid.reason)
  const destination = valid.destination
  // A stale library entry at this path would make registerProject MERGE
  // into it and drop the manifest + typed env values on the floor.
  const claimed = deps.store.findByProjectPath(destination)
  if (claimed) {
    throw new ShareError(
      'destination_invalid',
      `“${claimed.name}” in your library already points at that folder. Remove it first, or choose another folder.`,
    )
  }
  if (!resuming && !fs.existsSync(stage.stagePath)) {
    throw new ShareError('stage_missing', 'The fetched files are gone. Fetch again.')
  }
  if (!resuming) {
    preserveImport(dataRoot, stage, destination)
    atomicWriteFileSync(importMarker(stage.stagePath, stage.stageId), stage.stageId)
  }

  // A destination that turned unusable between validation and now (no
  // permission, a symlink, a race) is a folder problem — keep the stage
  // alive so the user can pick another folder, not a lost fetch.
  try {
    if (!resuming) {
      fs.mkdirSync(path.dirname(destination), { recursive: true })
      if (fs.existsSync(destination)) fs.rmdirSync(destination) // validated empty
      moveDir(stage.stagePath, destination)
    }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code && ['EACCES', 'EPERM', 'ENOTDIR', 'EEXIST', 'ENOENT', 'EROFS'].includes(code)) {
      throw new ShareError('destination_invalid', `Shelf couldn’t write to that folder (${code}). Choose another.`)
    }
    throw err
  }

  const env: Record<string, string> = {}
  for (const key of Object.keys(stage.manifest.env)) {
    if (key === 'PORT') continue // tool.port governs; the launch path sets PORT itself
    const value = typeof input.env?.[key] === 'string' ? input.env[key] : ''
    if (value.trim()) env[key] = value
  }

  const now = new Date().toISOString()
  const source: ToolSource =
    stage.source.kind === 'git'
      ? { kind: 'git', repo: stage.source.repo, ref: stage.ref, addedAt: now }
      : { kind: 'bundle', addedAt: now }

  let result: RegisterProjectResult
  try {
    result = await registerProject(
      destination,
      { store: deps.store, processes: deps.processes },
      {
        autoLaunch: input.launch ?? true,
        onPortConflict: 'reassign',
        runSetup: input.runSetup,
        setupSteps: stage.setupSteps,
        toolDefaults: deps.toolDefaults,
        overrides: {
          name: stage.manifest.name || undefined,
          description: stage.manifest.description,
          launchCommand: stage.manifest.launchCommand || undefined,
          port: stage.manifest.port,
          url: stage.manifest.url,
          tags: stage.manifest.tags,
          capabilities: stage.manifest.capabilities,
          agentAccess: stage.manifest.agentAccess,
          notes: stage.manifest.notes,
          env: Object.keys(env).length ? env : undefined,
        },
        source,
      },
    )
  } catch (err) {
    if (deps.store.findByProjectPath(destination)) {
      finishImport(dataRoot, stage.stageId)
      fs.rmSync(importMarker(destination, stage.stageId), { force: true })
      throw new ShareError('import_incomplete', `The tool was registered at ${destination}, but a later step failed. Open it in the library to retry. ${err instanceof Error ? err.message : String(err)}`)
    }
    throw new ShareError('import_incomplete', `Files are safe at ${destination}, but registration failed. Retry this import to continue without downloading again. ${err instanceof Error ? err.message : String(err)}`)
  }
  if (!result.tool) throw new ShareError('import_incomplete', `Files are safe at ${destination}. Correct the project folder and retry registration.`)
  finishImport(dataRoot, stage.stageId)
  fs.rmSync(importMarker(destination, stage.stageId), { force: true })
  fs.rmSync(path.join(stagingRoot(dataRoot), stage.stageId), { recursive: true, force: true })
  return { ...result, destination }
}
