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
  opts: { listening: Set<number>; state?: ToolRuntimeState },
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
    problems.push(`Port ${tool.port} is in use by another process.`)
  }
  return { toolId: tool.id, launchable: problems.length === 0, problems }
}

export async function deriveLibraryHealth(
  tools: Tool[],
  states: ToolRuntimeState[],
): Promise<ToolHealth[]> {
  const listening = await listListeningPorts()
  const byId = new Map(states.map((state) => [state.toolId, state]))
  return tools.map((tool) => deriveToolHealth(tool, { listening, state: byId.get(tool.id) }))
}
