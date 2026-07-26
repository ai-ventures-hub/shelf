/**
 * Adopt verified Shelf listeners (MCP / other ProcessManager) by configured port.
 */
import type { LibraryStore } from './library-store'
import { findPortOccupant } from './ports'
import type { ProcessRuntimeSupport } from './process-runtime-support'

export async function reconcileExternalTool(
  toolId: string,
  opts: {
    store: LibraryStore
    runtime: ProcessRuntimeSupport
    isLocallyManaged: (toolId: string) => boolean
    trustedExternalPgid: (
      toolId: string,
      port: number,
      occupantPid: number,
    ) => Promise<number | null>
  },
): Promise<void> {
  if (opts.isLocallyManaged(toolId)) return
  const tool = opts.store.get(toolId)
  if (!tool?.port) return

  const current = opts.runtime.peekState(toolId)
  // Don't interrupt an in-flight local start.
  if (current.status === 'starting') return

  const occupant = await findPortOccupant(tool.port)
  if (occupant) {
    const pgid = await opts.trustedExternalPgid(toolId, tool.port, occupant)
    if (!pgid) {
      if (current.status === 'running' && (current.message || '').includes('external')) {
        opts.runtime.setState(toolId, {
          toolId,
          status: 'stopped',
          message: `Port ${tool.port} is in use by another process`,
        })
      }
      return
    }
    if (current.status !== 'running' || current.pid !== pgid) {
      opts.runtime.setState(toolId, {
        toolId,
        status: 'running',
        pid: pgid,
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
