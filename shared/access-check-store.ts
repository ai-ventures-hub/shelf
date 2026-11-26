/**
 * What Shelf last saw when it actually tried a tool's declared interface.
 * Kept apart from library.json: these are observations, not configuration,
 * and both the app and every MCP server process write them.
 */
import fs from 'node:fs'
import path from 'node:path'
import { atomicWriteFileSync, withFileLockSync } from './atomic-file'
import type { AccessCheck } from './contracts'
import { resolveShelfDataRoot } from './paths'

interface AccessChecksFile {
  version: 1
  /** toolId -> agentAccess id -> last check */
  checks: Record<string, Record<string, AccessCheck>>
}

export class AccessCheckStore {
  private readonly filePath: string

  constructor(root = resolveShelfDataRoot()) {
    fs.mkdirSync(root, { recursive: true })
    this.filePath = path.join(root, 'access-checks.json')
  }

  /** Last check per access id for one tool; empty when never checked. */
  forTool(toolId: string): Record<string, AccessCheck> {
    return this.read().checks[toolId] || {}
  }

  record(toolId: string, accessId: string, check: AccessCheck): void {
    withFileLockSync(this.filePath, () => {
      const data = this.read()
      data.checks[toolId] = { ...(data.checks[toolId] || {}), [accessId]: check }
      this.write(data)
    })
  }

  /** Drop checks for interfaces that no longer exist (or the whole tool). */
  prune(toolId: string, keepAccessIds: string[] = []): void {
    withFileLockSync(this.filePath, () => {
      const data = this.read()
      const current = data.checks[toolId]
      if (!current) return
      const kept = Object.fromEntries(Object.entries(current).filter(([id]) => keepAccessIds.includes(id)))
      if (Object.keys(kept).length) data.checks[toolId] = kept
      else delete data.checks[toolId]
      this.write(data)
    })
  }

  private read(): AccessChecksFile {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as Partial<AccessChecksFile>
      if (parsed && typeof parsed.checks === 'object' && parsed.checks) return { version: 1, checks: parsed.checks }
    } catch {
      // Missing or unreadable: observations are disposable, start empty.
    }
    return { version: 1, checks: {} }
  }

  private write(data: AccessChecksFile): void {
    atomicWriteFileSync(this.filePath, JSON.stringify(data, null, 2))
  }
}
