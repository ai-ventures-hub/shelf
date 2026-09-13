/** Port-conflict decisions. Callers serialize library writes before entering. */
import type { LaunchOrigin, PortConflictPolicy, Tool, ToolRuntimeState } from './contracts'
import { remedyFor } from './launch-diagnostics'
import type { LibraryStore } from './library-store'
import { findFreePort, findPortOccupants, urlForPort, withForcedPort } from './ports'
import type { ExternalOwner } from './process-reconcile'
import type { ProcessRuntimeSupport } from './process-runtime-support'

interface PortPolicyDependencies {
  store: LibraryStore
  runtime: ProcessRuntimeSupport
  trustedExternalOwner: (id: string, port: number, occupants: number[]) => Promise<ExternalOwner | null>
}

export async function resolvePortConflict(
  deps: PortPolicyDependencies,
  tool: Tool,
  onPortConflict: PortConflictPolicy,
  origin?: LaunchOrigin,
): Promise<{ tool: Tool; state?: ToolRuntimeState; reassignedFrom?: number }> {
  const toolId = tool.id
  const port = tool.port as number
  const occupants = await findPortOccupants(port)
  if (occupants.length === 0) return { tool }

  {
    const owner = await deps.trustedExternalOwner(toolId, port, occupants)
    if (owner) {
      deps.runtime.appendLog(
        toolId,
        'system',
        `Adopted Shelf process on port ${port} (owner pid ${owner.ownerPid}).`,
      )
      return {
        tool,
        state: deps.runtime.setState(toolId, {
          toolId,
          status: 'running',
          pid: owner.ownerPid,
          message: `Running · port ${port} (external)`,
          port,
          origin: 'external',
          startedBy: owner.startedBy,
        }),
      }
    }

  }
  if (onPortConflict !== 'reassign') {
    const message = `Port ${port} is already in use by another process.`
    deps.runtime.emitFailedReceipt({
      toolId,
      toolName: tool.name,
      launchCommand: tool.launchCommand,
      port,
      url: tool.url,
      message,
      startedBy: origin,
    })
    return {
      tool,
      state: deps.runtime.setState(toolId, {
        toolId,
        status: 'error',
        message,
        code: 'port_in_use',
        remedy: remedyFor('port_in_use'),
      }),
    }
  }

  // Pick a free port and persist so GUI + future launches stay aligned.
  const previousPort = port
  const free = await findFreePort({ preferred: previousPort, from: 3000, to: 4999 })
  const nextPort = free.port
  const nextLaunch = withForcedPort(tool.launchCommand, nextPort)
  const nextUrl = urlForPort(tool.url, nextPort)
  const saved = deps.store.patch(toolId, {
    port: nextPort,
    url: nextUrl,
    launchCommand: nextLaunch,
    env: { ...(tool.env || {}), PORT: String(nextPort) },
  }, tool.updatedAt)
  return { tool: saved, reassignedFrom: previousPort }
}
