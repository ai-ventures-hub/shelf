/**
 * Persist run receipts under Application Support (separate from library.json).
 * Caps history so launch noise cannot grow forever.
 */
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
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
    if (!fs.existsSync(this.filePath)) {
      this.write({ version: 1, receipts: [] })
    } else {
      // Mark open receipts from a prior session as interrupted.
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
    const receipt: RunReceipt = {
      id: randomUUID(),
      toolId: input.toolId,
      toolName: input.toolName,
      launchCommand: maskSecrets(input.launchCommand),
      port: input.port,
      url: input.url,
      startedAt: input.startedAt || new Date().toISOString(),
      outcome: 'starting',
      message: input.message || 'Starting…',
    }
    const data = this.read()
    data.receipts.unshift(receipt)
    this.write(this.cap(data))
    return receipt
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
    const startedAt = input.startedAt || new Date().toISOString()
    const receipt: RunReceipt = {
      id: randomUUID(),
      toolId: input.toolId,
      toolName: input.toolName,
      launchCommand: maskSecrets(input.launchCommand || ''),
      port: input.port,
      url: input.url,
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
  }

  clear(opts: { toolId?: string } = {}): { removed: number } {
    const data = this.read()
    const before = data.receipts.length
    data.receipts = opts.toolId
      ? data.receipts.filter((r) => r.toolId !== opts.toolId)
      : []
    this.write(data)
    return { removed: before - data.receipts.length }
  }

  private update(
    id: string,
    mutator: (receipt: RunReceipt) => RunReceipt,
  ): RunReceipt | undefined {
    const data = this.read()
    const index = data.receipts.findIndex((r) => r.id === id)
    if (index < 0) return undefined
    const next = mutator(data.receipts[index])
    data.receipts[index] = next
    this.write(data)
    return next
  }

  private closeOrphans(): void {
    const data = this.read()
    let dirty = false
    const now = new Date().toISOString()
    data.receipts = data.receipts.map((r) => {
      if (r.endedAt) return r
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
  }

  private cap(data: ReceiptsFile): ReceiptsFile {
    if (data.receipts.length <= MAX_RECEIPTS) return data
    return { ...data, receipts: data.receipts.slice(0, MAX_RECEIPTS) }
  }

  private read(): ReceiptsFile {
    try {
      const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as ReceiptsFile
      if (!Array.isArray(raw.receipts)) return { version: 1, receipts: [] }
      return { version: 1, receipts: raw.receipts }
    } catch {
      return { version: 1, receipts: [] }
    }
  }

  private write(data: ReceiptsFile): void {
    const tmp = `${this.filePath}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8')
    fs.renameSync(tmp, this.filePath)
  }
}
