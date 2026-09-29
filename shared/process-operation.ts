import fs from 'node:fs'
import { processIdentity } from './process-identity'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { atomicWriteFileSync, withFileLockSync } from './atomic-file'
import { sleep } from './process-lifecycle'

type Operation = { generation: number; lease?: { pid: number; token: string; startedAt?: string } }

/** Cross-host lifecycle serialization. A Stop invalidates starts already waiting. */
export class ProcessOperations {
  private readonly startedAt = processIdentity(process.pid)

  constructor(private readonly root: string) {
    fs.mkdirSync(path.join(root, 'operations'), { recursive: true, mode: 0o700 })
  }

  private file(id: string): string {
    return path.join(this.root, 'operations', `${createHash('sha256').update(id).digest('hex')}.json`)
  }

  private read(file: string): Operation {
    if (!fs.existsSync(file)) return { generation: 0 }
    const value = JSON.parse(fs.readFileSync(file, 'utf8')) as Operation
    if (!Number.isSafeInteger(value.generation)) throw new Error('Invalid process operation record. Restart Shelf before trying again.')
    return value
  }

  generation(id: string): number { return this.read(this.file(id)).generation }

  cancelStarts(id: string): void {
    const file = this.file(id)
    withFileLockSync(file, () => {
      const state = this.read(file)
      state.generation += 1
      atomicWriteFileSync(file, JSON.stringify(state))
    })
  }

  async run<T>(id: string, action: () => Promise<T>): Promise<T> {
    const file = this.file(id)
    const token = randomUUID()
    const deadline = Date.now() + 90_000
    while (true) {
      const acquired = withFileLockSync(file, () => {
        const state = this.read(file)
        if (state.lease) {
          const { pid, startedAt } = state.lease
          let alive = true
          try { process.kill(pid, 0) }
          catch (err) {
            const code = (err as NodeJS.ErrnoException).code
            // ESRCH: the host is gone. EPERM: the pid now belongs to another
            // user, so it cannot be a Shelf host (they run as the user); only
            // an identity match keeps the lease. Returning "held" on EPERM
            // left a crashed host's lease stuck for good once its pid was reused.
            if (code === 'ESRCH') alive = false
            else if (code === 'EPERM') alive = Boolean(startedAt) && processIdentity(pid) === startedAt
            else return false
          }
          if (alive && (!startedAt || processIdentity(pid) === startedAt)) return false
        }
        state.lease = { pid: process.pid, token, startedAt: this.startedAt }
        atomicWriteFileSync(file, JSON.stringify(state))
        return true
      })
      if (acquired) break
      if (Date.now() >= deadline) throw new Error('Another Shelf host is still changing this tool. Try again when it finishes.')
      await sleep(50)
    }
    try { return await action() }
    finally {
      withFileLockSync(file, () => {
        const state = this.read(file)
        if (state.lease?.token !== token) return
        delete state.lease
        atomicWriteFileSync(file, JSON.stringify(state))
      })
    }
  }
}
