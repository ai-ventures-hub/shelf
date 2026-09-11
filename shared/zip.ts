/**
 * Minimal, dependency-free ZIP writer/reader for tool bundles.
 *
 * Written in-house so extraction is under our control: every entry name is
 * validated against the destination (no absolute paths, no `..` segments,
 * no backslashes), symlink entries are skipped, and sizes are capped. A
 * bundle is untrusted input exactly like a manifest — unzip must never be
 * the thing that writes outside the folder the user approved.
 *
 * Supports store (0) and deflate (8); rejects zip64 and encrypted entries.
 */
import fs from 'node:fs'
import os from 'node:os'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import zlib from 'node:zlib'

const SIG_LOCAL = 0x04034b50
const SIG_CENTRAL = 0x02014b50
const SIG_EOCD = 0x06054b50
const S_IFLNK = 0xa000
const S_IFMT = 0xf000

export interface ZipEntryInput {
  /** Forward-slash relative path inside the archive. */
  name: string
  data: Buffer
  /** Unix mode bits (default 0o644). */
  mode?: number
  mtime?: Date
}

export interface ZipWriteOptions {
  /** Total uncompressed bytes allowed (default 512 MB). */
  maxBytes?: number
}

export interface ZipExtractOptions {
  /** Max entries (default 50 000). */
  maxEntries?: number
  /** Max total uncompressed bytes (default 1 GB). */
  maxBytes?: number
}

export interface ZipExtractResult {
  files: number
  directories: number
  /** Entries refused (unsafe path, symlink, unsupported) — never written. */
  skipped: string[]
}

function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.max(1980, date.getFullYear())
  const time =
    (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2)
  const d = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  return { time, date: d }
}

/** Build a ZIP archive in memory. Names must already be safe relative paths. */
export function buildZip(entries: ZipEntryInput[], opts: ZipWriteOptions = {}): Buffer {
  const maxBytes = opts.maxBytes ?? 512 * 1024 * 1024
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  let total = 0

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8')
    if (name.length > 0xffff) throw new Error(`Path too long in bundle: ${entry.name}`)
    total += entry.data.length
    if (total > maxBytes) {
      throw new Error(`Bundle exceeds ${Math.round(maxBytes / (1024 * 1024))} MB.`)
    }
    const isDir = entry.name.endsWith('/')
    const method = isDir || entry.data.length === 0 ? 0 : 8
    const compressed = method === 8 ? zlib.deflateRawSync(entry.data, { level: 6 }) : entry.data
    const crc = zlib.crc32(entry.data)
    const { time, date } = dosDateTime(entry.mtime || new Date())
    const mode = (entry.mode ?? (isDir ? 0o755 : 0o644)) & 0o7777
    const externalAttrs = ((isDir ? 0o040000 : 0o100000) | mode) << 16

    const local = Buffer.alloc(30)
    local.writeUInt32LE(SIG_LOCAL, 0)
    local.writeUInt16LE(20, 4) // version needed
    local.writeUInt16LE(0x0800, 6) // utf-8 names
    local.writeUInt16LE(method, 8)
    local.writeUInt16LE(time, 10)
    local.writeUInt16LE(date, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(compressed.length, 18)
    local.writeUInt32LE(entry.data.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)
    locals.push(local, name, compressed)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(SIG_CENTRAL, 0)
    central.writeUInt16LE((3 << 8) | 20, 4) // made by: unix, 2.0
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(method, 10)
    central.writeUInt16LE(time, 12)
    central.writeUInt16LE(date, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(compressed.length, 20)
    central.writeUInt32LE(entry.data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt16LE(0, 30) // extra
    central.writeUInt16LE(0, 32) // comment
    central.writeUInt16LE(0, 34) // disk
    central.writeUInt16LE(0, 36) // internal attrs
    central.writeUInt32LE(externalAttrs >>> 0, 38)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, name)

    offset += local.length + name.length + compressed.length
    if (offset > 0xffffffff) throw new Error('Bundle too large for a ZIP archive.')
  }

  const centralStart = offset
  const centralSize = centrals.reduce((n, b) => n + b.length, 0)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(SIG_EOCD, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(centralSize, 12)
  eocd.writeUInt32LE(centralStart, 16)
  eocd.writeUInt16LE(0, 20)
  if (entries.length > 0xffff) throw new Error('Too many files for a ZIP archive.')
  return Buffer.concat([...locals, ...centrals, eocd])
}

/**
 * Is this entry name safe to write under a destination? Rejects absolute
 * paths, drive letters, backslashes, `.`/`..` segments, and empty names.
 */
export function isSafeZipPath(name: string): boolean {
  if (!name || name.length > 1024) return false
  if (name.includes('\\') || name.includes('\0')) return false
  if (name.startsWith('/') || /^[A-Za-z]:/.test(name)) return false
  const segments = name.split('/').filter((s) => s.length > 0)
  if (segments.length === 0) return false
  // A planted `.git/` (config with core.fsmonitor, hooks) would execute the
  // moment the receiver runs git in the folder — which a dev tool invites.
  // Refuse it at ANY depth (a wrapper folder puts it second) and case-fold:
  // on APFS `.GIT/config` is the same file git reads. Export never includes
  // .git; receive refuses it too.
  if (segments.some((seg) => seg.toLowerCase() === '.git')) return false
  return segments.every((s) => s !== '.' && s !== '..')
}

interface CentralEntry {
  name: string
  method: number
  crc: number
  compressedSize: number
  size: number
  localOffset: number
  externalAttrs: number
  flags: number
}

function readCentralDirectory(buf: Buffer): CentralEntry[] {
  // EOCD is at the end; search backwards past an optional comment (≤64 KB).
  const minPos = Math.max(0, buf.length - 22 - 0xffff)
  let eocdPos = -1
  for (let i = buf.length - 22; i >= minPos; i--) {
    if (buf.readUInt32LE(i) === SIG_EOCD) {
      eocdPos = i
      break
    }
  }
  if (eocdPos < 0) throw new Error('Not a ZIP archive (no end-of-central-directory record).')
  const count = buf.readUInt16LE(eocdPos + 10)
  const centralSize = buf.readUInt32LE(eocdPos + 12)
  const centralStart = buf.readUInt32LE(eocdPos + 16)
  if (count === 0xffff || centralSize === 0xffffffff || centralStart === 0xffffffff) {
    throw new Error('ZIP64 archives are not supported.')
  }
  if (centralStart + centralSize > buf.length) throw new Error('Corrupt ZIP central directory.')

  const entries: CentralEntry[] = []
  let pos = centralStart
  for (let i = 0; i < count; i++) {
    if (pos + 46 > buf.length || buf.readUInt32LE(pos) !== SIG_CENTRAL) {
      throw new Error('Corrupt ZIP central directory entry.')
    }
    const flags = buf.readUInt16LE(pos + 8)
    const method = buf.readUInt16LE(pos + 10)
    const crc = buf.readUInt32LE(pos + 16)
    const compressedSize = buf.readUInt32LE(pos + 20)
    const size = buf.readUInt32LE(pos + 24)
    const nameLen = buf.readUInt16LE(pos + 28)
    const extraLen = buf.readUInt16LE(pos + 30)
    const commentLen = buf.readUInt16LE(pos + 32)
    const externalAttrs = buf.readUInt32LE(pos + 38)
    const localOffset = buf.readUInt32LE(pos + 42)
    const name = buf.subarray(pos + 46, pos + 46 + nameLen).toString('utf8')
    entries.push({ name, method, crc, compressedSize, size, localOffset, externalAttrs, flags })
    pos += 46 + nameLen + extraLen + commentLen
  }
  return entries
}

function readEntryData(buf: Buffer, entry: CentralEntry): Buffer {
  const p = entry.localOffset
  if (p + 30 > buf.length || buf.readUInt32LE(p) !== SIG_LOCAL) {
    throw new Error(`Corrupt local header for ${entry.name}.`)
  }
  const nameLen = buf.readUInt16LE(p + 26)
  const extraLen = buf.readUInt16LE(p + 28)
  const start = p + 30 + nameLen + extraLen
  const end = start + entry.compressedSize
  if (end > buf.length) throw new Error(`Truncated data for ${entry.name}.`)
  const raw = buf.subarray(start, end)
  let data: Buffer
  if (entry.method === 0) data = Buffer.from(raw)
  else if (entry.method === 8) {
    data = zlib.inflateRawSync(raw, { maxOutputLength: Math.max(entry.size, 1) })
  } else throw new Error(`Unsupported compression (${entry.method}) for ${entry.name}.`)
  if (data.length !== entry.size) throw new Error(`Size mismatch for ${entry.name}.`)
  if (zlib.crc32(data) !== entry.crc) throw new Error(`CRC mismatch for ${entry.name}.`)
  return data
}

/** List entry names without extracting (for previews / validation). */
export function listZip(file: string): string[] {
  return readCentralDirectory(fs.readFileSync(file)).map((e) => e.name)
}

/**
 * Extract an archive into `dest` (created if missing). Unsafe entries are
 * skipped, never written. Throws on corrupt/unsupported archives or when a
 * cap is exceeded (nothing partial is cleaned up — callers stage into a
 * temp dir and discard on failure).
 */
export function extractZip(
  file: string,
  dest: string,
  opts: ZipExtractOptions = {},
): ZipExtractResult {
  const maxEntries = opts.maxEntries ?? 50_000
  const maxBytes = opts.maxBytes ?? 1024 * 1024 * 1024
  const buf = fs.readFileSync(file)
  const entries = readCentralDirectory(buf)
  if (entries.length > maxEntries) {
    throw new Error(`Archive has too many entries (${entries.length} > ${maxEntries}).`)
  }
  const destRoot = path.resolve(dest)
  fs.mkdirSync(destRoot, { recursive: true })
  const destReal = fs.realpathSync(destRoot)

  const result: ZipExtractResult = { files: 0, directories: 0, skipped: [] }
  let total = 0
  for (const entry of entries) {
    if (!isSafeZipPath(entry.name)) {
      result.skipped.push(entry.name)
      continue
    }
    if (entry.flags & 0x0001) {
      result.skipped.push(entry.name) // encrypted
      continue
    }
    const unixMode = entry.externalAttrs >>> 16
    if ((unixMode & S_IFMT) === S_IFLNK) {
      result.skipped.push(entry.name) // symlinks never extracted
      continue
    }
    const target = path.resolve(destReal, entry.name)
    if (target !== destReal && !target.startsWith(destReal + path.sep)) {
      result.skipped.push(entry.name)
      continue
    }
    if (entry.name.endsWith('/')) {
      fs.mkdirSync(target, { recursive: true })
      result.directories += 1
      continue
    }
    total += entry.size
    if (total > maxBytes) {
      throw new Error(`Archive exceeds ${Math.round(maxBytes / (1024 * 1024))} MB uncompressed.`)
    }
    const parent = path.dirname(target)
    fs.mkdirSync(parent, { recursive: true })
    // We never write symlinks, but a pre-existing symlinked directory in a
    // non-empty dest could still redirect a write: resolve the parent and
    // require it to live under the destination.
    const parentReal = fs.realpathSync(parent)
    if (parentReal !== destReal && !parentReal.startsWith(destReal + path.sep)) {
      result.skipped.push(entry.name)
      continue
    }
    const data = readEntryData(buf, entry)
    fs.writeFileSync(target, data, { mode: (unixMode & 0o777) || 0o644 })
    result.files += 1
  }
  return result
}

const DEFAULT_EXCLUDES = new Set([
  'node_modules',
  'dist', 'build', '.next', 'coverage', 'backups', 'uploads', 'logs',
  '.git',
  '.venv',
  'venv',
  '__pycache__',
  '.DS_Store',
  // Credential files beyond .env*: never ride along in a bundle.
  '.npmrc',
  '.yarnrc',
  '.yarnrc.yml',
  '.pypirc',
  '.netrc',
  '.git-credentials',
  '.aws',
  'credentials.json',
  'service-account.json',
])
/** Key material by extension — also excluded from bundles. */
const SECRET_EXTENSIONS = /\.(pem|key|p12|pfx|jks|keystore|sqlite|sqlite3|db|db3|bak|dump|sql)$/i

export interface BundleFolderOptions {
  /** Additional directory/file basenames to skip. */
  exclude?: string[]
  /** Max uncompressed bytes (default 256 MB). */
  maxBytes?: number
  /** Exact file membership callback used by the export review. */
  onFiles?: (files: { name: string; bytes: number }[]) => void
}

/** Use Git's ignore parser for Git and non-Git projects, including nested ignore files. */
function bundleCandidates(root: string): Set<string> {
  const git = process.platform === 'darwin' ? '/usr/bin/git' : 'git'
  const options = { cwd: root, encoding: 'utf8' as const, timeout: 10_000, maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] as ['ignore', 'pipe', 'pipe'] }
  let top: string | undefined
  try { top = execFileSync(git, ['rev-parse', '--show-toplevel'], options).trim() } catch { /* non-Git project */ }
  let scratch: string | undefined
  try {
    let args: string[]
    if (top && path.resolve(top) === root) {
      // Tracked source only. shelf.json is generated by Shelf and reviewed too.
      args = ['ls-files', '--cached', '-z', '--']
    } else {
      scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'shelf-bundle-ignore-'))
      execFileSync(git, ['init', '--bare', '--template=', scratch], options)
      args = [`--git-dir=${scratch}`, `--work-tree=${root}`, 'ls-files', '--others', '--exclude-standard', '-z', '--']
    }
    const candidates = new Set(execFileSync(git, args, options).split('\0').filter(Boolean))
    candidates.add('shelf.json')
    // Custom exclusions also apply to tracked files. check-ignore needs no shell.
    if (fs.existsSync(path.join(root, '.shelfignore'))) {
      const ignoreRoot = scratch || fs.mkdtempSync(path.join(os.tmpdir(), 'shelf-bundle-ignore-'))
      try {
        if (!scratch) execFileSync(git, ['init', '--bare', '--template=', ignoreRoot], options)
        const allowed = new Set(execFileSync(git, [`--git-dir=${ignoreRoot}`, `--work-tree=${root}`, 'ls-files', '--others', '--exclude-standard', '--exclude-from=.shelfignore', '-z', '--'], options).split('\0'))
        for (const name of candidates) if (!allowed.has(name) && name !== 'shelf.json') candidates.delete(name)
      } finally { if (!scratch) fs.rmSync(ignoreRoot, { recursive: true, force: true }) }
    }
    return candidates
  } catch {
    throw new Error('Shelf could not safely determine which files to share. Check that Git is installed and the project ignore files are valid.')
  } finally { if (scratch) fs.rmSync(scratch, { recursive: true, force: true }) }
}

/**
 * Zip a project folder. Excludes dependency/VCS dirs and every `.env*` file
 * except `.env.example` — local secrets must never ride along in a bundle.
 * Symlinks are skipped (never followed).
 */
export function bundleFolder(folder: string, opts: BundleFolderOptions = {}): Buffer {
  const root = fs.realpathSync(path.resolve(folder))
  const candidates = bundleCandidates(root)
  const excludes = new Set([...DEFAULT_EXCLUDES, ...(opts.exclude || [])])
  const entries: ZipEntryInput[] = []
  const maxBytes = opts.maxBytes ?? 256 * 1024 * 1024
  let total = 0

  const walk = (dir: string, rel: string) => {
    const names = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )
    for (const dirent of names) {
      if (excludes.has(dirent.name) || dirent.name.startsWith('.shelf-import-')) continue
      if (isSecretEnvFile(dirent.name) || SECRET_EXTENSIONS.test(dirent.name)) continue
      if (dirent.isSymbolicLink()) continue
      const abs = path.join(dir, dirent.name)
      const relName = rel ? `${rel}/${dirent.name}` : dirent.name
      if (dirent.isDirectory()) {
        if ([...candidates].some((name) => name.startsWith(`${relName}/`))) walk(abs, relName)
      } else if (dirent.isFile()) {
        if (!candidates.has(relName)) continue
        const stat = fs.statSync(abs)
        total += stat.size
        if (total > maxBytes) {
          throw new Error(
            `This project is larger than ${Math.round(maxBytes / (1024 * 1024))} MB without node_modules — share it over git instead.`,
          )
        }
        entries.push({
          name: relName,
          data: fs.readFileSync(abs),
          mode: stat.mode & 0o777,
          mtime: stat.mtime,
        })
      }
    }
  }
  walk(root, '')
  opts.onFiles?.(entries.map((entry) => ({ name: entry.name, bytes: entry.data.length })))
  return buildZip(entries, { maxBytes })
}

/** `.env`, `.env.local`, `.env.production` … but not `.env.example`/`.env.sample`. */
export function isSecretEnvFile(name: string): boolean {
  if (!name.startsWith('.env')) return false
  if (name === '.env.example' || name === '.env.sample' || name === '.env.template') return false
  return name === '.env' || name.startsWith('.env.')
}
