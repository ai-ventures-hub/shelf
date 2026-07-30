/**
 * Cross-process ownership verification for adopt/stop decisions.
 *
 * Ownership proof: the candidate pid must share a process group with the
 * recorded owner pid, or descend from it (bounded parent walk). Real launch
 * trees break the naive pgid check — `npm run dev` workers, tools that make
 * their own groups, zsh with job control (`setopt monitor`) — but they all
 * remain descendants of the login shell Shelf spawned. Truly unrelated
 * listeners share neither group nor ancestry and stay refused.
 *
 * Known residual gap (intentional): a server that double-forks/daemonizes
 * re-parents to launchd and loses ancestry — refusal is the safe outcome.
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const MAX_ANCESTRY_DEPTH = 15
const SNAPSHOT_TTL_MS = 2_000

interface ProcessEntry {
  ppid: number
  pgid: number
}

let cachedTable: Map<number, ProcessEntry> | null = null
let cachedAt = 0

/**
 * One `ps` pass over the whole table, cached briefly so the 5s reconcile
 * timer × N tools does not fork a ps per tool per tick.
 */
export async function snapshotProcessTable(): Promise<Map<number, ProcessEntry>> {
  const now = Date.now()
  if (cachedTable && now - cachedAt < SNAPSHOT_TTL_MS) return cachedTable
  const table = new Map<number, ProcessEntry>()
  try {
    const { stdout } = await execFileAsync('ps', ['-axo', 'pid=,ppid=,pgid='])
    for (const line of stdout.split('\n')) {
      const [pid, ppid, pgid] = line.trim().split(/\s+/).map(Number)
      if (Number.isFinite(pid) && Number.isFinite(ppid) && Number.isFinite(pgid)) {
        table.set(pid, { ppid, pgid })
      }
    }
  } catch {
    // Empty table → every check refuses, which is the safe direction.
  }
  cachedTable = table
  cachedAt = now
  return table
}

/** Test seam: drop the snapshot so the next check sees fresh processes. */
export function invalidateProcessSnapshot(): void {
  cachedTable = null
}

/**
 * True when `pid` is provably part of the process tree rooted at `ownerPid`:
 * same pid, same process group, owner in the ancestor chain, or any ancestor
 * sharing the owner's group.
 */
export async function processOwnedBy(pid: number, ownerPid: number): Promise<boolean> {
  if (!Number.isFinite(pid) || !Number.isFinite(ownerPid) || pid <= 0 || ownerPid <= 0) {
    return false
  }
  if (pid === ownerPid) return true

  const table = await snapshotProcessTable()
  let current: number | undefined = pid
  for (let depth = 0; depth < MAX_ANCESTRY_DEPTH && current && current > 1; depth++) {
    const entry: ProcessEntry | undefined = table.get(current)
    if (!entry) return false
    if (current === ownerPid || entry.pgid === ownerPid) return true
    if (entry.ppid === ownerPid) return true
    current = entry.ppid
  }
  return false
}

/** Every occupant must verify — one stranger on the port refuses adoption. */
export async function verifyOccupantsOwnedBy(
  pids: number[],
  ownerPid: number,
): Promise<boolean> {
  if (pids.length === 0) return false
  for (const pid of pids) {
    if (!(await processOwnedBy(pid, ownerPid))) return false
  }
  return true
}
