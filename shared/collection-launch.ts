export type { CollectionActionResult, CollectionToolOutcome, CollectionToolResult } from './contracts'
import type { CollectionActionResult, CollectionToolOutcome, CollectionToolResult } from './contracts'
/**
 * Start/stop every member of a collection ("stack"). Launches run concurrently
 * with a small stagger — the per-tool in-flight mutex and the library write
 * queue in ProcessManager make that safe — so wall clock tracks the slowest
 * tool, not the sum. Already-running members are never restarted.
 */
import type { LibraryStore } from './library-store'
import { missingEnvKeys } from './stack-contract'
import { sleep } from './process-lifecycle'
import type { ProcessManager, StartOptions } from './process-manager'
import type { Collection } from './types'

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
  if (collection.stack?.ordered) return startOrdered(collection, deps, options)
  return startConcurrent(collection, deps, options)
}

/**
 * Original stack start. Members launch together, staggered only enough to
 * keep the per-tool mutex from serializing the whole collection.
 */
async function startConcurrent(
  collection: Collection,
  deps: CollectionDeps,
  options: StartOptions,
): Promise<CollectionActionResult> {
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
    collectionId: collection.id,
    name: collection.name,
    results: await Promise.all(pending),
  }
}

/**
 * Contract start. Await each member so its port wait (inside ProcessManager)
 * finishes before the next command. Missing env key names block the step
 * and everything after it. No command is spawned for a blocked member.
 */
async function startOrdered(
  collection: Collection,
  deps: CollectionDeps,
  options: StartOptions,
): Promise<CollectionActionResult> {
  const results: CollectionToolResult[] = []
  let stopped = false
  for (const toolId of collection.toolIds) {
    const tool = deps.store.get(toolId)
    if (!tool) continue
    if (stopped) {
      results.push({
        toolId,
        name: tool.name,
        outcome: 'skipped',
        message: 'Stopped after an earlier step.',
      })
      continue
    }
    const current = await deps.processes.getState(toolId)
    if (current.status === 'running' || current.status === 'starting') {
      results.push({
        toolId,
        name: tool.name,
        outcome: 'already_running',
        state: current,
      })
      continue
    }
    const missing = missingEnvKeys(tool, keysFor(collection, toolId))
    if (missing.length > 0) {
      stopped = true
      results.push({
        toolId,
        name: tool.name,
        outcome: 'blocked',
        message: `Missing env: ${missing.join(', ')}`,
      })
      continue
    }
    const state = await deps.processes.start(toolId, options)
    const outcome: CollectionToolOutcome = state.status === 'running' ? 'started' : 'failed'
    if (outcome === 'failed') stopped = true
    results.push({
      toolId,
      name: tool.name,
      outcome,
      state,
      message: outcome === 'started' && tool.port ? `Port ${state.port ?? tool.port} accepted.` : state.message,
    })
  }
  return { collectionId: collection.id, name: collection.name, results }
}

function keysFor(collection: Collection, toolId: string): string[] | undefined {
  return collection.stack?.steps.find((step) => step.toolId === toolId)?.requireEnvKeys
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
