/**
 * Design Engine profile store (design-profiles.json — never mixed into
 * library.json). Same durability contract as CapabilityGapStore: atomic
 * writes, cross-process file lock, corrupt-backup-reset.
 *
 * Write methods exist for the seed script and the v1.0 GUI editor phase;
 * the MCP surface is read-only — agents apply branding, Shelf serves it.
 *
 * Single-default invariant: save()/setDefault() keep at most one profile
 * with isDefault. A hand-edited file with several defaults is tolerated on
 * read (getDefault picks the first) and re-normalized on the next write.
 */
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { atomicWriteFileSync, withFileLockSync } from './atomic-file'
import { resolveShelfDataRoot } from './paths'
import type {
  DesignAsset,
  DesignAssetKind,
  DesignProfile,
  DesignProfilesFile,
  DesignTokenGroup,
} from './types'

const ASSET_MIME: Record<string, string> = {
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
}

export interface SaveDesignProfileInput {
  id?: string
  name: string
  isDefault?: boolean
  tokens?: DesignTokenGroup
  modes?: { light?: DesignTokenGroup; dark?: DesignTokenGroup }
  direction?: string
  assets?: DesignAsset[]
}

export class DesignProfileStore {
  private readonly filePath: string
  private readonly assetsRoot: string

  constructor(root = resolveShelfDataRoot()) {
    fs.mkdirSync(root, { recursive: true })
    this.filePath = path.join(root, 'design-profiles.json')
    this.assetsRoot = path.join(root, 'brand-assets')
    fs.mkdirSync(this.assetsRoot, { recursive: true })
    withFileLockSync(this.filePath, () => {
      if (!fs.existsSync(this.filePath)) {
        this.write({ version: 1, profiles: [] })
        return
      }
      try {
        const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as Partial<DesignProfilesFile>
        if (!Array.isArray(parsed.profiles)) throw new Error('missing profiles array')
        // Normalization must be STABLE across reads: a hand-edited record
        // with a junk id gets a synthesized one, and re-synthesizing per
        // read would make list() ids dangle. Persist the normalized form
        // once when it differs.
        const normalized = parsed.profiles.map(normalizeProfile)
        if (JSON.stringify(normalized) !== JSON.stringify(parsed.profiles)) {
          this.write({ version: 1, profiles: normalized })
        }
      } catch {
        const stamp = new Date().toISOString().replace(/[:.]/g, '-')
        fs.copyFileSync(this.filePath, path.join(root, `design-profiles.corrupt-backup-${stamp}.json`))
        this.write({ version: 1, profiles: [] })
      }
    })
  }

  /** All profiles: default first, then by name. */
  list(): DesignProfile[] {
    return this.read().profiles.slice().sort((a, b) => {
      if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1
      return a.name.localeCompare(b.name)
    })
  }

  get(id: string): DesignProfile | undefined {
    return this.read().profiles.find((profile) => profile.id === id)
  }

  /** Case-insensitive name lookup — lets the seed script upsert idempotently. */
  findByName(name: string): DesignProfile | undefined {
    const needle = name.trim().toLowerCase()
    return this.read().profiles.find((profile) => profile.name.toLowerCase() === needle)
  }

  getDefault(): DesignProfile | undefined {
    return this.read().profiles.find((profile) => profile.isDefault)
  }

  /**
   * Upsert by id. The first profile ever saved becomes the default; setting
   * isDefault on a later profile clears the flag everywhere else.
   */
  save(input: SaveDesignProfileInput): DesignProfile {
    const name = input.name.trim()
    if (!name) throw new Error('Profile name is required.')

    return withFileLockSync(this.filePath, () => {
      const data = this.read()
      const now = new Date().toISOString()
      const index = input.id ? data.profiles.findIndex((p) => p.id === input.id) : -1
      const existing = index >= 0 ? data.profiles[index] : undefined
      if (input.id && !existing) throw new Error(`Design profile not found: ${input.id}`)

      const makeDefault =
        input.isDefault ?? existing?.isDefault ?? data.profiles.length === 0

      const profile: DesignProfile = {
        id: existing?.id || randomUUID(),
        name,
        isDefault: makeDefault,
        tokens: input.tokens ?? existing?.tokens ?? {},
        modes: {
          light: input.modes?.light ?? existing?.modes.light ?? {},
          dark: input.modes?.dark ?? existing?.modes.dark ?? {},
        },
        direction: input.direction ?? existing?.direction ?? '',
        assets: input.assets ?? existing?.assets ?? [],
        createdAt: existing?.createdAt || now,
        updatedAt: now,
      }

      if (makeDefault) {
        for (const other of data.profiles) {
          if (other.id !== profile.id) other.isDefault = false
        }
      }
      if (existing) data.profiles[index] = profile
      else data.profiles.push(profile)
      this.write(data)
      return profile
    })
  }

  setDefault(id: string): DesignProfile {
    return withFileLockSync(this.filePath, () => {
      const data = this.read()
      const profile = data.profiles.find((p) => p.id === id)
      if (!profile) throw new Error(`Design profile not found: ${id}`)
      for (const other of data.profiles) other.isDefault = other.id === id
      profile.updatedAt = new Date().toISOString()
      this.write(data)
      return profile
    })
  }

  /** Removes the profile and its brand-assets dir. Never touches library.json. */
  delete(id: string): void {
    withFileLockSync(this.filePath, () => {
      const data = this.read()
      const before = data.profiles.length
      data.profiles = data.profiles.filter((profile) => profile.id !== id)
      if (data.profiles.length === before) throw new Error(`Design profile not found: ${id}`)
      this.write(data)
    })
    fs.rmSync(path.join(this.assetsRoot, id), { recursive: true, force: true })
  }

  /**
   * Copy a file into <root>/brand-assets/<profileId>/ (the icons/ precedent)
   * and record it on the profile. Re-importing the same basename overwrites
   * in place, so seeding is idempotent. The copy lands via tmp+rename so a
   * concurrent reader of assets[].path never sees torn bytes.
   */
  importAsset(profileId: string, sourcePath: string, kind: DesignAssetKind): DesignAsset {
    if (!fs.existsSync(sourcePath)) throw new Error(`Asset file not found: ${sourcePath}`)
    const dir = path.join(this.assetsRoot, profileId)
    fs.mkdirSync(dir, { recursive: true })
    const basename = path.basename(sourcePath)
    const destPath = path.join(dir, basename)
    const tmpPath = `${destPath}.tmp-${process.pid}`
    try {
      fs.copyFileSync(sourcePath, tmpPath)
      fs.renameSync(tmpPath, destPath)
    } finally {
      fs.rmSync(tmpPath, { force: true })
    }
    const asset: DesignAsset = {
      kind,
      path: destPath,
      mime: ASSET_MIME[path.extname(basename).toLowerCase()] || 'application/octet-stream',
    }

    return withFileLockSync(this.filePath, () => {
      const data = this.read()
      const profile = data.profiles.find((p) => p.id === profileId)
      if (!profile) throw new Error(`Design profile not found: ${profileId}`)
      profile.assets = [
        ...profile.assets.filter((a) => path.basename(a.path) !== basename),
        asset,
      ]
      profile.updatedAt = new Date().toISOString()
      this.write(data)
      return asset
    })
  }

  /**
   * Remove one asset from a profile. The file is unlinked only when it lives
   * inside this profile's brand-assets dir — a hand-edited record pointing
   * elsewhere must never delete files outside the store.
   */
  removeAsset(profileId: string, assetPath: string): void {
    const removed = withFileLockSync(this.filePath, () => {
      const data = this.read()
      const profile = data.profiles.find((p) => p.id === profileId)
      if (!profile) throw new Error(`Design profile not found: ${profileId}`)
      const before = profile.assets.length
      profile.assets = profile.assets.filter((asset) => asset.path !== assetPath)
      if (profile.assets.length === before) return false // no-op: don't churn updatedAt
      profile.updatedAt = new Date().toISOString()
      this.write(data)
      return true
    })
    if (!removed) return
    const resolved = path.resolve(assetPath)
    const ownDir = path.resolve(this.getAssetsDir(profileId)) + path.sep
    if (resolved.startsWith(ownDir)) fs.rmSync(resolved, { force: true })
  }

  getAssetsDir(profileId: string): string {
    return path.join(this.assetsRoot, profileId)
  }

  getRoot(): string {
    return path.dirname(this.filePath)
  }

  private read(): DesignProfilesFile {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as DesignProfilesFile
      if (!Array.isArray(parsed.profiles)) throw new Error('missing profiles array')
      return { version: 1, profiles: parsed.profiles.map(normalizeProfile) }
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      throw new Error(`Shelf could not read design-profiles.json: ${detail}`)
    }
  }

  private write(data: DesignProfilesFile): void {
    atomicWriteFileSync(this.filePath, JSON.stringify(data, null, 2))
  }
}

function isTokenGroup(value: unknown): value is DesignTokenGroup {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Harden hand-edited profiles: design-profiles.json is brand data users may
 * tune by hand, and a missing field must degrade to empty — not crash gap
 * briefs or the MCP surface at render time (normalizeCollection precedent).
 */
function normalizeProfile(input: Partial<DesignProfile>): DesignProfile {
  const now = new Date().toISOString()
  const str = (value: unknown, fallback: string): string =>
    typeof value === 'string' && value.trim() ? value.trim() : fallback
  return {
    id: str(input.id, randomUUID()),
    name: str(input.name, 'Untitled'),
    isDefault: input.isDefault === true,
    tokens: isTokenGroup(input.tokens) ? input.tokens : {},
    modes: {
      light: isTokenGroup(input.modes?.light) ? input.modes.light : {},
      dark: isTokenGroup(input.modes?.dark) ? input.modes.dark : {},
    },
    direction: typeof input.direction === 'string' ? input.direction : '',
    assets: Array.isArray(input.assets)
      ? input.assets.filter((asset) => Boolean(asset) && typeof asset.path === 'string')
      : [],
    createdAt: str(input.createdAt, now),
    updatedAt: str(input.updatedAt, now),
  }
}
