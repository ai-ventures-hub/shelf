/**
 * Launch / stop / status / logs. A launch can legitimately take longer than
 * an MCP client's default 60s request timeout (the port wait alone is 60s),
 * so the handler answers with status "starting" after LAUNCH_WAIT_MS and the
 * launch keeps going in this server process; shelf_get_status waitForMs
 * picks it up from there.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { setTimeout as delay } from 'node:timers/promises'
import { z } from 'zod'
import {
  startCollection,
  stopCollection,
  type CollectionActionResult,
} from '../shared/collection-launch'
import type { LibraryStore } from '../shared/library-store'
import type { ProcessManager } from '../shared/process-manager'
import { maskCommandEnvPrefix, toolSecretValues } from '../shared/types'
import { formatLogLines, logTail, nextStepFor, stateWithHelp } from './output'
import {
  DESTRUCTIVE,
  READ_ONLY,
  RUNS_COMMANDS,
  errorResult,
  plainTextResult,
  textResult,
  toolNotFound,
} from './result'

/** Longest an MCP handler waits on a launch. Below the SDK's 60s default. */
export const MAX_WAIT_MS = 45_000

/**
 * SHELF_MCP_LAUNCH_WAIT_MS shortens the wait (smoke tests use a fixture
 * that never listens); it can never lengthen it past MAX_WAIT_MS.
 */
export const LAUNCH_WAIT_MS = (() => {
  const raw = Number(process.env.SHELF_MCP_LAUNCH_WAIT_MS)
  return Number.isFinite(raw) && raw > 0 ? Math.max(100, Math.min(raw, MAX_WAIT_MS)) : MAX_WAIT_MS
})()

export type Raced<T> = { done: true; value: T } | { done: false }

/**
 * Resolve with the work's result, or { done: false } once the wait elapses.
 * The work keeps running either way; a later rejection is swallowed here
 * (its state lands in ProcessManager, which get_status reads).
 */
export async function raceLaunchWait<T>(work: Promise<T>, waitMs = LAUNCH_WAIT_MS): Promise<Raced<T>> {
  const settled = work.then(
    (value) => ({ done: true as const, value }),
    (error: unknown) => ({ done: true as const, error }),
  )
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<{ done: false }>((resolve) => {
    timer = setTimeout(() => resolve({ done: false }), waitMs)
  })
  try {
    const outcome = await Promise.race([settled, timeout])
    if (outcome.done && 'error' in outcome) throw outcome.error
    return outcome as Raced<T>
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export function waitSeconds(ms = LAUNCH_WAIT_MS): string {
  return ms >= 1000 ? `${Math.round(ms / 1000)}s` : `${ms}ms`
}

interface LaunchHost {
  server: McpServer
  store: LibraryStore
  processes: ProcessManager
}

export function registerLaunchTools({ server, store, processes }: LaunchHost): void {
  function collectionSummary(result: CollectionActionResult) {
    const collection = store.getCollection(result.collectionId)
    const counts: Record<string, number> = {}
    const results = result.results.map((member) => {
      counts[member.outcome] = (counts[member.outcome] || 0) + 1
      const state = member.state
      const tool = store.get(member.toolId)
      const next = state ? nextStepFor(state) : undefined
      const tail =
        member.outcome === 'failed' && state?.status === 'error'
          ? logTail(tool, processes.getLogs(member.toolId))
          : undefined
      return {
        toolId: member.toolId,
        name: member.name,
        outcome: member.outcome,
        ...(state ? { status: state.status } : {}),
        ...(state?.port ? { port: state.port } : {}),
        ...(member.message || state?.message ? { message: member.message || state?.message } : {}),
        ...(state?.code ? { code: state.code } : {}),
        ...(next && member.outcome === 'failed' ? { next } : {}),
        ...(tail ? { logTail: tail } : {}),
      }
    })
    return {
      collectionId: result.collectionId,
      name: result.name,
      ordered: Boolean(collection?.stack?.ordered),
      counts,
      results,
    }
  }

  server.registerTool(
    'shelf_launch_tool',
    {
      description:
        'Launch a tool by id, or a collection by collectionId (in its launch order, with its env gates). Waits up to 45s; a slower start returns status "starting" and continues, so follow with shelf_get_status waitForMs. onPortConflict=reassign picks a free port.',
      inputSchema: {
        id: z.string().optional().describe('Tool id (or pass collectionId instead)'),
        collectionId: z.string().optional().describe('Start a whole collection instead of one tool'),
        onPortConflict: z
          .enum(['fail', 'reassign'])
          .optional()
          .describe('fail (default) refuses busy ports; reassign picks a free port and updates the entry'),
      },
      annotations: RUNS_COMMANDS,
    },
    async ({ id, collectionId, onPortConflict }) => {
      if (Boolean(id) === Boolean(collectionId)) {
        return errorResult('Pass exactly one of id (one tool) or collectionId (a collection).')
      }
      const policy = onPortConflict || 'fail'

      if (collectionId) {
        const collection = store.getCollection(collectionId)
        if (!collection) {
          return errorResult(
            `Collection not found: ${collectionId}. Call shelf_list_collections for ids.`,
          )
        }
        const raced = await raceLaunchWait(
          startCollection(collectionId, { store, processes }, { onPortConflict: policy }),
        )
        if (!raced.done) {
          return textResult({
            status: 'starting',
            collectionId,
            message: `Still starting after ${waitSeconds()}. Members keep launching${collection.stack?.ordered ? ' in order' : ''} in the background.`,
            next: "Call shelf_get_collection with this id to see each member's status, or shelf_get_status with a member id and waitForMs.",
          })
        }
        return textResult(collectionSummary(raced.value))
      }

      const toolId = id!
      const before = store.get(toolId)
      if (!before) return toolNotFound(toolId)
      const previousPort = before.port
      const raced = await raceLaunchWait(processes.start(toolId, { onPortConflict: policy }))
      if (!raced.done) {
        return textResult({
          status: 'starting',
          state: processes.peekState(toolId),
          message: `Still starting after ${waitSeconds()}. The launch continues in the background.`,
          next: 'Call shelf_get_status with this id and waitForMs (up to 45000) to wait for running or error.',
        })
      }
      const state = raced.value
      const after = store.get(toolId)
      const reassigned =
        previousPort && after?.port && after.port !== previousPort && state.status === 'running'
          ? { from: previousPort, to: after.port, url: after.url, launchCommand: maskCommandEnvPrefix(after.launchCommand) }
          : undefined
      return textResult({
        status: state.status,
        ...stateWithHelp(state, after, () => processes.getLogs(toolId)),
        reassigned,
      })
    },
  )

  server.registerTool(
    'shelf_stop_tool',
    {
      description:
        'Stop a running tool by id, or every running member of a collection by collectionId. Listeners Shelf did not start are left alone.',
      inputSchema: {
        id: z.string().optional().describe('Tool id (or pass collectionId instead)'),
        collectionId: z.string().optional().describe('Stop a whole collection instead of one tool'),
      },
      annotations: DESTRUCTIVE,
    },
    async ({ id, collectionId }) => {
      if (Boolean(id) === Boolean(collectionId)) {
        return errorResult('Pass exactly one of id (one tool) or collectionId (a collection).')
      }
      if (collectionId) {
        if (!store.getCollection(collectionId)) {
          return errorResult(
            `Collection not found: ${collectionId}. Call shelf_list_collections for ids.`,
          )
        }
        return textResult(collectionSummary(await stopCollection(collectionId, { store, processes })))
      }
      const tool = store.get(id!)
      if (!tool) return toolNotFound(id!)
      const state = await processes.stop(id!)
      return textResult(stateWithHelp(state, tool, () => processes.getLogs(id!)))
    },
  )

  server.registerTool(
    'shelf_get_status',
    {
      description:
        'Runtime status of a tool. Pass waitForMs (up to 45000) to wait while it is still starting.',
      inputSchema: {
        id: z.string().describe('Tool id'),
        waitForMs: z
          .number()
          .int()
          .min(0)
          .max(MAX_WAIT_MS)
          .optional()
          .describe('Poll until the tool leaves "starting" (or this many ms pass)'),
      },
      annotations: READ_ONLY,
    },
    async ({ id, waitForMs }) => {
      const tool = store.get(id)
      if (!tool) return toolNotFound(id)
      const started = Date.now()
      const deadline = started + Math.min(waitForMs ?? 0, MAX_WAIT_MS)
      let state = await processes.getState(id)
      while ((state.status === 'starting' || state.status === 'stopping') && Date.now() < deadline) {
        await delay(Math.min(500, Math.max(0, deadline - Date.now())))
        state = await processes.getState(id)
      }
      const stillStarting = state.status === 'starting'
      return textResult({
        ...stateWithHelp(state, store.get(id) || tool, () => processes.getLogs(id)),
        ...(waitForMs ? { waitedMs: Date.now() - started } : {}),
        ...(stillStarting
          ? { next: 'Still starting. Call again with waitForMs, or read shelf_get_logs.' }
          : {}),
      })
    },
  )

  server.registerTool(
    'shelf_get_logs',
    {
      description:
        'Output of a tool\'s current run, or an earlier one by runId (a receipt id; the last 5 are kept), as text: stderr lines start "! ", Shelf\'s own "# ". Secrets are masked.',
      inputSchema: {
        id: z.string().describe('Tool id'),
        runId: z.string().max(100).optional().describe('Receipt/run id; omit for the current run'),
        limit: z.number().int().positive().max(500).optional().describe('Max lines (default 100)'),
      },
      annotations: READ_ONLY,
    },
    async ({ id, runId, limit }) => {
      const tool = store.get(id)
      if (!tool) return toolNotFound(id)
      const lines = processes.getLogs(id, runId || undefined)
      if (runId && lines.length === 0) {
        return errorResult(
          `No retained output for run ${runId} of this tool. Shelf keeps the last 5 runs per tool; call shelf_list_receipts with this id for run ids.`,
        )
      }
      const capped = lines.slice(-(limit || 100))
      const run = runId || [...lines].reverse().find((line) => line.runId)?.runId
      const header = [
        `${tool.name} (${id})`,
        run ? `run ${run}` : null,
        `${capped.length}${lines.length > capped.length ? ` of ${lines.length}` : ''} lines`,
      ]
        .filter(Boolean)
        .join(' · ')
      const body = capped.length ? formatLogLines(capped) : '(no output captured)'
      return plainTextResult(`${header}\n${body}`, toolSecretValues(tool))
    },
  )
}
