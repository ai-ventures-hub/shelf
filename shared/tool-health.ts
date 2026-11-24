/**
 * Library-wide launchability checks behind the card health glyph.
 * Deliberately distinct from deriveToolReadiness: readiness describes the
 * agent setup state; health answers "will Launch work right now". One
 * lsof call covers every tool (see listListeningPorts).
 */
import fs from 'node:fs'
import { listListeningPorts } from './ports'
import type { Tool, ToolHealth, ToolRuntimeState } from './types'

export function deriveToolHealth(
  tool: Tool,
  opts: { listening: Set<number>; state?: ToolRuntimeState; portHolder?: string },
): ToolHealth {
  const problems: string[] = []
  if (tool.projectPath && !fs.existsSync(tool.projectPath)) {
    problems.push('Project folder is missing — moved or deleted?')
  }
  if (!tool.launchCommand?.trim()) {
    problems.push('No launch command is set.')
  }
  // A live tool legitimately occupies its own port; only flag squatters.
  const live = opts.state?.status === 'running' || opts.state?.status === 'starting'
  if (!live && tool.port && opts.listening.has(tool.port)) {
    problems.push(
      opts.portHolder
        ? `Port ${tool.port} is in use by ${opts.portHolder}, which has the same port.`
        : `Port ${tool.port} is in use by another process.`,
    )
  }
  return { toolId: tool.id, launchable: problems.length === 0, problems }
}

export async function deriveLibraryHealth(
  tools: Tool[],
  states: ToolRuntimeState[],
): Promise<ToolHealth[]> {
  const listening = await listListeningPorts()
  const byId = new Map(states.map((state) => [state.toolId, state]))
  // Two library tools on one port: name the one that is running.
  const liveByPort = new Map<number, Tool>()
  for (const tool of tools) {
    const status = byId.get(tool.id)?.status
    if (tool.port && (status === 'running' || status === 'starting')) liveByPort.set(tool.port, tool)
  }
  return tools.map((tool) => {
    const holder = tool.port ? liveByPort.get(tool.port) : undefined
    return deriveToolHealth(tool, {
      listening,
      state: byId.get(tool.id),
      portHolder: holder && holder.id !== tool.id ? holder.name : undefined,
    })
  })
}
