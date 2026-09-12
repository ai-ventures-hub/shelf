export type { BootstrapResult, BootstrapStep } from './contracts'
import type { BootstrapResult, BootstrapStep } from './contracts'
/**
 * One-time project setup (dependency install) with explicit caller consent.
 * detectBootstrapNeeds is pure; runBootstrap streams output, enforces a hard
 * timeout, never uses sudo, and is cancellable. The engine NEVER installs
 * silently — the GUI asks the user, the MCP tool requires runSetup: true.
 */
import { spawnLoginShell, terminateProcess } from './process-lifecycle'
import { projectInstallCommands, readProjectFacts, type ProjectFacts } from './project-facts'

export const BOOTSTRAP_TIMEOUT_MS = 600_000

/** Missing setup steps use the same project facts as import and preflight. */
export function detectBootstrapNeeds(projectPath: string, observed?: ProjectFacts): BootstrapStep[] {
  return projectInstallCommands(observed ?? readProjectFacts(projectPath), 'missing').map((command) => ({
    command,
    label: command.includes('requirements.txt') ? 'Set up this project’s Python environment' : 'Install this project’s packages',
  }))
}

/**
 * Run one bootstrap step from the project folder, streaming each output line
 * to onLog (the caller usually pipes into the tool's log buffer so the
 * LogPanel shows install progress live).
 */
export function runBootstrap(
  step: BootstrapStep,
  opts: {
    cwd: string
    onLog?: (stream: 'stdout' | 'stderr', text: string) => void
    timeoutMs?: number
    signal?: AbortSignal
  },
): Promise<BootstrapResult> {
  const timeoutMs = opts.timeoutMs ?? BOOTSTRAP_TIMEOUT_MS
  return new Promise((resolve) => {
    const child = spawnLoginShell(step.command, { cwd: opts.cwd })
    const managed = {
      child,
      pgid: typeof child.pid === 'number' ? child.pid : undefined,
    }
    let endedBy: BootstrapResult['endedBy']
    let settled = false

    const timer = setTimeout(() => {
      endedBy = 'timeout'
      void terminateProcess(managed).catch((err: unknown) => {
        opts.onLog?.('stderr', `Setup cleanup failed: ${err instanceof Error ? err.message : String(err)}\n`)
        settle(null)
      })
    }, timeoutMs)

    const onAbort = () => {
      endedBy = 'cancelled'
      void terminateProcess(managed).catch((err: unknown) => {
        opts.onLog?.('stderr', `Setup cleanup failed: ${err instanceof Error ? err.message : String(err)}\n`)
        settle(null)
      })
    }
    opts.signal?.addEventListener('abort', onAbort, { once: true })

    child.stdout?.on('data', (buf: Buffer) => {
      opts.onLog?.('stdout', buf.toString('utf8'))
    })
    child.stderr?.on('data', (buf: Buffer) => {
      opts.onLog?.('stderr', buf.toString('utf8'))
    })

    const settle = (exitCode: number | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      opts.signal?.removeEventListener('abort', onAbort)
      resolve({ ok: exitCode === 0 && !endedBy, exitCode, endedBy })
    }

    child.on('error', () => settle(null))
    child.on('exit', (code) => settle(code))
  })
}
