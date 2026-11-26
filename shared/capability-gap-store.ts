import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { atomicWriteFileSync, withFileLockSync } from './atomic-file'
import { normalizeCapabilities } from './capability-intelligence'
import { resolveShelfDataRoot } from './paths'
import type {
  AgentAccessKind,
  CapabilityGap,
  CapabilityGapsFile,
  CapabilityGapStatus,
} from './types'

const MAX_EXAMPLES = 5
/** Gaps Shelf noted from unmatched searches (not ones an agent recorded on purpose). */
const MAX_SEARCH_GAPS = 100

export interface RecordCapabilityGapInput {
  task: string
  capabilities: string[]
  reason: string
  relatedToolIds?: string[]
  suggestedAccess?: AgentAccessKind
}

export class CapabilityGapStore {
  private readonly filePath: string

  constructor(root = resolveShelfDataRoot()) {
    fs.mkdirSync(root, { recursive: true })
    this.filePath = path.join(root, 'capability-gaps.json')
    withFileLockSync(this.filePath, () => {
      if (!fs.existsSync(this.filePath)) {
        this.write({ version: 1, gaps: [] })
        return
      }
      try {
        const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as Partial<CapabilityGapsFile>
        if (!Array.isArray(parsed.gaps)) throw new Error('missing gaps array')
      } catch {
        const stamp = new Date().toISOString().replace(/[:.]/g, '-')
        fs.copyFileSync(this.filePath, path.join(root, `capability-gaps.corrupt-backup-${stamp}.json`))
        this.write({ version: 1, gaps: [] })
      }
    })
  }

  list(opts: { status?: CapabilityGapStatus; limit?: number } = {}): CapabilityGap[] {
    const limit = Math.max(1, Math.min(opts.limit ?? 100, 200))
    return this.read()
      .gaps.filter((gap) => !opts.status || gap.status === opts.status)
      .sort((a, b) => Date.parse(b.lastRequestedAt) - Date.parse(a.lastRequestedAt))
      .slice(0, limit)
  }

  /** Uncapped id lookup — list() caps at 200 and would hide older gaps. */
  get(id: string): CapabilityGap | undefined {
    return this.read().gaps.find((gap) => gap.id === id)
  }

  /** Every gap, uncapped — for suggestion matching, which must not skip old gaps. */
  listAll(): CapabilityGap[] {
    return this.read().gaps.slice()
  }

  record(input: RecordCapabilityGapInput): { action: 'created' | 'updated'; gap: CapabilityGap } {
    const task = input.task.trim().replace(/\s+/g, ' ')
    const reason = input.reason.trim().replace(/\s+/g, ' ')
    const capabilities = normalizeCapabilities(input.capabilities)
    if (!task) throw new Error('Task is required.')
    if (!reason) throw new Error('Reason is required.')
    if (capabilities.length === 0) throw new Error('At least one capability is required.')
    const fingerprint = gapFingerprint(capabilities)

    return withFileLockSync(this.filePath, () => {
      const data = this.read()
      const index = data.gaps.findIndex((gap) => gapFingerprint(gap.capabilities) === fingerprint)
      const now = new Date().toISOString()
      if (index >= 0) {
        const existing = data.gaps[index]
        const examples = [
          { task, at: now },
          ...existing.examples.filter((example) => example.task.toLowerCase() !== task.toLowerCase()),
        ].slice(0, MAX_EXAMPLES)
        const gap: CapabilityGap = {
          ...existing,
          task,
          reason,
          relatedToolIds: unique([...(existing.relatedToolIds || []), ...(input.relatedToolIds || [])]),
          suggestedAccess: input.suggestedAccess ?? existing.suggestedAccess,
          // An agent has now described the need on purpose.
          source: 'agent',
          status:
            existing.status === 'resolved' || existing.status === 'dismissed'
              ? 'open'
              : existing.status,
          occurrenceCount: existing.occurrenceCount + 1,
          examples,
          updatedAt: now,
          lastRequestedAt: now,
        }
        data.gaps[index] = gap
        this.write(data)
        return { action: 'updated', gap }
      }

      const gap: CapabilityGap = {
        id: randomUUID(),
        capabilities,
        task,
        reason,
        relatedToolIds: unique(input.relatedToolIds || []),
        suggestedAccess: input.suggestedAccess,
        status: 'open',
        occurrenceCount: 1,
        examples: [{ task, at: now }],
        createdAt: now,
        updatedAt: now,
        lastRequestedAt: now,
      }
      data.gaps.unshift(gap)
      this.write(data)
      return { action: 'created', gap }
    })
  }

  /**
   * Note a capability search that matched nothing. The searched text is the
   * capability, so the same wording counts up instead of piling up. Unlike
   * record(), this never reopens a gap the user resolved or dismissed: a
   * search is not a request, and their decision stands.
   */
  recordSearchMiss(input: { task: string; client?: string }): { action: 'created' | 'updated' | 'ignored'; gap?: CapabilityGap } {
    const task = input.task.trim().replace(/\s+/g, ' ').slice(0, 200)
    const capabilities = normalizeCapabilities([task])
    if (!task || capabilities.length === 0) return { action: 'ignored' }
    const fingerprint = gapFingerprint(capabilities)
    const client = input.client?.trim().slice(0, 80) || undefined

    return withFileLockSync(this.filePath, () => {
      const data = this.read()
      const index = data.gaps.findIndex((gap) => gapFingerprint(gap.capabilities) === fingerprint)
      const now = new Date().toISOString()
      if (index >= 0) {
        const existing = data.gaps[index]
        const gap: CapabilityGap = {
          ...existing,
          occurrenceCount: existing.occurrenceCount + 1,
          client: client ?? existing.client,
          lastRequestedAt: now,
          updatedAt: now,
        }
        data.gaps[index] = gap
        this.write(data)
        // Counted, but the user closed this one: nothing new is shown to them.
        const closed = existing.status === 'resolved' || existing.status === 'dismissed'
        return { action: closed ? 'ignored' : 'updated', gap }
      }
      const gap: CapabilityGap = {
        id: randomUUID(),
        capabilities,
        task,
        reason: 'A search for this found no tool in the library.',
        relatedToolIds: [],
        status: 'open',
        occurrenceCount: 1,
        examples: [{ task, at: now }],
        createdAt: now,
        updatedAt: now,
        lastRequestedAt: now,
        source: 'search',
        client,
      }
      data.gaps.unshift(gap)
      // Searches are cheap to make and each wording is its own entry, so the
      // noted ones are capped: the least recently asked go first.
      const noted = data.gaps
        .filter((item) => item.source === 'search')
        .sort((a, b) => Date.parse(b.lastRequestedAt) - Date.parse(a.lastRequestedAt))
      if (noted.length > MAX_SEARCH_GAPS) {
        const drop = new Set(noted.slice(MAX_SEARCH_GAPS).map((item) => item.id))
        data.gaps = data.gaps.filter((item) => !drop.has(item.id))
      }
      this.write(data)
      return { action: 'created', gap }
    })
  }

  updateStatus(id: string, status: CapabilityGapStatus): CapabilityGap {
    return this.update(id, { status })
  }

  /**
   * Partial update. relatedToolIds merge (never replace) so an agent
   * attaching its in-progress tool cannot drop earlier references. Status
   * policy (e.g. agents may only set 'planned') is enforced by callers —
   * the GUI uses the full status set. When `refuseIfClosed` is set, the
   * resolved/dismissed guard executes atomically inside the file lock.
   */
  update(
    id: string,
    patch: { status?: CapabilityGapStatus; relatedToolIds?: string[]; refuseIfClosed?: boolean },
  ): CapabilityGap {
    return withFileLockSync(this.filePath, () => {
      const data = this.read()
      const gap = data.gaps.find((item) => item.id === id)
      if (!gap) throw new Error(`Capability gap not found: ${id}`)
      if (patch.refuseIfClosed && (gap.status === 'resolved' || gap.status === 'dismissed')) {
        throw new Error(
          `Gap is ${gap.status} — the user decided this in the GUI. Record a new gap if the need genuinely returns.`,
        )
      }
      if (patch.status) gap.status = patch.status
      if (patch.relatedToolIds?.length) {
        gap.relatedToolIds = unique([...gap.relatedToolIds, ...patch.relatedToolIds])
      }
      gap.updatedAt = new Date().toISOString()
      this.write(data)
      return gap
    })
  }

  /** Hide one tool's resolve suggestion for this gap; the gap itself stays open. */
  dismissSuggestion(id: string, toolId: string): CapabilityGap {
    return withFileLockSync(this.filePath, () => {
      const data = this.read()
      const gap = data.gaps.find((item) => item.id === id)
      if (!gap) throw new Error(`Capability gap not found: ${id}`)
      gap.suggestionDismissedToolIds = unique([
        ...(gap.suggestionDismissedToolIds || []),
        toolId,
      ])
      gap.updatedAt = new Date().toISOString()
      this.write(data)
      return gap
    })
  }

  delete(id: string): void {
    withFileLockSync(this.filePath, () => {
      const data = this.read()
      const before = data.gaps.length
      data.gaps = data.gaps.filter((gap) => gap.id !== id)
      if (data.gaps.length === before) throw new Error(`Capability gap not found: ${id}`)
      this.write(data)
    })
  }

  private read(): CapabilityGapsFile {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as CapabilityGapsFile
      if (!Array.isArray(parsed.gaps)) throw new Error('missing gaps array')
      return { version: 1, gaps: parsed.gaps }
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      throw new Error(`Shelf could not read capability-gaps.json: ${detail}`)
    }
  }

  private write(data: CapabilityGapsFile): void {
    atomicWriteFileSync(this.filePath, JSON.stringify(data, null, 2))
  }
}

function gapFingerprint(capabilities: string[]): string {
  return normalizeCapabilities(capabilities)
    .map((capability) => capability.toLowerCase())
    .sort()
    .join('|')
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)))
}
