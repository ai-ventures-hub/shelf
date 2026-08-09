/**
 * Start/stop every member of a collection ("stack"). Launches run concurrently
 * with a small stagger — the per-tool in-flight mutex and the library write
 * queue in ProcessManager make that safe — so wall clock tracks the slowest
 * tool, not the sum. Already-running members are never restarted.
 */
import type { LibraryStore } from './library-store'
import type { ProcessManager, StartOptions } from './process-manager'
import { sleep } from './process-lifecycle'
import type { ToolRuntimeState } from './types'

export type CollectionToolOutcome =
  | 'started'
  | 'already_running'
  | 'failed'
  | 'stopped'
  | 'not_running'
  /** Running listener Shelf does not own — left alone (stop_refused_not_owner). */
  | 'skipped_external'

export interface CollectionToolResult {
  toolId: string
  name: string
  outcome: CollectionToolOutcome
  state?: ToolRuntimeState
}

export interface CollectionActionResult {
  collectionId: string
  name: string
  results: CollectionToolResult[]
}

export interface CollectionDeps {
  store: LibraryStore
  processes: ProcessManager
}

const LAUNCH_STAGGER_MS = 250

export async function startCollection(
  collectionId: string,
  deps: CollectionDeps,
  options: StartOptions = {},
): Promise<CollectionActionResult> {
  const collection = deps.store.getCollection(collectionId)
  if (!collection) throw new Error(`Collection not found: ${collectionId}`)

  const pending: Array<Promise<CollectionToolResult>> = []
  let launched = 0
  for (const toolId of collection.toolIds) {
    const tool = deps.store.get(toolId)
    if (!tool) continue
    const current = await deps.processes.getState(toolId)
    if (current.status === 'running' || current.status === 'starting') {
      pending.push(
        Promise.resolve({
          toolId,
          name: tool.name,
          outcome: 'already_running' as const,
          state: current,
        }),
      )
      continue
    }
    if (launched > 0) await sleep(LAUNCH_STAGGER_MS)
    launched += 1
    pending.push(
      deps.processes.start(toolId, options).then((state) => ({
        toolId,
        name: tool.name,
        outcome: (state.status === 'running' ? 'started' : 'failed') as CollectionToolOutcome,
        state,
      })),
    )
  }

  return {
    collectionId,
    name: collection.name,
    results: await Promise.all(pending),
  }
}

export async function stopCollection(
  collectionId: string,
  deps: CollectionDeps,
): Promise<CollectionActionResult> {
  const collection = deps.store.getCollection(collectionId)
  if (!collection) throw new Error(`Collection not found: ${collectionId}`)

  const results: CollectionToolResult[] = []
  for (const toolId of collection.toolIds) {
    const tool = deps.store.get(toolId)
    if (!tool) continue
    const current = await deps.processes.getState(toolId)
    if (current.status !== 'running' && current.status !== 'starting') {
      results.push({ toolId, name: tool.name, outcome: 'not_running', state: current })
      continue
    }
    const state = await deps.processes.stop(toolId)
    const outcome: CollectionToolOutcome =
      state.code === 'stop_refused_not_owner'
        ? 'skipped_external'
        : state.status === 'stopped'
          ? 'stopped'
          : 'failed'
    results.push({ toolId, name: tool.name, outcome, state })
  }

  return { collectionId, name: collection.name, results }
}
