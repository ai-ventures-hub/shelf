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
  // A shell can exit before its descendants. Keep supervising its group.
  if (pgid) return terminateTargets([-pgid])
  if (child.pid && child.exitCode === null && child.signalCode === null) {
    await terminateTargets([child.pid])
  }
}

/** Stop an adopted process and any descendants still in its process group. */
export async function terminatePidGroup(pid: number): Promise<void> {
  if (!Number.isSafeInteger(pid) || pid <= 1) throw new Error('Invalid owned process id.')
  await terminateTargets([-pid, pid])
}

async function terminateTargets(targets: number[]): Promise<void> {
  const exists = (target: number) => {
    try { process.kill(target, 0); return true }
    catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ESRCH') return false
      throw err
    }
  }
  const alive = () => targets.some(exists)
  const signal = (value: NodeJS.Signals) => {
    for (const target of targets) {
      try { process.kill(target, value) }
      catch (err) { if ((err as NodeJS.ErrnoException).code !== 'ESRCH') throw err }
    }
  }
  const wait = async (ms: number) => {
    const deadline = Date.now() + ms
    while (alive() && Date.now() < deadline) await sleep(100)
  }
  if (!alive()) return
  signal('SIGTERM')
  await wait(STOP_KILL_GRACE_MS)
  if (!alive()) return
  signal('SIGKILL')
  await wait(1_000)
  if (alive()) throw new Error('The owned process group did not stop. Retry Stop or inspect the remaining processes.')
}

export function waitForExit(child: ChildProcess, ms: number): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) { resolve(); return }
    const done = () => {
      clearTimeout(timer)
      child.off('exit', done)
      resolve()
    }
    const timer = setTimeout(done, ms)
    child.once('exit', done)
  })
}

/**
 * Poll until something accepts TCP on the port. Probes BOTH loopback stacks
 * each tick: frameworks that bind `localhost` (Vite 6 default) often listen
 * on ::1 only on macOS, where an IPv4-only probe never connects and the
 * launch sat in Starting for the full timeout despite the app serving.
 * On machines without IPv6 the ::1 attempt fails instantly and the IPv4
 * probe carries the tick alone.
 */
export function waitForPort(
  port: number,
  timeoutMs: number,
  stillRunning: () => boolean,
): Promise<boolean> {
  const started = Date.now()
  const hosts = ['127.0.0.1', '::1']
  return new Promise((resolve) => {
    const tick = () => {
      if (!stillRunning()) {
        resolve(false)
        return
      }
      let pendingProbes = hosts.length
      let settled = false
      const sockets: net.Socket[] = []
      const probeDone = (connected: boolean) => {
        if (settled) return
        if (connected) {
          settled = true
          for (const socket of sockets) socket.destroy()
          resolve(true)
          return
        }
        pendingProbes -= 1
        if (pendingProbes > 0) return // the other stack may still connect
        if (Date.now() - started >= timeoutMs) {
          settled = true
          resolve(false)
          return
        }
        setTimeout(tick, PORT_POLL_MS)
      }
      for (const host of hosts) {
        const socket = net.connect({ host, port }, () => {
          socket.end()
          probeDone(true)
        })
        socket.on('error', () => {
          socket.destroy()
          probeDone(false)
        })
        sockets.push(socket)
      }
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
