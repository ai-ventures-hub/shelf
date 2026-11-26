/**
 * When an agent last used each tool through Shelf, and which run (if any)
 * Shelf started by itself to serve such a call. This is the only "in use"
 * signal Shelf has: it cannot see a person using the tool in a browser, so a
 * run is only ever a candidate for idle stop while `onDemandReceiptId` names
 * it, and anything the user does with the tool clears that.
 */
import fs from 'node:fs'
import path from 'node:path'
import { atomicWriteFileSync, withFileLockSync } from './atomic-file'
import { resolveShelfDataRoot } from './paths'

export interface ToolUse {
  lastUsedAt: string
  /** The MCP client that made the last call, as it names itself. */
  client?: string
  calls: number
  /** Receipt of the run Shelf started for an agent call; absent once the user has taken the tool over. */
  onDemandReceiptId?: string
}

interface ToolUseFile {
  version: 1
  uses: Record<string, ToolUse>
}

const WRITE_EVERY_MS = 10_000

export class ToolUseStore {
  private readonly filePath: string
  private readonly lastWrite = new Map<string, number>()

  constructor(root = resolveShelfDataRoot()) {
    fs.mkdirSync(root, { recursive: true })
    this.filePath = path.join(root, 'tool-use.json')
  }

  get(toolId: string): ToolUse | undefined {
    return this.read().uses[toolId]
  }

  all(): Record<string, ToolUse> {
    return this.read().uses
  }

  /**
   * Record an agent call. Calls arrive in bursts, so plain touches are written
   * at most once per tool every 10 seconds; a new on-demand run is always written.
   */
  touch(toolId: string, input: { client?: string; onDemandReceiptId?: string } = {}): void {
    const now = Date.now()
    if (!input.onDemandReceiptId && now - (this.lastWrite.get(toolId) || 0) < WRITE_EVERY_MS) return
    this.lastWrite.set(toolId, now)
    withFileLockSync(this.filePath, () => {
      const data = this.read()
      const current = data.uses[toolId]
      data.uses[toolId] = {
        lastUsedAt: new Date(now).toISOString(),
        client: input.client ?? current?.client,
        calls: (current?.calls || 0) + 1,
        onDemandReceiptId: input.onDemandReceiptId ?? current?.onDemandReceiptId,
      }
      this.write(data)
    })
  }

  /** The user launched, restarted, or opened the tool: it is theirs now and is never stopped for idleness. */
  claim(toolId: string): void {
    withFileLockSync(this.filePath, () => {
      const data = this.read()
      const current = data.uses[toolId]
      if (!current?.onDemandReceiptId) return
      const { onDemandReceiptId: _released, ...kept } = current
      data.uses[toolId] = kept
      this.write(data)
    })
  }

  forget(toolId: string): void {
    withFileLockSync(this.filePath, () => {
      const data = this.read()
      if (!data.uses[toolId]) return
      delete data.uses[toolId]
      this.write(data)
    })
  }

  private read(): ToolUseFile {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as Partial<ToolUseFile>
      if (parsed && typeof parsed.uses === 'object' && parsed.uses) return { version: 1, uses: parsed.uses }
    } catch {
      // Missing or unreadable: usage is an observation, start empty.
    }
    return { version: 1, uses: {} }
  }

  private write(data: ToolUseFile): void {
    atomicWriteFileSync(this.filePath, JSON.stringify(data, null, 2))
  }
}
