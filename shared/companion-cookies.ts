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
