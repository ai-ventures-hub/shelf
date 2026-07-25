/**
 * Low-level spawn / wait / kill helpers used by ProcessManager.
 * Kept separate so the supervisor class stays under the soft-launch size bar.
 */
import { spawn, type ChildProcess, execFile } from 'node:child_process'
import net from 'node:net'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export const PORT_TIMEOUT_MS = 60_000
export const PORT_POLL_MS = 400
export const STOP_KILL_GRACE_MS = 4_000

export interface TerminableProcess {
  child: ChildProcess
  pgid?: number
}

export function spawnLoginShell(
  command: string,
  opts: { cwd?: string; env?: Record<string, string> },
): ChildProcess {
  const env = {
    ...process.env,
    ...opts.env,
    FORCE_COLOR: '0',
    NO_COLOR: '1',
  }

  return spawn('/bin/zsh', ['-lc', command], {
    cwd: opts.cwd,
    env,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

export async function runOnce(
  command: string,
  cwd?: string,
  env?: Record<string, string>,
): Promise<void> {
  await execFileAsync('/bin/zsh', ['-lc', command], {
    cwd,
    env: { ...process.env, ...sanitizeEnv(env) },
    timeout: 30_000,
  })
}

export async function terminateProcess(managed: TerminableProcess): Promise<void> {
  const { child, pgid } = managed
  if (child.killed || child.exitCode !== null) return

  try {
    if (pgid) process.kill(-pgid, 'SIGTERM')
    else child.kill('SIGTERM')
  } catch {
    // already exited
  }

  await waitForExit(child, STOP_KILL_GRACE_MS)

  if (child.exitCode === null && !child.killed) {
    try {
      if (pgid) process.kill(-pgid, 'SIGKILL')
      else child.kill('SIGKILL')
    } catch {
      // ignore
    }
  }
}

export function waitForExit(child: ChildProcess, ms: number): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null) {
      resolve()
      return
    }
    const timer = setTimeout(() => resolve(), ms)
    child.once('exit', () => {
      clearTimeout(timer)
      resolve()
    })
  })
}

export function waitForPort(
  port: number,
  timeoutMs: number,
  stillRunning: () => boolean,
): Promise<boolean> {
  const started = Date.now()
  return new Promise((resolve) => {
    const tick = () => {
      if (!stillRunning()) {
        resolve(false)
        return
      }
      const socket = net.connect({ host: '127.0.0.1', port }, () => {
        socket.end()
        resolve(true)
      })
      socket.on('error', () => {
        socket.destroy()
        if (Date.now() - started >= timeoutMs) {
          resolve(false)
          return
        }
        setTimeout(tick, PORT_POLL_MS)
      })
    }
    tick()
  })
}

export function sanitizeEnv(
  env?: Record<string, string>,
): Record<string, string> | undefined {
  if (!env) return undefined
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(env)) {
    if (!k.trim()) continue
    out[k] = v
  }
  return out
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
