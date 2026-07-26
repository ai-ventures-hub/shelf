/**
 * Port occupancy + free-port helpers shared by MCP register/launch paths.
 * Keeps Shelf from silently claiming busy ports and supports reassignment.
 */
import { execFile } from 'node:child_process'
import net from 'node:net'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export interface FreePortOptions {
  /** Prefer this port when free. */
  preferred?: number
  /** Inclusive search start (default 3000). */
  from?: number
  /** Inclusive search end (default 3999). */
  to?: number
  /** How many free candidates to return (default 5). */
  count?: number
}

export interface FreePortResult {
  port: number
  preferred?: number
  preferredFree: boolean
  candidates: number[]
}

/**
 * Returns the first LISTEN pid on a TCP port, or null when free.
 */
export async function findPortOccupant(port: number): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync('lsof', [
      '-nP',
      `-iTCP:${port}`,
      '-sTCP:LISTEN',
      '-t',
    ])
    const pid = parseInt(stdout.trim().split('\n')[0] || '', 10)
    return Number.isFinite(pid) ? pid : null
  } catch {
    return null
  }
}

/** Resolve the OS process group for ownership checks across Shelf processes. */
export async function findProcessGroupId(pid: number): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync('ps', [
      '-o',
      'pgid=',
      '-p',
      String(pid),
    ])
    const pgid = parseInt(stdout.trim(), 10)
    return Number.isFinite(pgid) ? pgid : null
  } catch {
    return null
  }
}

export async function processBelongsToGroup(pid: number, pgid: number): Promise<boolean> {
  if (pid === pgid) return true
  return (await findProcessGroupId(pid)) === pgid
}

/** True when nothing is listening on the port. */
export async function isPortFree(port: number): Promise<boolean> {
  const occupant = await findPortOccupant(port)
  if (occupant) return false
  // Double-check with a short bind attempt in case lsof is unavailable.
  return canBind(port)
}

/**
 * SIGTERM (then SIGKILL) the LISTEN pid on a port — used to stop MCP/orphaned launches
 * that another ProcessManager instance does not own.
 */
export async function killPortOccupant(
  port: number,
  opts: { graceMs?: number; expectedPgid?: number } = {},
): Promise<{ pid: number | null; freed: boolean; refused?: boolean }> {
  const graceMs = opts.graceMs ?? 4_000
  const pid = await findPortOccupant(port)
  if (!pid) return { pid: null, freed: true }

  if (opts.expectedPgid && !(await processBelongsToGroup(pid, opts.expectedPgid))) {
    return { pid, freed: false, refused: true }
  }

  signalPid(opts.expectedPgid || pid, 'SIGTERM')
  await sleep(graceMs)

  let still = await findPortOccupant(port)
  if (still) {
    if (opts.expectedPgid && !(await processBelongsToGroup(still, opts.expectedPgid))) {
      // The Shelf-owned process released the port and another process claimed it.
      return { pid, freed: true }
    }
    signalPid(opts.expectedPgid || still, 'SIGKILL')
    await sleep(400)
    still = await findPortOccupant(port)
  }
  return { pid, freed: still === null }
}

/** Prefer killing the process group when the listen pid is a group leader. */
function signalPid(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal)
  } catch {
    // Not a group leader — fall through to the single pid.
  }
  try {
    process.kill(pid, signal)
  } catch {
    // already exited
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function canBind(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.once('error', () => resolve(false))
    server.once('listening', () => {
      server.close(() => resolve(true))
    })
    server.listen(port, '127.0.0.1')
  })
}

/**
 * Prefer `preferred` when free; otherwise scan [from, to] for free ports.
 */
export async function findFreePort(
  options: FreePortOptions = {},
): Promise<FreePortResult> {
  const preferred = options.preferred
  const from = options.from ?? 3000
  const to = options.to ?? 3999
  const count = Math.max(1, options.count ?? 5)
  const candidates: number[] = []

  let preferredFree = false
  if (preferred && preferred >= 1 && preferred <= 65535) {
    preferredFree = await isPortFree(preferred)
    if (preferredFree) candidates.push(preferred)
  }

  for (let port = from; port <= to && candidates.length < count; port++) {
    if (preferred && port === preferred) continue
    if (await isPortFree(port)) candidates.push(port)
  }

  if (candidates.length === 0) {
    throw new Error(`No free TCP ports found in ${from}–${to}.`)
  }

  return {
    port: candidates[0],
    preferred,
    preferredFree,
    candidates,
  }
}

/**
 * Rewrite localhost / 127.0.0.1 URLs to the given port; synthesize one when missing.
 */
export function urlForPort(existingUrl: string | undefined, port: number): string {
  if (!existingUrl?.trim()) return `http://127.0.0.1:${port}/`
  try {
    const parsed = new URL(existingUrl)
    if (
      parsed.hostname === 'localhost' ||
      parsed.hostname === '127.0.0.1' ||
      parsed.hostname === '0.0.0.0' ||
      parsed.hostname === '[::1]'
    ) {
      parsed.port = String(port)
      // Keep trailing slash style if the original had a path of "/"
      return parsed.toString()
    }
  } catch {
    // fall through
  }
  return `http://127.0.0.1:${port}/`
}

/**
 * Force a launch command onto a specific port via PORT= and framework flags.
 * Idempotent: strips prior PORT= / -p / --port before re-applying.
 */
export function withForcedPort(launchCommand: string, port: number): string {
  let cmd = launchCommand.trim()
  cmd = cmd.replace(/^(?:PORT=\d+\s+)+/, '')
  cmd = cmd.replace(/\s+--port(?:=|\s+)\d+/g, '')
  cmd = cmd.replace(/\s+-p(?:=|\s+)\d+/g, '')

  // Package-manager scripts need `--` so flags reach the underlying binary.
  if (/\b(npm|pnpm|yarn|bun)\s+run\b/.test(cmd)) {
    if (/\s--(\s|$)/.test(cmd)) {
      return `PORT=${port} ${cmd} --port ${port}`
    }
    return `PORT=${port} ${cmd} -- --port ${port}`
  }

  // Direct next/vite/flask-style binaries.
  if (/\b(next|vite|flask)\b/.test(cmd)) {
    return `PORT=${port} ${cmd} --port ${port}`
  }

  return `PORT=${port} ${cmd}`
}

/**
 * Pull a local http URL out of framework ready logs (Next/Vite/etc).
 */
export function sniffLocalUrlFromText(text: string): string | null {
  const patterns = [
    /Local:\s*(https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])[:\d]*)/i,
    /(?:listening on|ready on|started server on)\s+(https?:\/\/(?:localhost|127\.0\.0\.1)[:\d/]*)/i,
    /(https?:\/\/(?:localhost|127\.0\.0\.1):\d+\/?)/i,
  ]
  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match?.[1]) return match[1].replace(/\/$/, '') + '/'
  }
  return null
}

/** Extract port number from a local URL, if present. */
export function portFromUrl(url: string): number | null {
  try {
    const parsed = new URL(url)
    if (!parsed.port) return parsed.protocol === 'https:' ? 443 : 80
    const n = Number(parsed.port)
    return Number.isFinite(n) ? n : null
  } catch {
    return null
  }
}
