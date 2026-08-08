/**
 * One-time project setup (dependency install) with explicit caller consent.
 * detectBootstrapNeeds is pure; runBootstrap streams output, enforces a hard
 * timeout, never uses sudo, and is cancellable. The engine NEVER installs
 * silently — the GUI asks the user, the MCP tool requires runSetup: true.
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawnLoginShell, terminateProcess } from './process-lifecycle'

export interface BootstrapStep {
  /** Shell command run from the project folder (login zsh, no sudo). */
  command: string
  /** Plain-language description shown in the consent prompt. */
  label: string
}

export interface BootstrapResult {
  ok: boolean
  exitCode: number | null
  /** 'timeout' | 'cancelled' | undefined on natural exit. */
  endedBy?: 'timeout' | 'cancelled'
}

export const BOOTSTRAP_TIMEOUT_MS = 600_000

/** Dependency-less package.json (fixtures, tiny scripts) needs no install. */
function declaresNodeDeps(projectPath: string): boolean {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(projectPath, 'package.json'), 'utf8'),
    ) as { dependencies?: object; devDependencies?: object }
    return (
      Object.keys(pkg.dependencies || {}).length > 0 ||
      Object.keys(pkg.devDependencies || {}).length > 0
    )
  } catch {
    return false
  }
}

/**
 * What (if anything) this project needs before first launch.
 * v1 scope: Node package install by lockfile, Python venv + requirements.
 */
export function detectBootstrapNeeds(projectPath: string): BootstrapStep[] {
  const has = (rel: string) => fs.existsSync(path.join(projectPath, rel))
  const steps: BootstrapStep[] = []

  if (has('package.json') && !has('node_modules') && declaresNodeDeps(projectPath)) {
    const manager = has('pnpm-lock.yaml')
      ? 'pnpm'
      : has('yarn.lock')
        ? 'yarn'
        : has('bun.lockb') || has('bun.lock')
          ? 'bun'
          : 'npm'
    steps.push({
      command: `${manager} install`,
      label: 'Install this project’s packages',
    })
  }

  const declaresPython =
    has('requirements.txt') || has('pyproject.toml') || has('Pipfile')
  if (declaresPython && !has('.venv') && has('requirements.txt')) {
    steps.push({
      command:
        'python3 -m venv .venv && .venv/bin/pip install -r requirements.txt',
      label: 'Set up this project’s Python environment',
    })
  }

  return steps
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
      void terminateProcess(managed)
    }, timeoutMs)

    const onAbort = () => {
      endedBy = 'cancelled'
      void terminateProcess(managed)
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
