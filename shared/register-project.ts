/**
 * One-shot project registration: inspect → gate → save → (consented) setup →
 * launch. Shared by the Electron GUI and the MCP server so both produce
 * identical library entries. Never throws for expected failures — every path
 * returns a structured result the caller maps to UI copy or MCP output.
 */
import fs from 'node:fs'
import path from 'node:path'
import type { LibraryStore } from './library-store'
import { inspectProject } from './project-import'
import {
  detectBootstrapNeeds,
  runBootstrap,
  type BootstrapResult,
  type BootstrapStep,
} from './project-bootstrap'
import {
  checkDockerDaemon,
  preflightProject,
  usesDocker,
  type PreflightIssue,
} from './launch-preflight'
import type { PortConflictPolicy, ProcessManager } from './process-manager'
import type { ProjectImportSuggestion, Tool, ToolRuntimeState } from './types'

export type RegisterOutcome =
  /** Saved and running; url (when known) is on the tool. */
  | 'launched'
  /** Saved; launch skipped because autoLaunch was false. */
  | 'saved'
  /** Saved; needs dependency install / Docker before it can run. */
  | 'needs_setup'
  /** Saved as a draft; detection was not confident enough to auto-run. */
  | 'saved_needs_review'
  /** Saved; launch (or consented setup) was attempted and failed. */
  | 'saved_launch_failed'
  /** Nothing saved; the folder does not exist or is not a directory. */
  | 'invalid_folder'
  /** Nothing saved; inspection-only run (dryRun). */
  | 'dry_run'

export interface RegisterProjectOptions {
  /** Launch after saving (default true). */
  autoLaunch?: boolean
  /** Default 'reassign' — the one-shot flow heals port conflicts silently. */
  onPortConflict?: PortConflictPolicy
  /** Force the review outcome even at high confidence. */
  forceReview?: boolean
  /**
   * Consent to run detected setup steps (package install). Without it,
   * setup needs surface as 'needs_setup' and nothing is executed.
   */
  runSetup?: boolean
  /** Inspect and gate only; save nothing, launch nothing. */
  dryRun?: boolean
  /** Icon defaults applied to newly created tools (GUI passes prefs). */
  toolDefaults?: Partial<
    Pick<Tool, 'iconLucide' | 'iconColor' | 'iconBackground'>
  >
}

export interface RegisterProjectDeps {
  store: LibraryStore
  processes: ProcessManager
}

export interface RegisterProjectResult {
  outcome: RegisterOutcome
  /** Saved tool (present for every outcome that persisted). */
  tool?: Tool
  /** Runtime state after a launch attempt. */
  state?: ToolRuntimeState
  /** Raw inspection result (Developer Mode shows this in full). */
  suggestion?: ProjectImportSuggestion
  /** Whether the gate allowed auto-run, and why. */
  autoRunnable: boolean
  autoRunReason: string
  /** Detected setup steps (empty when none). */
  setupNeeds: BootstrapStep[]
  /** Results of consented setup runs, in order. */
  bootstrap?: { step: BootstrapStep; result: BootstrapResult }[]
  /** Preflight problems in plain language. */
  issues: PreflightIssue[]
  /** True when a new library entry was created (vs updating an existing one). */
  created: boolean
}

/** The one Python hint that means "the launch command is a guess". */
const UNCERTAIN_HINT = /confirm the launch command/i

function gate(suggestion: ProjectImportSuggestion): {
  autoRunnable: boolean
  reason: string
} {
  if (!suggestion.launchCommand) {
    return { autoRunnable: false, reason: 'No launch command detected.' }
  }
  if (suggestion.notesHint && UNCERTAIN_HINT.test(suggestion.notesHint)) {
    return {
      autoRunnable: false,
      reason: 'Detected launch command is a guess that needs confirmation.',
    }
  }
  if (suggestion.confidence === 'high') {
    return { autoRunnable: true, reason: 'High-confidence detection.' }
  }
  if (suggestion.confidence === 'medium') {
    return {
      autoRunnable: true,
      reason:
        'Medium-confidence detection; launch failures fall back to guided fixes.',
    }
  }
  return { autoRunnable: false, reason: 'Low-confidence detection.' }
}

/** Fill only fields the existing entry left empty; never clobber user edits. */
function mergeIntoExisting(
  existing: Tool,
  suggestion: ProjectImportSuggestion,
): Tool {
  return {
    ...existing,
    description: existing.description || suggestion.description,
    launchCommand: existing.launchCommand || suggestion.launchCommand || '',
    url: existing.url || suggestion.url,
    port: existing.port ?? suggestion.port,
    tags: existing.tags.length > 0 ? existing.tags : suggestion.tags,
    agentAccess:
      existing.agentAccess.length > 0
        ? existing.agentAccess
        : suggestion.agentAccess,
    notes: existing.notes || suggestion.notesHint,
  }
}

function newToolFrom(
  suggestion: ProjectImportSuggestion,
  resolved: string,
  defaults: RegisterProjectOptions['toolDefaults'],
): Tool {
  const now = new Date().toISOString()
  return {
    id: '',
    name: suggestion.name?.trim() || path.basename(resolved),
    description: suggestion.description,
    iconLucide: defaults?.iconLucide,
    iconColor: defaults?.iconColor,
    iconBackground: defaults?.iconBackground,
    tags: suggestion.tags,
    capabilities: [],
    agentAccess: suggestion.agentAccess,
    favorite: false,
    projectPath: resolved,
    launchCommand: suggestion.launchCommand || '',
    url: suggestion.url,
    port: suggestion.port,
    notes: suggestion.notesHint,
    createdAt: now,
    updatedAt: now,
  }
}

export async function registerProject(
  projectPath: string,
  deps: RegisterProjectDeps,
  options: RegisterProjectOptions = {},
): Promise<RegisterProjectResult> {
  const autoLaunch = options.autoLaunch ?? true
  const onPortConflict = options.onPortConflict ?? 'reassign'
  const resolved = path.resolve(projectPath.trim())

  let stat: fs.Stats | undefined
  try {
    stat = fs.statSync(resolved)
  } catch {
    stat = undefined
  }
  if (!stat?.isDirectory()) {
    return {
      outcome: 'invalid_folder',
      autoRunnable: false,
      autoRunReason: 'Folder not found.',
      setupNeeds: [],
      issues: [
        {
          code: 'folder_missing',
          message: "Shelf can't find that folder.",
        },
      ],
      created: false,
    }
  }

  const suggestion = await inspectProject(resolved)
  const existing = deps.store.findByProjectPath(resolved)
  const gateResult = existing?.launchCommand
    ? {
        autoRunnable: true,
        reason: 'Already registered with a saved launch command.',
      }
    : gate(suggestion)

  const setupNeeds = detectBootstrapNeeds(resolved)
  const launchCommand =
    existing?.launchCommand || suggestion.launchCommand || ''
  const issues: PreflightIssue[] = preflightProject(resolved, launchCommand)
  if (usesDocker(launchCommand)) {
    const docker = await checkDockerDaemon()
    if (docker) issues.push(docker)
  }

  if (options.dryRun) {
    return {
      outcome: 'dry_run',
      suggestion,
      autoRunnable: gateResult.autoRunnable,
      autoRunReason: gateResult.reason,
      setupNeeds,
      issues,
      created: false,
    }
  }

  const tool = deps.store.save(
    existing
      ? mergeIntoExisting(existing, suggestion)
      : newToolFrom(suggestion, resolved, options.toolDefaults),
  )
  const base = {
    tool,
    suggestion,
    autoRunnable: gateResult.autoRunnable,
    autoRunReason: gateResult.reason,
    setupNeeds,
    issues,
    created: !existing,
  }

  if (!gateResult.autoRunnable || options.forceReview) {
    return { outcome: 'saved_needs_review', ...base }
  }

  // Setup gate: docker-down is not something we can consent-fix; report it.
  if (issues.some((i) => i.code === 'docker_not_running')) {
    return { outcome: 'needs_setup', ...base }
  }

  if (setupNeeds.length > 0) {
    if (!options.runSetup) {
      return { outcome: 'needs_setup', ...base }
    }
    const bootstrap: { step: BootstrapStep; result: BootstrapResult }[] = []
    for (const step of setupNeeds) {
      deps.processes.appendLog(tool.id, 'system', `Setup: ${step.command}`)
      const result = await runBootstrap(step, {
        cwd: resolved,
        onLog: (stream, text) => deps.processes.appendLog(tool.id, stream, text),
      })
      bootstrap.push({ step, result })
      if (!result.ok) {
        deps.processes.appendLog(
          tool.id,
          'system',
          `Setup failed: ${step.command} (${
            result.endedBy || `exit ${result.exitCode}`
          })`,
        )
        return { outcome: 'saved_launch_failed', ...base, bootstrap }
      }
      deps.processes.appendLog(tool.id, 'system', `Setup complete: ${step.command}`)
    }
    base.issues = issues.filter((i) => i.code !== 'deps_missing')
    if (!autoLaunch) return { outcome: 'saved', ...base, bootstrap }
    const state = await deps.processes.start(tool.id, { onPortConflict })
    return {
      outcome: state.status === 'running' ? 'launched' : 'saved_launch_failed',
      ...base,
      bootstrap,
      state,
      tool: deps.store.get(tool.id) || tool,
    }
  }

  if (!autoLaunch) {
    return { outcome: 'saved', ...base }
  }

  const state = await deps.processes.start(tool.id, { onPortConflict })
  return {
    outcome: state.status === 'running' ? 'launched' : 'saved_launch_failed',
    ...base,
    state,
    // Launch may have healed port/url — return the persisted record.
    tool: deps.store.get(tool.id) || tool,
  }
}
