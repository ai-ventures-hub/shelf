import { execFileSync } from 'node:child_process'

const cache = new Map<number, { at: number; identity?: string }>()
/** Process creation time prevents a recycled PID from inheriting a Shelf receipt. */
export function processIdentity(pid: number, fresh = false): string | undefined {
  if (!Number.isSafeInteger(pid) || pid <= 0) return undefined
  const cached = cache.get(pid)
  if (!fresh && cached && Date.now() - cached.at < 1000) return cached.identity
  let identity: string | undefined
  try {
    identity = execFileSync('ps', ['-p', String(pid), '-o', 'lstart='], { encoding: 'utf8', timeout: 2000, stdio: ['ignore', 'pipe', 'ignore'] }).trim() || undefined
  } catch { /* absent or unreadable process */ }
  if (cache.size > 1000) cache.clear()
  cache.set(pid, { at: Date.now(), identity })
  return identity
}
