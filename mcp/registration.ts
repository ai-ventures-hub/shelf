/**
 * Agent registration of project folders (2.1 policy): a folder already in the
 * library updates in place; a NEW folder is only staged as a draft the user
 * accepts in Shelf. shelf_register_project and shelf_upsert_tool both route
 * new folders through stageRegistration so neither can write library.json
 * for a folder the user has not accepted.
 */
import fs from 'node:fs'
import path from 'node:path'
import type { LibraryStore } from '../shared/library-store'
import { inspectProject } from '../shared/project-import'
import { canonicalFolderKey, findToolByFolder } from '../shared/register-project'
import {
  publicToolDraft,
  type StagedToolDraft,
  type ToolDraftStore,
} from '../shared/tool-draft-store'
import { readManifest } from '../shared/tool-manifest'
import type { ProjectImportSuggestion } from '../shared/types'
import { maskCommandEnvPrefix, maskSecrets } from '../shared/types'

export interface RegistrationHost {
  store: LibraryStore
  drafts: ToolDraftStore
  client: () => string | undefined
}

/** An existing directory, or why not. Symlinks are followed. */
export function checkFolder(projectPath: string): { ok: true; folder: string } | { ok: false; folder: string; reason: string } {
  const folder = path.resolve(projectPath.trim())
  try {
    if (fs.statSync(folder).isDirectory()) return { ok: true, folder }
    return { ok: false, folder, reason: 'That path is a file, not a folder.' }
  } catch {
    return { ok: false, folder, reason: "Shelf can't find that folder." }
  }
}

/** Same outcome name registerProject uses, so agents branch on one field. */
export function invalidFolderResult(folder: string, reason: string) {
  return {
    outcome: 'invalid_folder' as const,
    created: false,
    projectPath: folder,
    message: reason,
    next: 'Pass the absolute path of an existing project folder. Nothing was staged or saved.',
  }
}

/** Canonical keys of every registered folder, read once per request. */
export function registeredFolderCheck(store: LibraryStore): (projectPath: string) => boolean {
  const keys = new Set(
    store
      .list()
      .filter((tool) => tool.projectPath)
      .map((tool) => canonicalFolderKey(tool.projectPath!)),
  )
  return (projectPath) => keys.has(canonicalFolderKey(projectPath))
}

/**
 * Side-effect-free answer to "did the user accept it yet?": accepted (the
 * folder is a library tool), pending (a draft waits in Shelf), or none
 * (never staged, or the user rejected it).
 */
export function draftStatus(host: RegistrationHost, projectPath: string) {
  const tool = findToolByFolder(host.store, projectPath)
  if (tool) return { status: 'accepted' as const, toolId: tool.id }
  const draft = host.drafts.findByProjectPath(projectPath)
  if (draft) return { status: 'pending' as const, id: draft.id, updatedAt: draft.updatedAt }
  return { status: 'none' as const }
}

export function maskSuggestion(suggestion: ProjectImportSuggestion): ProjectImportSuggestion {
  const mask = (command: string) => maskSecrets(maskCommandEnvPrefix(command))
  return {
    ...suggestion,
    ...(suggestion.launchCommand ? { launchCommand: mask(suggestion.launchCommand) } : {}),
    launchAlternatives: suggestion.launchAlternatives.map((alt) => ({ ...alt, command: mask(alt.command) })),
  }
}

export interface StageInput {
  folder: string
  overrides?: { name?: string; launchCommand?: string; port?: number; url?: string }
  description?: string
  capabilities?: string[]
  /** Env KEY NAMES the agent mentioned (values are never staged). */
  envKeys?: string[]
}

export async function stageRegistration(
  host: RegistrationHost,
  input: StageInput,
): Promise<{ draft: StagedToolDraft; suggestion: ProjectImportSuggestion }> {
  const suggestion = await inspectProject(input.folder)
  let manifestKeys: string[] = []
  try {
    manifestKeys = Object.keys(readManifest(input.folder)?.manifest.env || {})
  } catch {
    manifestKeys = []
  }
  const draft = host.drafts.stage({
    projectPath: input.folder,
    suggestion,
    envKeys: [...manifestKeys, ...(input.envKeys || [])],
    client: host.client(),
    overrides: input.overrides,
    description: input.description,
    capabilities: input.capabilities,
    isRegistered: registeredFolderCheck(host.store),
  })
  return { draft, suggestion }
}

const CHECK_LATER =
  'To check without side effects, call shelf_register_project with this projectPath and dryRun: true. draft.status turns "accepted" (with toolId) once the user accepts. Calling it without dryRun would launch the accepted tool.'

/** The pending_consent response: the draft once, plus detection extras it lacks. */
export function pendingConsentResult(
  draft: StagedToolDraft,
  suggestion: ProjectImportSuggestion,
  extra: Record<string, unknown> = {},
) {
  const masked = maskSuggestion(suggestion)
  const detected = {
    confidence: masked.confidence,
    ...(masked.launchAlternatives.length ? { launchAlternatives: masked.launchAlternatives } : {}),
    ...(masked.tags.length ? { tags: masked.tags } : {}),
    ...(masked.agentAccess.length ? { agentAccess: masked.agentAccess } : {}),
    ...(masked.notesHint ? { notesHint: masked.notesHint } : {}),
    ...(masked.designMd.found ? { designMd: masked.designMd } : {}),
  }
  return {
    outcome: 'pending_consent' as const,
    created: false,
    draft: publicToolDraft(draft),
    detected,
    note: 'Staged in Shelf. Nothing was saved or launched. The user reviews the command, folder, port, and env key names, and accepts or rejects it there.',
    next: CHECK_LATER,
    ...extra,
  }
}
