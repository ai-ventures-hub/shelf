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
import { maskSecrets } from './types'

const MAX_LOG_LINES = 3000

export type ProcessEventSink = (channel: string, payload: unknown) => void

export class ProcessRuntimeSupport {
  private readonly states = new Map<string, ToolRuntimeState>()
  private readonly logs = new Map<string, LogLine[]>()

  constructor(
    private readonly onEvent?: ProcessEventSink,
    private readonly receipts?: ReceiptStore,
  ) {}

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
    return this.logs.get(toolId) || []
  }

  clearLogs(toolId: string): void {
    this.logs.set(toolId, [])
  }

  appendLog(toolId: string, stream: LogLine['stream'], chunk: string): void {
    const lines = chunk.replace(/\r\n/g, '\n').split('\n')
    const bucket = this.logs.get(toolId) || []
    const at = new Date().toISOString()

    for (const text of lines) {
      if (!text && lines.length > 1) continue
      if (!text) continue
      const entry: LogLine = {
        toolId,
        stream,
        text: maskSecrets(text),
        at,
      }
      bucket.push(entry)
      this.emit('logs:line', entry)
    }

    while (bucket.length > MAX_LOG_LINES) bucket.shift()
    this.logs.set(toolId, bucket)
  }

  setState(toolId: string, state: ToolRuntimeState): ToolRuntimeState {
    this.states.set(toolId, state)
    this.emit('process:update', state)
    return state
  }

  beginReceipt(input: Parameters<ReceiptStore['begin']>[0]): RunReceipt | undefined {
    if (!this.receipts) return undefined
    const receipt = this.receipts.begin(input)
    this.emit('receipts:update', receipt)
    return receipt
  }

  markReceiptRunning(
    id: string | undefined,
    patch: { pid?: number; port?: number; url?: string; message?: string },
  ): void {
    if (!id || !this.receipts) return
    const receipt = this.receipts.markRunning(id, patch)
    if (receipt) this.emit('receipts:update', receipt)
  }

  endReceipt(
    id: string | undefined,
    input: Parameters<ReceiptStore['end']>[1],
  ): void {
    if (!id || !this.receipts) return
    const receipt = this.receipts.end(id, input)
    if (receipt) this.emit('receipts:update', receipt)
  }

  emitFailedReceipt(input: Parameters<ReceiptStore['recordFailed']>[0]): void {
    if (!this.receipts) return
    const receipt = this.receipts.recordFailed(input)
    this.emit('receipts:update', receipt)
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
