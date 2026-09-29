/**
 * Agent registrations that have not been accepted yet.
 * Separate from library.json so a proposal cannot become a launchable tool
 * by being written into the library. The GUI accept path calls registerProject.
 */
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { atomicWriteFileSync, withFileLockSync } from './atomic-file'
import { resolveShelfDataRoot } from './paths'
import type { ProjectImportSuggestion, ToolDraft } from './types'
import {
  registerProject,
  type RegisterProjectDeps,
  type RegisterProjectOptions,
  type RegisterProjectResult,
} from './register-project'

const MAX_DRAFTS = 50

export type { ToolDraft }

interface DraftFile {
  version: 1
  drafts: ToolDraft[]
}

export interface StageToolDraftInput {
  projectPath: string
  suggestion: ProjectImportSuggestion
  envKeys: string[]
  client?: string
}

/** Fields an agent is allowed to see again. No env values exist on the record. */
export function publicToolDraft(draft: ToolDraft) {
  return {
    id: draft.id,
    name: draft.name,
    projectPath: draft.projectPath,
    launchCommand: draft.launchCommand,
    port: draft.port,
    url: draft.url,
    envKeys: draft.envKeys,
    client: draft.client,
    createdAt: draft.createdAt,
  }
}

export class ToolDraftStore {
  private readonly filePath: string

  constructor(root = resolveShelfDataRoot()) {
    fs.mkdirSync(root, { recursive: true, mode: 0o700 })
    this.filePath = path.join(root, 'tool-drafts.json')
    withFileLockSync(this.filePath, () => {
      if (!fs.existsSync(this.filePath)) this.write({ version: 1, drafts: [] })
    })
  }

  list(): ToolDraft[] {
    return this.read().drafts.slice().sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
  }

  get(id: string): ToolDraft | undefined {
    return this.read().drafts.find((draft) => draft.id === id)
  }

  /**
   * One draft per folder. A second registration from an agent refreshes the
   * same card instead of stacking duplicates.
   */
  stage(input: StageToolDraftInput): ToolDraft {
    return withFileLockSync(this.filePath, () => {
      const data = this.read()
      const now = new Date().toISOString()
      const projectPath = path.resolve(input.projectPath)
      const existing = data.drafts.find((draft) => path.resolve(draft.projectPath) === projectPath)
      const draft: ToolDraft = {
        id: existing?.id || randomUUID(),
        projectPath,
        name: input.suggestion.name?.trim() || path.basename(projectPath),
        launchCommand: input.suggestion.launchCommand || '',
        port: input.suggestion.port,
        url: input.suggestion.url,
        envKeys: Array.from(
          new Set(input.envKeys.filter((key) => /^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(key))),
        ).slice(0, 40),
        client: input.client?.trim() || undefined,
        createdAt: existing?.createdAt || now,
        updatedAt: now,
      }
      const next = [draft, ...data.drafts.filter((item) => item.id !== draft.id)].slice(0, MAX_DRAFTS)
      this.write({ version: 1, drafts: next })
      return draft
    })
  }

  delete(id: string): void {
    withFileLockSync(this.filePath, () => {
      const data = this.read()
      data.drafts = data.drafts.filter((draft) => draft.id !== id)
      this.write(data)
    })
  }

  private read(): DraftFile {
    let raw: string
    try {
      raw = fs.readFileSync(this.filePath, 'utf8')
    } catch {
      return { version: 1, drafts: [] }
    }
    try {
      const parsed = JSON.parse(raw) as Partial<DraftFile> | null
      if (!parsed || !Array.isArray(parsed.drafts)) throw new Error('missing drafts array')
      return { version: 1, drafts: parsed.drafts.filter(isDraft) }
    } catch {
      // Set an unreadable file aside rather than letting the next stage()
      // overwrite pending registrations the user has not reviewed.
      try { fs.renameSync(this.filePath, `${this.filePath}.corrupt-${Date.now()}`) } catch { /* already moved */ }
      return { version: 1, drafts: [] }
    }
  }

  private write(data: DraftFile): void {
    atomicWriteFileSync(this.filePath, JSON.stringify(data, null, 2))
  }
}

/** Same folder, through symlinks and the case-insensitive default macOS volume. */
function samePath(a: string, b: string): boolean {
  const canonical = (value: string) => {
    let resolved = path.resolve(value)
    try { resolved = fs.realpathSync.native(resolved) } catch { /* missing: compare as given */ }
    return process.platform === 'darwin' ? resolved.toLowerCase() : resolved
  }
  return canonical(a) === canonical(b)
}

function isDraft(value: unknown): value is ToolDraft {
  if (!value || typeof value !== 'object') return false
  const draft = value as Partial<ToolDraft>
  return (
    typeof draft.id === 'string' &&
    typeof draft.projectPath === 'string' &&
    typeof draft.name === 'string' &&
    typeof draft.launchCommand === 'string' &&
    Array.isArray(draft.envKeys) &&
    typeof draft.createdAt === 'string' &&
    typeof draft.updatedAt === 'string'
  )
}

/**
 * Accept writes the library through the same register path the GUI already
 * uses, then drops the draft. Launch stays off. The user starts it afterwards.
 * An invalid folder keeps the draft so Reject is still available.
 */
export async function acceptToolDraft(
  id: string,
  drafts: ToolDraftStore,
  deps: RegisterProjectDeps,
  options: Pick<RegisterProjectOptions, 'toolDefaults'> & {
    /** The draft's updatedAt as shown on the review sheet. */
    expectedUpdatedAt?: string
  } = {},
): Promise<RegisterProjectResult> {
  const draft = drafts.get(id)
  if (!draft) throw new Error('That draft is no longer waiting.')
  // An agent can re-stage the same draft id while the sheet is open.
  if (options.expectedUpdatedAt && draft.updatedAt !== options.expectedUpdatedAt)
    throw new Error('This draft changed after it was shown. Review it again before accepting.')
  if (!draft.launchCommand.trim())
    throw new Error('This draft has no launch command, so there is nothing to save as shown. Reject it, then add the folder with Add tool.')
  const registered = deps.store.list().find((tool) => tool.projectPath && samePath(tool.projectPath, draft.projectPath))
  if (registered) {
    drafts.delete(id)
    throw new Error(`This folder is already in your library as "${registered.name}". The draft was removed.`)
  }
  const result = await registerProject(draft.projectPath, deps, {
    autoLaunch: false,
    toolDefaults: options.toolDefaults,
    // Save exactly what the sheet showed; never fill blanks from a new scan.
    exactOverrides: true,
    overrides: {
      name: draft.name,
      launchCommand: draft.launchCommand,
      port: draft.port,
      url: draft.url,
    },
  })
  if (result.outcome !== 'invalid_folder') drafts.delete(id)
  return result
}
