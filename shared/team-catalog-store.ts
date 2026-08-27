/**
 * Subscribed team catalogs (team-catalogs.json — never mixed into
 * library.json). Same durability contract as the other stores: atomic writes,
 * cross-process file lock, corrupt-backup-reset, normalize on read.
 *
 * The record holds only what the GUI renders: where the catalog came from,
 * when it was last fetched, and the entries from the last successful read.
 * The working clone lives at `<data root>/catalogs/<id>` and its path is
 * derived, never stored — the same rule `stagePath` follows, so a
 * hand-edited record can't point Shelf's git commands at an arbitrary
 * directory.
 */
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { atomicWriteFileSync, withFileLockSync } from './atomic-file'
import { resolveShelfDataRoot } from './paths'
import { stripInvisibleChars } from './types'
import type { CatalogEntry } from './team-catalog'

/** A subscribed catalog as persisted and as the renderer sees it. */
export interface TeamCatalog {
  id: string
  /** Clone URL, already through validateRepoUrl when it was added. */
  url: string
  /** The catalog file's own name when it has one, else derived from the URL. */
  name: string
  addedAt: string
  lastFetchedAt?: string
  /** Last refresh failure in plain language; cleared by the next success. */
  lastError?: string
  /** Normalizer warnings from the last successful read (skipped rows, caps). */
  warnings?: string[]
  /** True when a local "Share with team" commit has not reached the remote. */
  hasUnpushedEntry?: boolean
  entries: CatalogEntry[]
}

export interface TeamCatalogsFile {
  version: 1
  catalogs: TeamCatalog[]
}

const EMPTY: TeamCatalogsFile = { version: 1, catalogs: [] }

function normalizeEntry(raw: unknown): CatalogEntry | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const row = raw as Record<string, unknown>
  const name = typeof row.name === 'string' ? stripInvisibleChars(row.name).trim() : ''
  const repo = typeof row.repo === 'string' ? row.repo.trim() : ''
  if (!name || !repo) return null
  return {
    name,
    description:
      typeof row.description === 'string' ? stripInvisibleChars(row.description).trim() : undefined,
    capabilities: Array.isArray(row.capabilities)
      ? row.capabilities.filter((c): c is string => typeof c === 'string')
      : [],
    repo,
  }
}

function normalizeCatalogRecord(raw: unknown): TeamCatalog {
  const row = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const id = typeof row.id === 'string' && row.id.trim() ? row.id.trim() : randomUUID()
  const url = typeof row.url === 'string' ? row.url.trim() : ''
  const name =
    typeof row.name === 'string' && stripInvisibleChars(row.name).trim()
      ? stripInvisibleChars(row.name).trim()
      : nameFromUrl(url)
  return {
    id,
    url,
    name,
    addedAt: typeof row.addedAt === 'string' ? row.addedAt : new Date().toISOString(),
    lastFetchedAt: typeof row.lastFetchedAt === 'string' ? row.lastFetchedAt : undefined,
    lastError: typeof row.lastError === 'string' ? row.lastError : undefined,
    warnings: Array.isArray(row.warnings)
      ? row.warnings.filter((w): w is string => typeof w === 'string')
      : undefined,
    hasUnpushedEntry: row.hasUnpushedEntry === true ? true : undefined,
    entries: Array.isArray(row.entries)
      ? row.entries.map(normalizeEntry).filter((e): e is CatalogEntry => e !== null)
      : [],
  }
}

/** "github.com/your-team/tools" reads better than the whole clone URL. */
export function nameFromUrl(url: string): string {
  const trimmed = url.replace(/\.git$/i, '').replace(/\/+$/, '')
  const scp = /^[^/]+@([^:]+):(.+)$/.exec(trimmed)
  if (scp) return `${scp[1]}/${scp[2]}`
  try {
    const parsed = new URL(trimmed)
    return `${parsed.hostname}${parsed.pathname}`
  } catch {
    return trimmed || 'Team catalog'
  }
}

export class TeamCatalogStore {
  private readonly filePath: string
  private readonly clonesRoot: string

  constructor(root = resolveShelfDataRoot()) {
    fs.mkdirSync(root, { recursive: true })
    this.filePath = path.join(root, 'team-catalogs.json')
    this.clonesRoot = path.join(root, 'catalogs')
    fs.mkdirSync(this.clonesRoot, { recursive: true })
    withFileLockSync(this.filePath, () => {
      if (!fs.existsSync(this.filePath)) {
        this.write({ ...EMPTY })
        return
      }
      try {
        const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as Partial<TeamCatalogsFile>
        if (!Array.isArray(parsed.catalogs)) throw new Error('missing catalogs array')
        // Stable normalization, same reasoning as DesignProfileStore: a junk
        // id gets synthesized once and persisted, so list() ids never dangle.
        const normalized = parsed.catalogs.map(normalizeCatalogRecord)
        if (JSON.stringify(normalized) !== JSON.stringify(parsed.catalogs)) {
          this.write({ version: 1, catalogs: normalized })
        }
      } catch {
        const stamp = new Date().toISOString().replace(/[:.]/g, '-')
        fs.copyFileSync(this.filePath, path.join(root, `team-catalogs.corrupt-backup-${stamp}.json`))
        this.write({ ...EMPTY })
      }
    })
  }

  /** Where a catalog's working clone lives. Derived from the id, never stored. */
  clonePath(id: string): string {
    // The id is either a synthesized uuid or a hand-edited string; basename
    // it so a record can never aim git at a path outside the clones root.
    const safe = path.basename(id).replace(/[^A-Za-z0-9._-]/g, '')
    if (!safe || safe.startsWith('.')) throw new Error(`Invalid catalog id: ${id}`)
    return path.join(this.clonesRoot, safe)
  }

  list(): TeamCatalog[] {
    return this.read().catalogs.slice().sort((a, b) => a.name.localeCompare(b.name))
  }

  get(id: string): TeamCatalog | undefined {
    return this.read().catalogs.find((c) => c.id === id)
  }

  findByUrl(url: string): TeamCatalog | undefined {
    const key = url.trim().toLowerCase()
    return this.read().catalogs.find((c) => c.url.toLowerCase() === key)
  }

  /** Subscribe. Re-adding a URL already present returns the existing record. */
  add(url: string, name?: string): TeamCatalog {
    return withFileLockSync(this.filePath, () => {
      const data = this.read()
      const key = url.trim().toLowerCase()
      const existing = data.catalogs.find((c) => c.url.toLowerCase() === key)
      if (existing) return existing
      const catalog: TeamCatalog = {
        id: randomUUID(),
        url: url.trim(),
        name: name?.trim() || nameFromUrl(url),
        addedAt: new Date().toISOString(),
        entries: [],
      }
      data.catalogs.push(catalog)
      this.write(data)
      return catalog
    })
  }

  /** Shallow-merge a patch onto one record. Unknown id is a no-op. */
  update(id: string, patch: Partial<Omit<TeamCatalog, 'id'>>): TeamCatalog | undefined {
    return withFileLockSync(this.filePath, () => {
      const data = this.read()
      const index = data.catalogs.findIndex((c) => c.id === id)
      if (index < 0) return undefined
      const next: TeamCatalog = { ...data.catalogs[index], ...patch, id }
      // undefined in a patch means "clear it", which a spread preserves only
      // because the keys are explicitly present on the patch object.
      data.catalogs[index] = next
      this.write(data)
      return next
    })
  }

  /** Unsubscribe and delete the working clone. Installed tools are untouched. */
  remove(id: string): boolean {
    const removed = withFileLockSync(this.filePath, () => {
      const data = this.read()
      const index = data.catalogs.findIndex((c) => c.id === id)
      if (index < 0) return false
      data.catalogs.splice(index, 1)
      this.write(data)
      return true
    })
    if (removed) {
      try {
        fs.rmSync(this.clonePath(id), { recursive: true, force: true })
      } catch {
        /* a leftover clone is harmless; the next add uses a fresh id */
      }
    }
    return removed
  }

  private read(): TeamCatalogsFile {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as Partial<TeamCatalogsFile>
      if (!Array.isArray(parsed.catalogs)) return { ...EMPTY }
      return { version: 1, catalogs: parsed.catalogs.map(normalizeCatalogRecord) }
    } catch {
      return { ...EMPTY }
    }
  }

  private write(data: TeamCatalogsFile): void {
    atomicWriteFileSync(this.filePath, `${JSON.stringify(data, null, 2)}\n`)
  }
}
