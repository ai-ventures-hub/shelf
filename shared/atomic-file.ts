import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

const LOCK_WAIT_MS = 10
const LOCK_TIMEOUT_MS = 2_000
const STALE_LOCK_MS = 15_000
const waitBuffer = new Int32Array(new SharedArrayBuffer(4))

/**
 * Serialize read-modify-write operations across the Electron and MCP processes.
 * Stale locks are recoverable after a crash; the short wait keeps main-process
 * stalls bounded if another writer is active.
 */
export function withFileLockSync<T>(targetPath: string, action: () => T): T {
  const lockPath = `${targetPath}.lock`
  const deadline = Date.now() + LOCK_TIMEOUT_MS
  let fd: number | undefined

  while (fd === undefined) {
    try {
      fd = fs.openSync(lockPath, 'wx', 0o600)
      fs.writeFileSync(fd, `${process.pid}\n`, 'utf8')
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code !== 'EEXIST') throw err

      try {
        const stat = fs.statSync(lockPath)
        if (Date.now() - stat.mtimeMs > STALE_LOCK_MS) {
          fs.unlinkSync(lockPath)
          continue
        }
      } catch (statErr) {
        if ((statErr as NodeJS.ErrnoException).code === 'ENOENT') continue
        throw statErr
      }

      if (Date.now() >= deadline) {
        throw new Error(`Timed out waiting to update ${path.basename(targetPath)}.`)
      }
      Atomics.wait(waitBuffer, 0, 0, LOCK_WAIT_MS)
    }
  }

  try {
    return action()
  } finally {
    try {
      fs.closeSync(fd)
    } finally {
      try {
        fs.unlinkSync(lockPath)
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
      }
    }
  }
}

/** Write beside the target, then atomically replace it without temp-name collisions. */
export function atomicWriteFileSync(targetPath: string, content: string): void {
  const tmp = `${targetPath}.${process.pid}.${randomUUID()}.tmp`
  try {
    fs.writeFileSync(tmp, content, { encoding: 'utf8', mode: 0o600 })
    fs.renameSync(tmp, targetPath)
  } finally {
    try {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp)
    } catch {
      // The target write already succeeded or surfaced its own actionable error.
    }
  }
}
