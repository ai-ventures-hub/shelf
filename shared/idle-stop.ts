/**
 * Stop tools nobody is using. Shelf only knows about agent calls made through
 * its gateway; it cannot see a person using a tool in a browser. So the only
 * candidates are runs Shelf started by itself to serve an agent call, and a
 * run stops being one the moment the user launches, restarts, or takes it
 * over (ToolUseStore.claim).
 */
import type { UiPrefs } from './contracts'
import { clampIdleStopMinutes } from './prefs-store'
import type { ProcessManager } from './process-manager'
import type { ReceiptStore } from './receipt-store'
import type { ToolUseStore } from './tool-use-store'

export interface IdleStopDeps {
  processes: Pick<ProcessManager, 'stop'>
  receipts: Pick<ReceiptStore, 'get'>
  uses: ToolUseStore
  prefs: Pick<UiPrefs, 'idleStopEnabled' | 'idleStopMinutes'>
  /** Test hook: idle threshold in ms instead of the preference. */
  idleMs?: number
  now?: () => number
}

/** One pass. Returns the ids of tools it stopped. */
export async function sweepIdleTools(deps: IdleStopDeps): Promise<string[]> {
  if (!deps.prefs.idleStopEnabled) return []
  const minutes = clampIdleStopMinutes(deps.prefs.idleStopMinutes)
  const limit = deps.idleMs ?? minutes * 60_000
  const now = deps.now ?? Date.now
  const idle = (lastUsedAt: string) => now() - Date.parse(lastUsedAt) >= limit
  const stopped: string[] = []

  for (const [toolId, use] of Object.entries(deps.uses.all())) {
    if (!use.onDemandReceiptId) continue
    const receipt = deps.receipts.get(use.onDemandReceiptId)
    // The run ended some other way, or was never Shelf's own: nothing to stop.
    if (!receipt || receipt.endedAt || receipt.startedBy?.kind !== 'gateway') {
      deps.uses.claim(toolId)
      continue
    }
    if (!idle(use.lastUsedAt)) continue
    // Another process may have recorded a call, or the user taken the tool
    // over, since the list was read. A stop also cancels a start in flight
    // anywhere, so look again at the last moment.
    const fresh = deps.uses.get(toolId)
    if (!fresh?.onDemandReceiptId || fresh.onDemandReceiptId !== use.onDemandReceiptId || !idle(fresh.lastUsedAt)) continue
    const state = await deps.processes.stop(
      toolId,
      deps.idleMs === undefined
        ? `Stopped after ${minutes} minutes without agent use.`
        : 'Stopped after a while without agent use.',
    )
    if (state.status === 'stopped') {
      deps.uses.claim(toolId)
      stopped.push(toolId)
    }
  }
  return stopped
}
