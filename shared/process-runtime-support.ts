/**
 * Logs, state emit, receipts, and ready-URL sniffing for ProcessManager.
 */
import {
  PORT_POLL_MS,
  sleep,
} from './process-lifecycle'
import { sniffLocalUrlFromText } from './ports'
import type { ReceiptStore } from './receipt-store'
import type { LogLine, RunReceipt, ToolRuntimeState } from './types'
import { randomUUID } from 'node:crypto'
import { RunLogStore } from './run-log-store'
import { maskSecrets, sanitizeOutput } from './types'

const MAX_LOG_LINES = 3000

export type ProcessEventSink = (channel: string, payload: unknown) => void

/** Cap for a held partial line — a no-newline stream must not grow it forever. */
const MAX_RESIDUAL_CHARS = 8192

export class ProcessRuntimeSupport {
  private readonly failedLogWrites = new Set<string>()
  private readonly knownSecrets = new Map<string, string[]>()
  private readonly runIds = new Map<string, string>()
  private readonly states = new Map<string, ToolRuntimeState>()
  private readonly logs = new Map<string, LogLine[]>()
  /** Trailing partial line per toolId+stream, held until its newline arrives. */
  private readonly discardingLine = new Set<string>()
  private readonly residual = new Map<string, string>()

  constructor(
    private readonly onEvent?: ProcessEventSink,
    private readonly receipts?: ReceiptStore,
    private readonly secretValues: (toolId: string) => string[] = () => [],
    private readonly sharedLogs?: RunLogStore,
  ) {}

  private secretsFor(toolId: string): string[] {
    const known = this.knownSecrets.get(toolId) || []
    try {
      const values = [...new Set([...known, ...this.secretValues(toolId)])]
      this.knownSecrets.set(toolId, values)
      return values
    } catch { return known }
  }

  peekState(toolId: string): ToolRuntimeState {
    return (
      this.states.get(toolId) || {
        toolId,
        status: 'stopped',
        message: 'Not started',
      }
    )
  }

  listKnownStates(): ToolRuntimeState[] {
    return Array.from(this.states.values())
  }

  getLogs(toolId: string): LogLine[] {
    try {
      if (!this.failedLogWrites.has(toolId)) return this.sharedLogs?.read(toolId, this.secretsFor(toolId)) || this.logs.get(toolId) || []
    } catch { /* preserve this host's evidence when shared storage is unavailable */ }
    return [...(this.logs.get(toolId) || []).slice(-MAX_LOG_LINES + 1), {
      toolId, stream: 'system', at: new Date().toISOString(),
      text: 'Shared log storage is unavailable. Showing recent output retained by this host.',
    }]
  }

  clearLogs(toolId: string): void {
    if (this.sharedLogs) this.runIds.set(toolId, this.sharedLogs.begin(toolId))
    this.logs.set(toolId, [])
  }

  appendLog(toolId: string, stream: LogLine['stream'], chunk: string): void {
    // Child pipes deliver arbitrary chunk boundaries: masking each fragment
    // independently lets a secret split across chunks slip through. Hold the
    // trailing partial line until its newline arrives and mask only whole
    // lines. 'system' messages are authored line-complete without trailing
    // newlines — buffering would swallow them, so they commit directly.
    if (stream === 'system') {
      this.commitLines(toolId, stream, chunk.replace(/\r\n?/g, '\n').split('\n'))
      return
    }
    const key = `${toolId}\u0000${stream}`
    if (this.discardingLine.has(key)) {
      const boundary = chunk.search(/[\r\n]/)
      if (boundary < 0) return
      chunk = chunk.slice(boundary + 1)
      this.discardingLine.delete(key)
    }
    // Bare \r is a line break too: spinner-style CLIs rewrite their ready
    // line with \r, and holding it as 'partial' would blind the ready-URL
    // sniffer until process exit.
    const combined = (this.residual.get(key) || '') + chunk.replace(/\r\n?/g, '\n')
    const lines = combined.split('\n')
    const partial = lines.pop() ?? ''
    if (partial.length > MAX_RESIDUAL_CHARS) {
      // Drop the entire oversized line, including future chunks up to its
      // newline, so a secret cannot leak across a forced flush boundary.
      lines.push('[Oversized output line omitted]')
      this.discardingLine.add(key)
      this.residual.delete(key)
    } else if (partial) {
      this.residual.set(key, partial)
    } else {
      this.residual.delete(key)
    }
    this.commitLines(toolId, stream, lines)
  }

  /** Commit any held partial lines — call when the process exits/stops. */
  flushLogs(toolId: string): void {
    for (const stream of ['stdout', 'stderr'] as const) {
      const key = `${toolId}\u0000${stream}`
      const partial = this.residual.get(key)
      if (!partial) continue
      this.residual.delete(key)
      this.commitLines(toolId, stream, [partial])
    }
  }

  /** Drop everything held for a tool — call when its record is deleted. */
  forget(toolId: string): void {
    this.flushLogs(toolId)
    this.sharedLogs?.forget(toolId)
    this.failedLogWrites.delete(toolId)
    this.runIds.delete(toolId)
    this.knownSecrets.delete(toolId)
    this.states.delete(toolId)
    this.logs.delete(toolId)
    for (const stream of ['stdout', 'stderr'] as const) {
      this.residual.delete(`${toolId}\u0000${stream}`)
      this.discardingLine.delete(`${toolId}\u0000${stream}`)
    }
  }

  private commitLines(toolId: string, stream: LogLine['stream'], lines: string[]): void {
    const bucket = this.logs.get(toolId) || []
    const at = new Date().toISOString()
    const committed: LogLine[] = []
    for (const text of lines) {
      if (!text) continue
      const entry: LogLine = {
        id: randomUUID(),
        runId: this.runIds.get(toolId) || this.sharedLogs?.currentRun(toolId),
        toolId,
        stream,
        text: text.length > MAX_RESIDUAL_CHARS ? '[Oversized output line omitted]' : maskSecrets(text, this.secretsFor(toolId)),
        at,
      }
      committed.push(entry)
      bucket.push(entry)
      this.emit('logs:line', entry)
    }
    try {
      this.sharedLogs?.append(toolId, committed, this.runIds.get(toolId))
      this.failedLogWrites.delete(toolId)
    } catch {
      if (!this.failedLogWrites.has(toolId)) this.emit('logs:line', { toolId, stream: 'system', at, text: 'Shared log storage is unavailable. This host still retains recent output.' })
      this.failedLogWrites.add(toolId)
    }
    while (bucket.length > MAX_LOG_LINES) bucket.shift()
    this.logs.set(toolId, bucket)
  }

  setState(toolId: string, state: ToolRuntimeState): ToolRuntimeState {
    state = sanitizeOutput(state, this.secretsFor(toolId))
    this.states.set(toolId, state)
    this.emit('process:update', state)
    return state
  }

  beginReceipt(input: Parameters<ReceiptStore['begin']>[0]): RunReceipt | undefined {
    if (!this.receipts) return undefined
    try {
      const receipt = this.receipts.begin(sanitizeOutput({ ...input, id: this.runIds.get(input.toolId) }, this.secretsFor(input.toolId)))
      this.emit('receipts:update', receipt)
      return receipt
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.appendLog(input.toolId, 'system', `Run history unavailable: ${message}`)
      return undefined
    }
  }

  markReceiptRunning(
    id: string | undefined,
    patch: { pid?: number; port?: number; url?: string; message?: string },
  ): void {
    if (!id || !this.receipts) return
    try {
      const receipt = this.receipts.markRunning(id, sanitizeOutput(patch, this.secretsFor(this.receipts.get(id)?.toolId || '')))
      if (receipt) this.emit('receipts:update', receipt)
    } catch {
      // Receipt persistence is secondary to keeping the process supervised.
    }
  }

  endReceipt(
    id: string | undefined,
    input: Parameters<ReceiptStore['end']>[1],
  ): void {
    if (!id || !this.receipts) return
    try {
      const receipt = this.receipts.end(id, sanitizeOutput(input, this.secretsFor(this.receipts.get(id)?.toolId || '')))
      if (receipt) this.emit('receipts:update', receipt)
    } catch {
      // Receipt persistence is secondary to accurate process state.
    }
  }

  emitFailedReceipt(input: Parameters<ReceiptStore['recordFailed']>[0]): void {
    if (!this.receipts) return
    try {
      const receipt = this.receipts.recordFailed(sanitizeOutput(input, this.secretsFor(input.toolId)))
      this.emit('receipts:update', receipt)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.appendLog(input.toolId, 'system', `Run history unavailable: ${message}`)
    }
  }

  /** Scan recent logs for a Local:/listening URL. */
  sniffReadyUrl(toolId: string): { url: string; port: number } | null {
    const blob = this.getLogs(toolId)
      .map((l) => l.text)
      .join('\n')
    const url = sniffLocalUrlFromText(blob)
    if (!url) return null
    try {
      const parsed = new URL(url)
      const port = Number(parsed.port || (parsed.protocol === 'https:' ? 443 : 80))
      if (!Number.isFinite(port)) return null
      return { url, port }
    } catch {
      return null
    }
  }

  /** Poll briefly for framework ready logs when no port was preconfigured. */
  async waitForSniffedUrl(
    toolId: string,
    timeoutMs: number,
    stillManaged: () => boolean,
  ): Promise<{ url: string; port: number } | null> {
    const started = Date.now()
    while (Date.now() - started < timeoutMs) {
      if (!stillManaged()) return null
      const found = this.sniffReadyUrl(toolId)
      if (found) return found
      await sleep(PORT_POLL_MS)
    }
    return this.sniffReadyUrl(toolId)
  }

  private emit(channel: string, payload: unknown): void {
    this.onEvent?.(channel, payload)
  }
}
