/**
 * Adopt verified Shelf listeners (MCP / other ProcessManager) — by configured
 * port when one exists, else by live run receipt for portless tools.
 */
import type { LibraryStore } from './library-store'
import { findPortOccupants } from './ports'
import type { ProcessRuntimeSupport } from './process-runtime-support'
import type { RunReceipt } from './types'

export interface ExternalOwner {
  ownerPid: number
  receiptId: string
  receiptPort?: number
}

export async function reconcileExternalTool(
  toolId: string,
  opts: {
    store: LibraryStore
    runtime: ProcessRuntimeSupport
    isLocallyManaged: (toolId: string) => boolean
    trustedExternalOwner: (
      toolId: string,
      port: number,
      occupants: number[],
    ) => Promise<ExternalOwner | null>
    findActiveReceipt: (toolId: string) => RunReceipt | undefined
  },
): Promise<void> {
  if (opts.isLocallyManaged(toolId)) return
  const tool = opts.store.get(toolId)
  if (!tool) return

  const current = opts.runtime.peekState(toolId)
  // Don't interrupt an in-flight local start.
  if (current.status === 'starting') return

  // Portless tools: a live receipt from another Shelf process is the proof.
  if (!tool.port) {
    const receipt = opts.findActiveReceipt(toolId)
    if (receipt?.pid) {
      if (current.status !== 'running' || current.pid !== receipt.pid) {
        opts.runtime.setState(toolId, {
          toolId,
          status: 'running',
          pid: receipt.pid,
          message: `Running · pid ${receipt.pid} (external)`,
        })
      }
    } else if (
      current.status === 'running' &&
      (current.message || '').includes('external')
    ) {
      opts.runtime.setState(toolId, {
        toolId,
        status: 'stopped',
        message: 'Stopped (external process exited)',
      })
    }
    return
  }

  const occupants = await findPortOccupants(tool.port)
  if (occupants.length > 0) {
    const owner = await opts.trustedExternalOwner(toolId, tool.port, occupants)
    if (!owner) {
      if (current.status === 'running' && (current.message || '').includes('external')) {
        opts.runtime.setState(toolId, {
          toolId,
          status: 'stopped',
          message: `Port ${tool.port} is in use by another process`,
        })
      }
      return
    }
    if (current.status !== 'running' || current.pid !== owner.ownerPid) {
      opts.runtime.setState(toolId, {
        toolId,
        status: 'running',
        pid: owner.ownerPid,
        message: `Running · port ${tool.port} (external)`,
      })
    }
    return
  }

  // Clear stale external-running badges when the listener is gone.
  if (current.status === 'running' && (current.message || '').includes('external')) {
    opts.runtime.setState(toolId, {
      toolId,
      status: 'stopped',
      message: 'Stopped (external process exited)',
    })
  }
}
