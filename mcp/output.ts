/**
 * Agent-facing shapes. List-style tools return compact rows (the full
 * readiness object is identical boilerplate on every tool); detail tools
 * (shelf_get_tool, shelf_check_tool_readiness) keep the full record.
 */
import { deriveToolReadiness } from '../shared/capability-intelligence'
import type {
  CapabilityReadinessState,
  LogLine,
  RemedyKind,
  Tool,
  ToolRuntimeState,
} from '../shared/types'
import { maskCommandEnvPrefix, maskSecrets, toolSecretValues } from '../shared/types'

export function accessKindsOf(tool: Tool): string[] {
  return Array.from(new Set(tool.agentAccess.map((access) => access.kind)))
}

/** One-word readiness plus launchable:false only when launching cannot work. */
export function compactReadiness(tool: Tool): {
  readiness: CapabilityReadinessState
  launchable?: false
} {
  const readiness = deriveToolReadiness(tool)
  return readiness.launchable
    ? { readiness: readiness.state }
    : { readiness: readiness.state, launchable: false }
}

/** A list row: identity, what it does, how to reach it, whether it runs. */
export function compactToolRow(tool: Tool, state: ToolRuntimeState) {
  const kinds = accessKindsOf(tool)
  return {
    id: tool.id,
    name: tool.name,
    ...(tool.tags.length ? { tags: tool.tags } : {}),
    ...(tool.capabilities.length ? { capabilities: tool.capabilities } : {}),
    ...(kinds.length ? { accessKinds: kinds } : {}),
    ...compactReadiness(tool),
    ...(tool.favorite ? { favorite: true } : {}),
    ...(tool.port ? { port: tool.port } : {}),
    ...(tool.url ? { url: tool.url } : {}),
    status: state.status,
    ...(state.status === 'error' && state.code ? { code: state.code } : {}),
  }
}

/**
 * Remedy kinds are GUI vocabulary (buttons in Shelf). Agents get the same
 * advice as something they can do with MCP tools or ask the user for.
 */
const REMEDY_NEXT: Record<RemedyKind, string> = {
  install_deps:
    "Dependencies look missing. Run the project's install command in its folder (or call shelf_register_project with runSetup: true), then launch again.",
  reassign_port:
    "The port is busy. Launch again with onPortConflict: 'reassign', or stop whatever holds the port.",
  open_docker: 'Docker is not running. Ask the user to start Docker Desktop, then launch again.',
  repick_folder:
    "The project folder is missing. Ask the user where it moved, then fix projectPath with shelf_upsert_tool (id + projectPath).",
  edit_command:
    'The launch command or its entry file is wrong. Check logTail / shelf_get_logs, then fix launchCommand with shelf_upsert_tool (id + launchCommand).',
  install_runtime:
    'A required runtime or CLI is not installed (see logTail). Ask the user to install it, then launch again.',
  copy_ai_report:
    'Read logTail (or shelf_get_logs) to diagnose, fix the project or its launch command, then launch again.',
}

export function nextStepFor(state: ToolRuntimeState): string | undefined {
  if (state.status !== 'error') return undefined
  if (state.remedy) return REMEDY_NEXT[state.remedy]
  if (state.code === 'tool_not_found') return 'Call shelf_list_tools for current ids.'
  if (state.code === 'stop_refused_not_owner') {
    return 'Something Shelf did not start holds this port; Shelf leaves it alone. Ask the user before stopping it.'
  }
  return 'Read logTail (or shelf_get_logs) to diagnose.'
}

const STREAM_PREFIX: Record<LogLine['stream'], string> = {
  stdout: '',
  stderr: '! ',
  system: '# ',
}

/** Lines as text: stdout plain, stderr "! ", Shelf's own lines "# ". */
export function formatLogLines(lines: LogLine[]): string {
  return lines
    .map((line) => {
      // Retained runs from before write-time command masking may carry a
      // raw lowercase `name=value` prefix on the "Launch:" line.
      const text =
        line.stream === 'system' && line.text.startsWith('Launch: ')
          ? `Launch: ${maskCommandEnvPrefix(line.text.slice('Launch: '.length))}`
          : line.text
      return `${STREAM_PREFIX[line.stream] ?? ''}${text}`
    })
    .join('\n')
}

/** Last output lines of a failed launch, masked, as text. */
export function logTail(tool: Tool | undefined, lines: LogLine[], count = 15): string | undefined {
  const tail = lines.filter((line) => line.stream !== 'system').slice(-count)
  if (tail.length === 0) return undefined
  return maskSecrets(formatLogLines(tail), toolSecretValues(tool))
}

/** State plus agent-actionable next step and output tail for failures. */
export function stateWithHelp(
  state: ToolRuntimeState,
  tool: Tool | undefined,
  logs: () => LogLine[],
) {
  const next = nextStepFor(state)
  const tail = state.status === 'error' ? logTail(tool, logs()) : undefined
  return {
    state,
    ...(next ? { next } : {}),
    ...(tail ? { logTail: tail } : {}),
  }
}
