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
import { maskCommandEnvPrefix, maskSecrets, stripInvisibleChars } from './types'
import {
  canonicalFolderKey,
  registerProject,
  type RegisterProjectDeps,
  type RegisterProjectOptions,
  type RegisterProjectResult,
} from './register-project'

const MAX_DRAFTS = 50
/** The review sheet shows these verbatim; an agent controls all of them. */
const MAX_CLIENT_CHARS = 80
const MAX_NAME_CHARS = 120
const MAX_DESCRIPTION_CHARS = 500
const MAX_CAPABILITIES = 20
const MAX_CAPABILITY_CHARS = 120
const MAX_COMMAND_CHARS = 4000

/**
 * A staged draft. `description` and `capabilities` are optional agent-supplied
 * fields (2.1.x) carried on the draft record; the accept path decides how they
 * reach the saved tool. Declared here rather than in contracts.ts so older
 * readers of tool-drafts.json simply ignore them.
 */
export interface StagedToolDraft extends ToolDraft {
  description?: string
  capabilities?: string[]
}

export type { ToolDraft }

interface DraftFile {
  version: 1
  drafts: StagedToolDraft[]
}

export interface StageToolDraftInput {
  projectPath: string
  suggestion: ProjectImportSuggestion
  envKeys: string[]
  client?: string
  /** Agent-supplied values that win over the inspected suggestion. */
  overrides?: { name?: string; launchCommand?: string; port?: number; url?: string }
  description?: string
  capabilities?: string[]
  /**
   * Whether a folder is already a library tool (canonical comparison). A
   * registered folder is never staged, and any draft left for one is dropped.
   */
  isRegistered?: (projectPath: string) => boolean
}

/** Why stage() refused. `code` mirrors register outcomes where one exists. */
export class DraftStageError extends Error {
  constructor(
    readonly code: 'invalid_folder' | 'already_registered',
    message: string,
  ) {
    super(message)
    this.name = 'DraftStageError'
  }
}

/** Fields an agent is allowed to see again. No env values exist on the record. */
export function publicToolDraft(draft: StagedToolDraft) {
  return {
    id: draft.id,
    status: 'pending' as const,
    name: draft.name,
    projectPath: draft.projectPath,
    launchCommand: maskSecrets(maskCommandEnvPrefix(draft.launchCommand)),
    port: draft.port,
    url: draft.url,
    description: draft.description,
    capabilities: draft.capabilities,
    envKeys: draft.envKeys,
    client: draft.client,
    createdAt: draft.createdAt,
    updatedAt: draft.updatedAt,
  }
}

function cleanText(value: string | undefined, max: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const clean = stripInvisibleChars(value).replace(/\s+/g, ' ').trim()
  return clean ? clean.slice(0, max) : undefined
}

function cleanCapabilities(values: string[] | undefined): string[] | undefined {
  if (!Array.isArray(values)) return undefined
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    const clean = cleanText(value, MAX_CAPABILITY_CHARS)
    if (!clean || seen.has(clean.toLowerCase())) continue
    seen.add(clean.toLowerCase())
    out.push(clean)
    if (out.length >= MAX_CAPABILITIES) break
  }
  return out.length ? out : undefined
}

/**
 * The folder as it really is on disk: symlinks resolved and, on macOS, the
 * stored case (realpath.native). Throws DraftStageError for anything that
 * is not an existing directory.
 */
function realFolder(projectPath: string): string {
  const resolved = path.resolve(projectPath.trim())
  let real: string
  try {
    real = fs.realpathSync.native(resolved)
  } catch {
    throw new DraftStageError('invalid_folder', `Folder not found: ${resolved}`)
  }
  let stat: fs.Stats
  try {
    stat = fs.statSync(real)
  } catch {
    throw new DraftStageError('invalid_folder', `Folder not found: ${resolved}`)
  }
  if (!stat.isDirectory()) {
    throw new DraftStageError('invalid_folder', `Not a folder: ${resolved}`)
  }
  return real
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

  list(): StagedToolDraft[] {
    return this.read().drafts.slice().sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
  }

  get(id: string): StagedToolDraft | undefined {
    return this.read().drafts.find((draft) => draft.id === id)
  }

  /** The pending draft for a folder, compared the way stage() dedupes. */
  findByProjectPath(projectPath: string): StagedToolDraft | undefined {
    const key = canonicalFolderKey(projectPath)
    return this.read().drafts.find((draft) => canonicalFolderKey(draft.projectPath) === key)
  }

  /**
   * One draft per folder. A second registration from an agent refreshes the
   * same card instead of stacking duplicates. The folder must exist; symlinked
   * or different-case spellings of one folder share a card, and a folder that
   * is already a library tool is refused (it updates in place instead).
   */
  stage(input: StageToolDraftInput): StagedToolDraft {
    const projectPath = realFolder(input.projectPath)
    const key = canonicalFolderKey(projectPath)
    return withFileLockSync(this.filePath, () => {
      const data = this.read()
      // Housekeeping at staging time: a folder that became a library tool by
      // any path (accept, GUI add, register) must not keep a stale card.
      const isRegistered = input.isRegistered
      const live = isRegistered
        ? data.drafts.filter((draft) => !isRegistered(draft.projectPath))
        : data.drafts
      if (isRegistered?.(projectPath)) {
        if (live.length !== data.drafts.length) this.write({ version: 1, drafts: live })
        throw new DraftStageError(
          'already_registered',
          'That folder is already in the Shelf library. It updates in place; nothing was staged.',
        )
      }
      const now = new Date().toISOString()
      const existing = live.find((draft) => canonicalFolderKey(draft.projectPath) === key)
      const overrides = input.overrides || {}
      const description = cleanText(input.description, MAX_DESCRIPTION_CHARS)
      const capabilities = cleanCapabilities(input.capabilities)
      const draft: StagedToolDraft = {
        id: existing?.id || randomUUID(),
        projectPath,
        name:
          cleanText(overrides.name, MAX_NAME_CHARS) ||
          cleanText(input.suggestion.name, MAX_NAME_CHARS) ||
          path.basename(projectPath),
        launchCommand: (overrides.launchCommand?.trim() || input.suggestion.launchCommand || '').slice(
          0,
          MAX_COMMAND_CHARS,
        ),
        port: overrides.port ?? input.suggestion.port,
        url: overrides.url || input.suggestion.url,
        envKeys: Array.from(
          new Set(input.envKeys.filter((key) => /^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(key))),
        ).slice(0, 40),
        // Self-reported by the MCP client and shown as "From" on the sheet.
        client: cleanText(input.client, MAX_CLIENT_CHARS),
        ...(description ? { description } : {}),
        ...(capabilities ? { capabilities } : {}),
        createdAt: existing?.createdAt || now,
        updatedAt: now,
      }
      const next = [draft, ...live.filter((item) => item.id !== draft.id)].slice(0, MAX_DRAFTS)
      this.write({ version: 1, drafts: next })
      return draft
    })
  }

  /** Drop drafts whose folder is already a library tool. Returns how many went. */
  pruneRegistered(isRegistered: (projectPath: string) => boolean): number {
    return withFileLockSync(this.filePath, () => {
      const data = this.read()
      const live = data.drafts.filter((draft) => !isRegistered(draft.projectPath))
      const removed = data.drafts.length - live.length
      if (removed > 0) this.write({ version: 1, drafts: live })
      return removed
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
      // Shown on the sheet as well; a hand-edited file can hold any shape.
      ...(typeof draft.description === 'string' && draft.description ? { description: draft.description } : {}),
      ...(Array.isArray(draft.capabilities)
        ? { capabilities: draft.capabilities.filter((capability): capability is string => typeof capability === 'string') }
        : {}),
    },
  })
  if (result.outcome !== 'invalid_folder') drafts.delete(id)
  return result
}
