import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { atomicWriteFileSync, withFileLockSync } from './atomic-file'
import { resolveAppDataRoot, resolveShelfDataRoot } from './paths'
import type { Collection, LibraryFile, Tool } from './types'

/**
 * Persists the tool library under a stable Application Support root.
 * Icons are stored as absolute paths (or under icons/) — never inline base64.
 * Schema v2 adds collections; v1 files migrate on read with a backup.
 */
export class LibraryStore {
  private readonly root: string
  private readonly filePath: string
  private readonly iconsDir: string

  constructor(root = resolveShelfDataRoot()) {
    this.root = root
    this.filePath = path.join(this.root, 'library.json')
    this.iconsDir = path.join(this.root, 'icons')
    fs.mkdirSync(this.root, { recursive: true })
    fs.mkdirSync(this.iconsDir, { recursive: true })

    // Recover tools from earlier nested/dev paths so relaunches do not look empty.
    if (
      !process.env.SHELF_DATA_ROOT?.trim() &&
      path.resolve(root) === path.resolve(resolveShelfDataRoot())
    ) {
      migrateLegacyLibraries(this.filePath, this.iconsDir)
    }

    withFileLockSync(this.filePath, () => {
      if (!fs.existsSync(this.filePath)) {
        this.write({ version: 2, tools: [], collections: [] })
        return
      }

      // Migrate v1 → v2 once. Preserve invalid data before starting clean.
      try {
        const existing = JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as
          | Partial<LibraryFile>
          | null
        if (!existing || !Array.isArray(existing.tools)) {
          this.backupCorruptLibrary()
          this.write({ version: 2, tools: [], collections: [] })
        } else if (existing.version !== 2) {
          this.write(this.read())
        }
      } catch {
        this.backupCorruptLibrary()
        this.write({ version: 2, tools: [], collections: [] })
      }
    })
  }

  list(): Tool[] {
    return this.read().tools.slice().sort((a, b) => {
      if (a.favorite !== b.favorite) return a.favorite ? -1 : 1
      return a.name.localeCompare(b.name)
    })
  }

  get(id: string): Tool | undefined {
    return this.read().tools.find((t) => t.id === id)
  }

  findByName(name: string): Tool | undefined {
    const needle = name.trim().toLowerCase()
    return this.read().tools.find((t) => t.name.trim().toLowerCase() === needle)
  }

  save(input: Tool): Tool {
    return withFileLockSync(this.filePath, () => {
      const data = this.read()
      const now = new Date().toISOString()
      const existing = data.tools.findIndex((t) => t.id === input.id)

      const tool: Tool = {
        ...input,
        id: input.id || randomUUID(),
        name: input.name.trim(),
        tags: (input.tags || []).map((t) => t.trim()).filter(Boolean),
        favorite: Boolean(input.favorite),
        launchCommand: input.launchCommand.trim(),
        stopCommand: input.stopCommand?.trim() || undefined,
        description: input.description?.trim() || undefined,
        projectPath: input.projectPath?.trim() || undefined,
        url: input.url?.trim() || undefined,
        notes: input.notes?.trim() || undefined,
        iconPath: input.iconPath?.trim() || undefined,
        iconLucide: input.iconLucide?.trim() || undefined,
        iconColor: input.iconColor?.trim() || undefined,
        iconBackground: input.iconBackground?.trim() || undefined,
        updatedAt: now,
        createdAt: existing >= 0 ? data.tools[existing].createdAt : input.createdAt || now,
      }

      if (existing >= 0) data.tools[existing] = tool
      else data.tools.push(tool)

      this.write(data)
      return tool
    })
  }

  delete(id: string): void {
    withFileLockSync(this.filePath, () => {
      const data = this.read()
      data.tools = data.tools.filter((t) => t.id !== id)
      data.collections = data.collections.map((c) => ({
        ...c,
        toolIds: c.toolIds.filter((tid) => tid !== id),
        updatedAt: new Date().toISOString(),
      }))
      this.write(data)
    })
  }

  touchLastLaunched(id: string): void {
    withFileLockSync(this.filePath, () => {
      const data = this.read()
      const tool = data.tools.find((t) => t.id === id)
      if (!tool) return
      tool.lastLaunchedAt = new Date().toISOString()
      tool.updatedAt = tool.lastLaunchedAt
      this.write(data)
    })
  }

  listCollections(): Collection[] {
    return this.read().collections.slice().sort((a, b) => a.name.localeCompare(b.name))
  }

  getCollection(id: string): Collection | undefined {
    return this.read().collections.find((c) => c.id === id)
  }

  saveCollection(input: Omit<Collection, 'createdAt' | 'updatedAt'> & {
    createdAt?: string
    updatedAt?: string
  }): Collection {
    return withFileLockSync(this.filePath, () => {
      const data = this.read()
      const now = new Date().toISOString()
      const existing = data.collections.findIndex((c) => c.id === input.id)
      const knownToolIds = new Set(data.tools.map((t) => t.id))

      const collection: Collection = {
        id: input.id || randomUUID(),
        name: input.name.trim(),
        description: input.description?.trim() || undefined,
        toolIds: Array.from(
          new Set((input.toolIds || []).filter((id) => knownToolIds.has(id))),
        ),
        createdAt:
          existing >= 0
            ? data.collections[existing].createdAt
            : input.createdAt || now,
        updatedAt: now,
      }

      if (existing >= 0) data.collections[existing] = collection
      else data.collections.push(collection)

      this.write(data)
      return collection
    })
  }

  deleteCollection(id: string): void {
    withFileLockSync(this.filePath, () => {
      const data = this.read()
      data.collections = data.collections.filter((c) => c.id !== id)
      this.write(data)
    })
  }

  getIconsDir(): string {
    return this.iconsDir
  }

  getRoot(): string {
    return this.root
  }

  getLibraryPath(): string {
    return this.filePath
  }

  private read(): LibraryFile {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf8')
      const parsed = JSON.parse(raw) as Partial<LibraryFile> & { version?: number }
      if (!parsed.tools || !Array.isArray(parsed.tools)) throw new Error('missing tools array')
      const collections = Array.isArray(parsed.collections) ? parsed.collections : []
      return {
        version: 2,
        tools: parsed.tools,
        collections: collections.map(normalizeCollection),
      }
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      throw new Error(`Shelf could not read library.json: ${detail}`)
    }
  }

  private write(data: LibraryFile): void {
    const normalized: LibraryFile = {
      version: 2,
      tools: data.tools,
      collections: (data.collections || []).map(normalizeCollection),
    }

    // Backup once when upgrading an existing v1 (or unknown) file.
    if (fs.existsSync(this.filePath)) {
      try {
        const existing = JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as {
          version?: number
        }
        if (existing.version !== 2) {
          const stamp = new Date().toISOString().replace(/[:.]/g, '-')
          const backup = path.join(this.root, `library.v1-backup-${stamp}.json`)
          fs.copyFileSync(this.filePath, backup)
        }
      } catch {
        // ignore backup failures; write still proceeds
      }
    }

    atomicWriteFileSync(this.filePath, JSON.stringify(normalized, null, 2))
  }

  private backupCorruptLibrary(): void {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const backup = path.join(this.root, `library.corrupt-backup-${stamp}.json`)
    fs.copyFileSync(this.filePath, backup)
  }
}

function normalizeCollection(input: Partial<Collection>): Collection {
  const now = new Date().toISOString()
  return {
    id: input.id || randomUUID(),
    name: (input.name || 'Untitled').trim(),
    description: input.description?.trim() || undefined,
    toolIds: Array.isArray(input.toolIds) ? input.toolIds.filter(Boolean) : [],
    createdAt: input.createdAt || now,
    updatedAt: input.updatedAt || now,
  }
}

function readLibraryFile(filePath: string): LibraryFile | null {
  try {
    if (!fs.existsSync(filePath)) return null
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as Partial<LibraryFile>
    if (!parsed?.tools || !Array.isArray(parsed.tools)) return null
    return {
      version: 2,
      tools: parsed.tools,
      collections: Array.isArray(parsed.collections)
        ? parsed.collections.map(normalizeCollection)
        : [],
    }
  } catch {
    return null
  }
}

function libraryToolCount(filePath: string): number {
  return readLibraryFile(filePath)?.tools.length ?? 0
}

function migrateLegacyLibraries(canonicalPath: string, iconsDir: string): void {
  const appData = resolveAppDataRoot()
  const candidates = [
    path.join(appData, 'shelf', 'Shelf', 'library.json'),
    path.join(appData, 'Shelf', 'Shelf', 'library.json'),
    path.join(appData, 'Electron', 'Shelf', 'library.json'),
    path.join(appData, 'Electron', 'library.json'),
  ]

  const currentCount = libraryToolCount(canonicalPath)
  if (currentCount > 0) return

  let best: LibraryFile | null = null
  let bestSource: string | null = null
  for (const candidate of candidates) {
    if (path.resolve(candidate) === path.resolve(canonicalPath)) continue
    const data = readLibraryFile(candidate)
    if (!data || data.tools.length === 0) continue
    if (!best || data.tools.length > best.tools.length) {
      best = data
      bestSource = candidate
    }
  }

  if (!best || !bestSource) return

  fs.mkdirSync(path.dirname(canonicalPath), { recursive: true })
  atomicWriteFileSync(canonicalPath, JSON.stringify(best, null, 2))

  const legacyIcons = path.join(path.dirname(bestSource), 'icons')
  if (fs.existsSync(legacyIcons)) {
    for (const name of fs.readdirSync(legacyIcons)) {
      const from = path.join(legacyIcons, name)
      const to = path.join(iconsDir, name)
      if (!fs.existsSync(to) && fs.statSync(from).isFile()) {
        fs.copyFileSync(from, to)
      }
    }
  }

  const legacyIconsPrefix = path.join(path.dirname(bestSource), 'icons')
  let changed = false
  for (const tool of best.tools) {
    if (tool.iconPath?.startsWith(legacyIconsPrefix)) {
      tool.iconPath = path.join(iconsDir, path.basename(tool.iconPath))
      changed = true
    }
  }
  if (changed) {
    atomicWriteFileSync(canonicalPath, JSON.stringify(best, null, 2))
  }
}
