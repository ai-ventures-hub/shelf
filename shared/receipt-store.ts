/**
 * Persist run receipts under Application Support (separate from library.json).
 * Caps history so launch noise cannot grow forever.
 */
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { atomicWriteFileSync, withFileLockSync } from './atomic-file'
import { resolveShelfDataRoot } from './paths'
import { filterReceipts, type ReceiptFilterOpts } from './receipt-export'
import { maskSecrets, type ReceiptOutcome, type ReceiptsFile, type RunReceipt } from './types'

const MAX_RECEIPTS = 400

export type { ReceiptFilterOpts }

export interface BeginReceiptInput {
  toolId: string
  toolName: string
  launchCommand: string
  port?: number
  url?: string
  pid?: number
  startedAt?: string
  message?: string
}

export interface EndReceiptInput {
  outcome: Exclude<ReceiptOutcome, 'starting' | 'running'>
  message?: string
  exitCode?: number | null
  pid?: number
  port?: number
  url?: string
}

export class ReceiptStore {
  private readonly filePath: string

  constructor(root = resolveShelfDataRoot()) {
    fs.mkdirSync(root, { recursive: true })
    this.filePath = path.join(root, 'receipts.json')
    withFileLockSync(this.filePath, () => {
      if (!fs.existsSync(this.filePath)) {
        this.write({ version: 1, receipts: [] })
        return
      }
      try {
        const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as
          | Partial<ReceiptsFile>
          | null
        if (!parsed || !Array.isArray(parsed.receipts)) throw new Error('missing receipts array')
      } catch {
        const stamp = new Date().toISOString().replace(/[:.]/g, '-')
        const backup = path.join(root, `receipts.corrupt-backup-${stamp}.json`)
        fs.copyFileSync(this.filePath, backup)
        this.write({ version: 1, receipts: [] })
      }
    })
    // Mark only dead open receipts as interrupted. Live processes may belong
    // to another Shelf host (Electron or MCP) using the same receipt file.
    if (fs.existsSync(this.filePath)) {
      this.closeOrphans()
    }
  }

  list(opts: ReceiptFilterOpts = {}): RunReceipt[] {
    const limit = Math.max(1, Math.min(opts.limit ?? 50, MAX_RECEIPTS))
    const sorted = this.read()
      .receipts.slice()
      .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
    // Filter first, then cap — so outcome/query filters are not cut short by limit.
    return filterReceipts(sorted, { ...opts, limit })
  }

  get(id: string): RunReceipt | undefined {
    return this.read().receipts.find((r) => r.id === id)
  }

  /** Open a receipt when a process has been spawned (or is starting). */
  begin(input: BeginReceiptInput): RunReceipt {
    return withFileLockSync(this.filePath, () => {
      const receipt: RunReceipt = {
        id: randomUUID(),
        toolId: input.toolId,
        toolName: input.toolName,
        launchCommand: maskSecrets(input.launchCommand),
        port: input.port,
        url: input.url,
        pid: input.pid,
        startedAt: input.startedAt || new Date().toISOString(),
        outcome: 'starting',
        message: input.message || 'Starting…',
      }
      const data = this.read()
      data.receipts.unshift(receipt)
      this.write(this.cap(data))
      return receipt
    })
  }

  /** Transition an open receipt to running once readiness succeeds. */
  markRunning(
    id: string,
    patch: { pid?: number; port?: number; url?: string; message?: string } = {},
  ): RunReceipt | undefined {
    return this.update(id, (r) => {
      if (r.endedAt) return r
      return {
        ...r,
        outcome: 'running',
        pid: patch.pid ?? r.pid,
        port: patch.port ?? r.port,
        url: patch.url ?? r.url,
        message: patch.message || r.message || 'Running',
      }
    })
  }

  /** Finalize an open receipt (stop, crash, timeout, failed start). */
  end(id: string, input: EndReceiptInput): RunReceipt | undefined {
    const endedAt = new Date().toISOString()
    return this.update(id, (r) => {
      if (r.endedAt) return r
      const started = Date.parse(r.startedAt)
      const ended = Date.parse(endedAt)
      return {
        ...r,
        endedAt,
        durationMs: Number.isFinite(started) ? Math.max(0, ended - started) : undefined,
        outcome: input.outcome,
        exitCode: input.exitCode ?? r.exitCode,
        pid: input.pid ?? r.pid,
        port: input.port ?? r.port,
        url: input.url ?? r.url,
        message: input.message || r.message,
      }
    })
  }

  /** One-shot receipt for launches that never spawned (busy port, missing tool). */
  recordFailed(input: BeginReceiptInput & { message: string }): RunReceipt {
    return withFileLockSync(this.filePath, () => {
      const startedAt = input.startedAt || new Date().toISOString()
      const receipt: RunReceipt = {
        id: randomUUID(),
        toolId: input.toolId,
        toolName: input.toolName,
        launchCommand: maskSecrets(input.launchCommand || ''),
        port: input.port,
        url: input.url,
        pid: input.pid,
        startedAt,
        endedAt: startedAt,
        durationMs: 0,
        outcome: 'failed',
        message: input.message,
      }
      const data = this.read()
      data.receipts.unshift(receipt)
      this.write(this.cap(data))
      return receipt
    })
  }

  clear(opts: { toolId?: string } = {}): { removed: number } {
    return withFileLockSync(this.filePath, () => {
      const data = this.read()
      const before = data.receipts.length
      data.receipts = opts.toolId
        ? data.receipts.filter(
            (receipt) => receipt.toolId !== opts.toolId || isActiveReceipt(receipt),
          )
        : data.receipts.filter(isActiveReceipt)
      this.write(data)
      return { removed: before - data.receipts.length }
    })
  }

  /** Newest open Shelf-owned process for cross-process adoption. */
  findActiveProcess(toolId: string, port?: number): RunReceipt | undefined {
    return this.list({ toolId, limit: MAX_RECEIPTS }).find(
      (receipt) =>
        !receipt.endedAt &&
        (receipt.outcome === 'starting' || receipt.outcome === 'running') &&
        typeof receipt.pid === 'number' &&
        (port === undefined || receipt.port === port) &&
        isProcessOrGroupAlive(receipt.pid),
    )
  }

  private update(
    id: string,
    mutator: (receipt: RunReceipt) => RunReceipt,
  ): RunReceipt | undefined {
    return withFileLockSync(this.filePath, () => {
      const data = this.read()
      const index = data.receipts.findIndex((r) => r.id === id)
      if (index < 0) return undefined
      const next = mutator(data.receipts[index])
      data.receipts[index] = next
      this.write(data)
      return next
    })
  }

  private closeOrphans(): void {
    withFileLockSync(this.filePath, () => {
      const data = this.read()
      let dirty = false
      const now = new Date().toISOString()
      data.receipts = data.receipts.map((r) => {
        if (r.endedAt || (r.pid && isProcessOrGroupAlive(r.pid))) return r
        dirty = true
        const started = Date.parse(r.startedAt)
        const ended = Date.parse(now)
        return {
          ...r,
          endedAt: now,
          durationMs: Number.isFinite(started) ? Math.max(0, ended - started) : undefined,
          outcome: 'interrupted' as const,
          message: r.message || 'Shelf quit while this run was still active.',
        }
      })
      if (dirty) this.write(this.cap(data))
    })
  }

  private cap(data: ReceiptsFile): ReceiptsFile {
    if (data.receipts.length <= MAX_RECEIPTS) return data
    const activeIds = new Set(
      data.receipts.filter(isActiveReceipt).map((receipt) => receipt.id),
    )
    let finalizedKept = 0
    const finalizedLimit = Math.max(0, MAX_RECEIPTS - activeIds.size)
    return {
      ...data,
      receipts: data.receipts.filter((receipt) => {
        if (activeIds.has(receipt.id)) return true
        if (finalizedKept >= finalizedLimit) return false
        finalizedKept += 1
        return true
      }),
    }
  }

  private read(): ReceiptsFile {
    try {
      const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as ReceiptsFile
      if (!Array.isArray(raw.receipts)) throw new Error('missing receipts array')
      return { version: 1, receipts: raw.receipts }
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      throw new Error(`Shelf could not read receipts.json: ${detail}`)
    }
  }

  private write(data: ReceiptsFile): void {
    atomicWriteFileSync(this.filePath, JSON.stringify(data, null, 2))
  }
}

function isProcessOrGroupAlive(pid: number): boolean {
  for (const candidate of [-pid, pid]) {
    try {
      process.kill(candidate, 0)
      return true
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EPERM') return true
    }
  }
  return false
}

function isActiveReceipt(receipt: RunReceipt): boolean {
  return Boolean(!receipt.endedAt && receipt.pid && isProcessOrGroupAlive(receipt.pid))
}
