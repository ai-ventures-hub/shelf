import fs from 'node:fs'
import path from 'node:path'

export const ICON_MIME_TYPES: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
}

export const BRAND_ASSET_MIME_TYPES: Readonly<Record<string, string>> = {
  ...ICON_MIME_TYPES,
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
}

/** Previews are for icons, logos, and fonts; anything larger is not read. */
const MAX_PREVIEW_BYTES = 10 * 1024 * 1024
const CACHE_LIMIT = 200
const cache = new Map<string, string>()

/**
 * A data URL for a file that really lives inside `root`, or null.
 * realpath on BOTH sides: a symlink planted inside the root must not read
 * files outside it, and a symlinked data root must still match. Types
 * outside `mimeTypes` are never read. Results are cached by path, size, and
 * mtime, so re-rendering a grid of icons does not re-read every file.
 */
export function containedDataUrl(
  root: string,
  target: unknown,
  mimeTypes: Readonly<Record<string, string>>,
): string | null {
  if (typeof target !== 'string' || !target) return null
  let resolved: string
  let rootReal: string
  try {
    rootReal = fs.realpathSync(root) + path.sep
    resolved = fs.realpathSync(target)
  } catch {
    return null
  }
  if (!resolved.startsWith(rootReal)) return null
  const mime = mimeTypes[path.extname(resolved).toLowerCase()]
  if (!mime) return null
  const stat = fs.statSync(resolved)
  if (!stat.isFile() || stat.size > MAX_PREVIEW_BYTES) return null
  const key = `${resolved}\u0000${stat.size}\u0000${stat.mtimeMs}`
  const hit = cache.get(key)
  if (hit) return hit
  const url = `data:${mime};base64,${fs.readFileSync(resolved).toString('base64')}`
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value as string)
  cache.set(key, url)
  return url
}
