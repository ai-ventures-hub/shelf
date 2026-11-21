/** Cookie provenance for preview origins that share a host across ports. */
export const PREVIEW_COOKIE = 'shelf_preview'
const MAX_COOKIES = 64

export interface IssuedCookie {
  name: string
  value: string
  domain: string
  path: string
  expiresAt: number
}

function ownCookie(name: string): boolean {
  return name === PREVIEW_COOKIE || name.startsWith(`${PREVIEW_COOKIE}_`)
}

/**
 * Loopback hostnames a local tool may emit in a Set-Cookie `Domain=` attribute.
 * Because the preview proxy is accessed via the Companion's LAN/Tailscale IP,
 * keeping a loopback Domain would make Safari drop the cookie entirely.
 */
function isLoopbackCookieDomain(domain: string): boolean {
  const clean = domain.trim().toLowerCase().replace(/^\./, '')
  return clean === 'localhost' || clean === '127.0.0.1' || clean === '[::1]' || clean === '::1'
}

/**
 * Filter backend Set-Cookie headers before sending them to the browser or
 * recording them for forwarding:
 * - Drops any cookie targeting Shelf's own `shelf_preview*` namespace so one
 *   previewed tool cannot overwrite or expire another tool's grant cookie.
 * - Strips loopback `Domain=` attributes (e.g. `Domain=127.0.0.1` / `localhost`)
 *   so the browser binds the cookie to the Companion host instead of rejecting it.
 */
export function sanitizeBackendSetCookies(values: string[] | undefined): string[] | undefined {
  if (!values?.length) return undefined
  const kept: string[] = []
  for (const raw of values) {
    const [pair, ...attrs] = raw.split(';')
    const eq = pair.indexOf('=')
    if (eq < 1) continue
    const name = pair.slice(0, eq).trim()
    if (ownCookie(name)) continue
    const cleanAttrs = attrs.filter((attr) => {
      const idx = attr.indexOf('=')
      if (idx < 0) return true
      const key = attr.slice(0, idx).trim().toLowerCase()
      if (key !== 'domain') return true
      return !isLoopbackCookieDomain(attr.slice(idx + 1))
    })
    kept.push(cleanAttrs.length ? `${pair};${cleanAttrs.join(';')}` : pair)
  }
  return kept.length ? kept : undefined
}

function prune(issued: Map<string, IssuedCookie>, now: number): void {
  for (const [key, cookie] of issued) if (cookie.expiresAt <= now) issued.delete(key)
}

export function rememberToolCookies(issued: Map<string, IssuedCookie>, url: URL, values: string[], now = Date.now()): void {
  prune(issued, now)
  for (const value of values) {
    const [pair, ...parts] = value.split(';')
    const index = pair.indexOf('=')
    if (index < 1) continue
    const name = pair.slice(0, index).trim()
    if (ownCookie(name)) continue
    const attributes = new Map(parts.map((part) => {
      const index = part.indexOf('=')
      return index < 0
        ? [part.trim().toLowerCase(), '']
        : [part.slice(0, index).trim().toLowerCase(), part.slice(index + 1).trim()]
    }))
    const host = url.hostname.toLowerCase()
    const domain = attributes.get('domain')?.toLowerCase().replace(/^\./, '') || host
    // Companion binds to a literal IP. Foreign Domain attributes cannot
    // produce a browser cookie on that IP and must not authorize forwarding.
    if (domain !== host) continue
    const directory = url.pathname.slice(0, url.pathname.lastIndexOf('/')) || '/'
    const scope = attributes.get('path')
    const path = scope?.startsWith('/') ? scope : directory
    let expiresAt = Infinity
    const expires = Date.parse(attributes.get('expires') || '')
    if (Number.isFinite(expires)) expiresAt = expires
    const maxAge = attributes.get('max-age')
    if (maxAge && /^-?\d+$/.test(maxAge) && Number.isFinite(Number(maxAge))) {
      expiresAt = now + Number(maxAge) * 1000
    }
    const key = JSON.stringify([name, domain, path])
    issued.delete(key)
    if (expiresAt > now) issued.set(key, { name, value: pair.slice(index + 1).trim(), domain, path, expiresAt })
    if (issued.size > MAX_COOKIES) issued.delete(issued.keys().next().value!)
  }
}

export function forwardToolCookies(header: string | undefined, issued: Map<string, IssuedCookie> | undefined, url: URL, now = Date.now()): string | undefined {
  if (!header || !issued) return undefined
  prune(issued, now)
  const allowed = new Set([...issued.values()].filter((cookie) => {
    const pathMatches = url.pathname === cookie.path ||
      (url.pathname.startsWith(cookie.path) && (cookie.path.endsWith('/') || url.pathname[cookie.path.length] === '/'))
    return cookie.domain === url.hostname.toLowerCase() && pathMatches
  }).map((cookie) => `${cookie.name}=${cookie.value}`))
  const kept = header.split(';').map((part) => part.trim()).filter((part) => allowed.has(part))
  return kept.length ? kept.join('; ') : undefined
}
