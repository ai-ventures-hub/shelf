import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

const LOCK_WAIT_MS = 10
const LOCK_TIMEOUT_MS = 2_000
const STALE_LOCK_MS = 15_000
const waitBuffer = new Int32Array(new SharedArrayBuffer(4))

/** Only ESRCH proves an owner is gone. Permission failures keep the lock. */
function ownerIsGone(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return false
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'ESRCH'
  }
}

function recoverLock(lockPath: string): void {
  try {
    const stat = fs.statSync(lockPath)
    if (!stat.isDirectory() || Date.now() - stat.mtimeMs <= STALE_LOCK_MS) return
    const entries = fs.readdirSync(lockPath)
    // Never unlink a shared fixed owner path. A reaper may encounter a new
    // directory at this path, but the old unique markers cannot exist there.
    for (const entry of entries) {
      const match = /^(\d+)\.[a-f0-9-]+\.owner$/.exec(entry)
      if (!match || !ownerIsGone(Number(match[1]))) return
    }
    for (const entry of entries) {
      try { fs.unlinkSync(path.join(lockPath, entry)) } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
      }
    }
    // A fresh writer's marker makes rmdir fail with ENOTEMPTY. An empty
    // directory removed before its creator writes a marker has no owner yet.
    fs.rmdirSync(lockPath)
  } catch (err) {
    if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes((err as NodeJS.ErrnoException).code || '')) throw err
  }
}

/** Serialize read-modify-write operations across Electron and MCP processes. */
export function withFileLockSync<T>(targetPath: string, action: () => T): T {
  const lockPath = `${targetPath}.lock`
  const marker = `${process.pid}.${randomUUID()}.owner`
  const ownerPath = path.join(lockPath, marker)
  const deadline = Date.now() + LOCK_TIMEOUT_MS
  let acquired = false

  while (!acquired) {
    let created = false
    try {
      fs.mkdirSync(lockPath, { mode: 0o700 })
      created = true
      fs.writeFileSync(ownerPath, '', { flag: 'wx', mode: 0o600 })
      // Another creator can reach a replaced empty directory. Only the
      // sole marker owner proceeds; contenders remove only their own marker.
      const entries = fs.readdirSync(lockPath)
      acquired = entries.length === 1 && entries[0] === marker
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code !== 'EEXIST' && !(created && code === 'ENOENT')) throw err
    } finally {
      if (created && !acquired) {
        try { fs.unlinkSync(ownerPath) } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
        }
        try { fs.rmdirSync(lockPath) } catch (err) {
          if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes((err as NodeJS.ErrnoException).code || '')) throw err
        }
      }
    }
    if (acquired) break
    recoverLock(lockPath)
    if (Date.now() >= deadline) {
      // Legacy file locks are left intact, including orphaned ones. Removing
      // them cannot be made safe while an older Shelf process may still write.
      throw new Error(`Timed out waiting to update ${path.basename(targetPath)}.`)
    }
    Atomics.wait(waitBuffer, 0, 0, LOCK_WAIT_MS)
  }

  try {
    return action()
  } finally {
    fs.unlinkSync(ownerPath)
    try { fs.rmdirSync(lockPath) } catch (err) {
      if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes((err as NodeJS.ErrnoException).code || '')) throw err
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
