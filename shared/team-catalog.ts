/**
 * Team Tools catalog format (v1.4, docs/SHARING.md stage 2).
 *
 * A "team" is a git repo holding one `catalog.json`. THE FILE CARRIES
 * POINTERS, NEVER PAYLOAD: an entry names a tool and the repo it lives in,
 * and nothing else. Launch command, setup steps, and env keys come from that
 * repo's own `shelf.json` at install time, and the consent sheet renders them
 * verbatim then. A hostile catalog can point at a bad repo; it can never
 * change what a good repo runs. Keep it that way — an entry field that
 * described execution would move the trust boundary.
 *
 * A catalog read off a remote is UNTRUSTED INPUT, so `normalizeCatalog` gives
 * it the same treatment `normalizeManifest` gives a manifest: bounded counts,
 * bounded strings, entries with an unusable repo dropped and counted, and
 * invisible characters stripped from names that will be rendered one click
 * from an install (the 1.3 look-alike lesson).
 */
import fs from 'node:fs'
import path from 'node:path'
import { stripInvisibleChars } from './types'
import { validateRepoUrl } from './tool-share'

export const CATALOG_FILENAME = 'catalog.json'
export const CATALOG_VERSION = 1 as const

const MAX_CATALOG_BYTES = 512 * 1024
const MAX_ENTRIES = 500
const MAX_NAME = 80
const MAX_DESCRIPTION = 500
const MAX_CAPABILITIES = 40
const MAX_CAPABILITY = 200
const MAX_REPO = 2048
/** Warnings shown to the user; the rest are summarized as a count. */
const MAX_WARNINGS = 10

/** One tool in a team catalog. `repo` is the only actionable field. */
export interface CatalogEntry {
  name: string
  description?: string
  capabilities: string[]
  repo: string
}

export interface TeamCatalogFile {
  shelfCatalog: typeof CATALOG_VERSION
  name?: string
  tools: CatalogEntry[]
}

export interface NormalizedCatalog {
  catalog: TeamCatalogFile
  warnings: string[]
}

function stripControl(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
}

function cleanText(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const cleaned = stripInvisibleChars(stripControl(value)).replace(/\s+/g, ' ').trim()
  if (!cleaned) return undefined
  return cleaned.length > max ? cleaned.slice(0, max) : cleaned
}

function cleanList(value: unknown, max: number, itemMax: number): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  for (const item of value) {
    const cleaned = cleanText(item, itemMax)
    if (cleaned) out.push(cleaned)
    if (out.length >= max) break
  }
  return out
}

/**
 * Turn arbitrary JSON into a bounded, display-safe catalog. Never throws for
 * bad entries — a single malformed row must not cost the user the whole
 * catalog — but does throw when the document itself is not a catalog.
 */
export function normalizeCatalog(raw: unknown): NormalizedCatalog {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`${CATALOG_FILENAME} is not a JSON object.`)
  }
  const input = raw as Record<string, unknown>
  if (input.shelfCatalog !== CATALOG_VERSION) {
    throw new Error(
      `Unsupported catalog version (${String(input.shelfCatalog)}). This Shelf reads shelfCatalog: ${CATALOG_VERSION}.`,
    )
  }

  const warnings: string[] = []
  let dropped = 0
  const addWarning = (text: string) => {
    if (warnings.length < MAX_WARNINGS) warnings.push(text)
  }

  const tools: CatalogEntry[] = []
  const seenRepos = new Set<string>()
  const rawTools = Array.isArray(input.tools) ? input.tools : []
  if (!Array.isArray(input.tools)) {
    addWarning('The catalog has no tools list.')
  }

  let truncated = false
  for (const item of rawTools) {
    if (tools.length >= MAX_ENTRIES) {
      truncated = true
      break
    }
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      dropped += 1
      continue
    }
    const row = item as Record<string, unknown>
    const repoRaw = cleanText(row.repo, MAX_REPO)
    if (!repoRaw) {
      dropped += 1
      continue
    }
    const valid = validateRepoUrl(repoRaw)
    if (!valid.ok) {
      dropped += 1
      addWarning(`Skipped an entry Shelf can't fetch from: ${valid.reason}`)
      continue
    }
    // Same repo twice is a merge artifact, not two tools. First wins.
    const key = valid.url.toLowerCase()
    if (seenRepos.has(key)) {
      dropped += 1
      continue
    }
    seenRepos.add(key)
    const name = cleanText(row.name, MAX_NAME)
    if (!name) {
      dropped += 1
      addWarning(`Skipped an entry with no name (${valid.url}).`)
      continue
    }
    tools.push({
      name,
      description: cleanText(row.description, MAX_DESCRIPTION),
      capabilities: cleanList(row.capabilities, MAX_CAPABILITIES, MAX_CAPABILITY),
      repo: valid.url,
    })
  }

  if (truncated) {
    addWarning(`This catalog lists more than ${MAX_ENTRIES} tools; the rest were ignored.`)
  }
  if (dropped > 0) {
    addWarning(
      `${dropped} ${dropped === 1 ? 'entry' : 'entries'} in this catalog could not be read and ${
        dropped === 1 ? 'was' : 'were'
      } skipped.`,
    )
  }

  return {
    catalog: {
      shelfCatalog: CATALOG_VERSION,
      name: cleanText(input.name, MAX_NAME),
      tools,
    },
    warnings,
  }
}

/**
 * Read and normalize `catalog.json` from a checked-out catalog repo. Returns
 * null when the repo has no catalog file (a fresh team repo), so the caller
 * can offer to start one instead of erroring.
 */
export function readCatalogFile(repoPath: string): NormalizedCatalog | null {
  const file = path.join(repoPath, CATALOG_FILENAME)
  let stat: fs.Stats
  try {
    stat = fs.statSync(file)
  } catch {
    return null
  }
  if (!stat.isFile()) return null
  if (stat.size > MAX_CATALOG_BYTES) {
    throw new Error(
      `${CATALOG_FILENAME} is larger than ${Math.round(MAX_CATALOG_BYTES / 1024)} KB; Shelf won't read it.`,
    )
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (err) {
    throw new Error(
      `${CATALOG_FILENAME} in that repository isn't valid JSON: ${
        err instanceof Error ? err.message : String(err)
      }`,
    )
  }
  return normalizeCatalog(parsed)
}

/** Serialize a catalog the way a human would commit it (stable, 2-space). */
export function serializeCatalog(catalog: TeamCatalogFile): string {
  const ordered: TeamCatalogFile = {
    shelfCatalog: CATALOG_VERSION,
    ...(catalog.name ? { name: catalog.name } : {}),
    tools: catalog.tools.map((entry) => ({
      name: entry.name,
      ...(entry.description ? { description: entry.description } : {}),
      capabilities: entry.capabilities,
      repo: entry.repo,
    })),
  }
  return `${JSON.stringify(ordered, null, 2)}\n`
}

export function writeCatalogFile(repoPath: string, catalog: TeamCatalogFile): void {
  fs.writeFileSync(path.join(repoPath, CATALOG_FILENAME), serializeCatalog(catalog), 'utf8')
}

export type UpsertEntryResult = { action: 'added' | 'updated'; catalog: TeamCatalogFile }

/**
 * Add an entry, or update the one that already points at the same repo. A
 * team's catalog is edited by many hands through git; matching on repo (not
 * name) is what keeps a rename from producing two rows for one tool.
 */
export function upsertCatalogEntry(
  catalog: TeamCatalogFile,
  entry: CatalogEntry,
): UpsertEntryResult {
  const key = entry.repo.toLowerCase()
  const index = catalog.tools.findIndex((t) => t.repo.toLowerCase() === key)
  const tools = catalog.tools.slice()
  if (index >= 0) {
    tools[index] = entry
    return { action: 'updated', catalog: { ...catalog, tools } }
  }
  tools.push(entry)
  tools.sort((a, b) => a.name.localeCompare(b.name))
  return { action: 'added', catalog: { ...catalog, tools } }
}

export function emptyCatalog(name?: string): TeamCatalogFile {
  return { shelfCatalog: CATALOG_VERSION, ...(name ? { name } : {}), tools: [] }
}

/**
 * Raw, in-place editing of a team's `catalog.json`.
 *
 * Publish must never write back the NORMALIZED catalog: `normalizeCatalog`
 * drops rows it can't use and `serializeCatalog` emits only the four fields
 * this Shelf knows, so a normalize-then-write round trip silently deletes a
 * teammate's extra keys, rows past the caps, and duplicate-repo rows for the
 * whole team on the next push. Read the document as it is, change the one
 * entry, keep everything else. (ToolManifest preserves unknown keys on read
 * for the same reason.)
 */
export interface RawCatalog {
  doc: Record<string, unknown>
  tools: Record<string, unknown>[]
}

export function readRawCatalog(repoPath: string): RawCatalog | null {
  const file = path.join(repoPath, CATALOG_FILENAME)
  let stat: fs.Stats
  try {
    stat = fs.statSync(file)
  } catch {
    return null
  }
  if (!stat.isFile()) return null
  if (stat.size > MAX_CATALOG_BYTES) {
    throw new Error(
      `${CATALOG_FILENAME} is larger than ${Math.round(MAX_CATALOG_BYTES / 1024)} KB; Shelf won't read it.`,
    )
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (err) {
    throw new Error(
      `${CATALOG_FILENAME} in that repository isn't valid JSON: ${
        err instanceof Error ? err.message : String(err)
      }`,
    )
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${CATALOG_FILENAME} is not a JSON object.`)
  }
  const doc = parsed as Record<string, unknown>
  const tools = Array.isArray(doc.tools)
    ? (doc.tools.filter((t) => t && typeof t === 'object' && !Array.isArray(t)) as Record<
        string,
        unknown
      >[])
    : []
  return { doc, tools }
}

export function emptyRawCatalog(name?: string): RawCatalog {
  const doc: Record<string, unknown> = { shelfCatalog: CATALOG_VERSION, tools: [] }
  if (name) doc.name = name
  return { doc, tools: [] }
}

function rawRepo(row: Record<string, unknown>): string {
  return typeof row.repo === 'string' ? row.repo.trim().toLowerCase() : ''
}

/** Change (or append) one row, leaving that row's other keys intact. */
export function upsertRawEntry(raw: RawCatalog, entry: CatalogEntry): 'added' | 'updated' {
  const key = entry.repo.trim().toLowerCase()
  const fields: Record<string, unknown> = {
    name: entry.name,
    description: entry.description,
    capabilities: entry.capabilities,
    repo: entry.repo,
  }
  const index = raw.tools.findIndex((row) => rawRepo(row) === key)
  if (index >= 0) {
    raw.tools[index] = { ...raw.tools[index], ...fields }
    return 'updated'
  }
  raw.tools.push(fields)
  return 'added'
}

/** Re-apply rows the remote doesn't have; used when a push has to be rebased. */
export function mergeRawEntries(raw: RawCatalog, rows: Record<string, unknown>[]): number {
  let added = 0
  for (const row of rows) {
    const key = rawRepo(row)
    if (!key) continue
    if (raw.tools.some((existing) => rawRepo(existing) === key)) continue
    raw.tools.push(row)
    added += 1
  }
  return added
}

export function writeRawCatalog(repoPath: string, raw: RawCatalog): void {
  raw.doc.tools = raw.tools
  fs.writeFileSync(
    path.join(repoPath, CATALOG_FILENAME),
    `${JSON.stringify(raw.doc, null, 2)}\n`,
    'utf8',
  )
}
