/**
 * Classifies launch failures from captured logs into structured codes and
 * builds a paste-ready error report. Log lines are already secret-masked at
 * append time (ProcessRuntimeSupport), so reports are safe to copy.
 */
import type {
  LaunchErrorCode,
  LogLine,
  RemedyKind,
  Tool,
  ToolRuntimeState,
} from './types'
import { maskSecrets } from './types'

export interface LaunchFailureClassification {
  code: LaunchErrorCode
  /** Short extracted evidence (e.g. the missing command or module). */
  detail?: string
}

const REPORT_LOG_LINES = 30

/** Ordered: first match wins. Specific causes before the generic crash. */
const LOG_PATTERNS: {
  re: RegExp
  code: LaunchErrorCode
  detail?: (m: RegExpMatchArray) => string
}[] = [
  {
    re: /command not found:?\s+([\w./-]+)/i,
    code: 'runtime_missing',
    detail: (m) => m[1],
  },
  {
    re: /([\w./-]+):\s+No such file or directory/,
    code: 'bad_launch_command',
    detail: (m) => m[1],
  },
  {
    re: /Cannot find module\s+'?([^'\s]+)'?/,
    code: 'deps_missing',
    detail: (m) => m[1],
  },
  { re: /ERR_MODULE_NOT_FOUND/, code: 'deps_missing' },
  {
    re: /ModuleNotFoundError: No module named\s+'?([^'\s]+)'?/,
    code: 'deps_missing',
    detail: (m) => m[1],
  },
  {
    re: /ImportError: No module named\s+'?([^'\s]+)'?/,
    code: 'deps_missing',
    detail: (m) => m[1],
  },
  {
    re: /npm err!?\s+missing script:?\s+([\w:-]+)/i,
    code: 'bad_launch_command',
    detail: (m) => m[1],
  },
  { re: /Missing script:?\s+"?([\w:-]+)"?/i, code: 'bad_launch_command', detail: (m) => m[1] },
  { re: /EADDRINUSE|address already in use/i, code: 'port_in_use' },
  {
    re: /Cannot connect to the Docker daemon|docker daemon is not running|Is the docker daemon running/i,
    code: 'docker_not_running',
  },
]

const REMEDIES: Partial<Record<LaunchErrorCode, RemedyKind>> = {
  folder_missing: 'repick_folder',
  no_launch_command: 'edit_command',
  bad_launch_command: 'edit_command',
  deps_missing: 'install_deps',
  runtime_missing: 'install_runtime',
  docker_not_running: 'open_docker',
  port_in_use: 'reassign_port',
  port_reassign_failed: 'copy_ai_report',
  app_crashed: 'copy_ai_report',
  port_timeout: 'copy_ai_report',
}

export function remedyFor(code: LaunchErrorCode): RemedyKind | undefined {
  return REMEDIES[code]
}

/**
 * Inspect captured output for a known failure signature.
 * Falls back to app_crashed — callers decide the final message.
 */
export function classifyLaunchFailure(
  logs: LogLine[],
  fallback: LaunchErrorCode = 'app_crashed',
): LaunchFailureClassification {
  // Scan newest-first so the terminal error wins over startup noise.
  for (let i = logs.length - 1; i >= 0; i--) {
    const line = logs[i]
    if (line.stream === 'system') continue
    for (const pattern of LOG_PATTERNS) {
      const m = line.text.match(pattern.re)
      if (m) {
        return { code: pattern.code, detail: pattern.detail?.(m) }
      }
    }
  }
  return { code: fallback }
}

/**
 * Paste-ready failure report ("Copy report for your AI tool"). The audience
 * is the user's coding agent, so it leads with machine-usable facts.
 */
export function buildErrorReport(
  tool: Pick<Tool, 'name' | 'projectPath' | 'launchCommand' | 'port' | 'url'>,
  state: Pick<ToolRuntimeState, 'status' | 'message' | 'exitCode' | 'code'>,
  logs: LogLine[],
): string {
  const tail = logs
    .filter((l) => l.stream !== 'system')
    .slice(-REPORT_LOG_LINES)
    .map((l) => `[${l.stream}] ${l.text}`)
  const lines = [
    '## Shelf launch report',
    `Tool: ${tool.name}`,
    tool.projectPath ? `Project folder: ${tool.projectPath}` : null,
    // Masked like receipt-store does at write time: this payload is pasted
    // into agents verbatim, and launch commands carry inline KEY=value env.
    `Launch command: ${maskSecrets(tool.launchCommand)}`,
    tool.port ? `Expected port: ${tool.port}` : null,
    tool.url ? `Expected URL: ${tool.url}` : null,
    `Status: ${state.status}${state.code ? ` (${state.code})` : ''}`,
    state.message ? `Message: ${state.message}` : null,
    state.exitCode !== undefined && state.exitCode !== null
      ? `Exit code: ${state.exitCode}`
      : null,
    '',
    `### Last ${Math.min(tail.length, REPORT_LOG_LINES)} output lines (secrets masked)`,
    tail.length > 0 ? tail.join('\n') : '(no output captured)',
  ]
  return lines.filter((l) => l !== null).join('\n')
}
