/**
 * Companion Phase B: port-for-port preview proxy.
 *
 * For a running tool the user marked "Allow remote preview", Shelf listens on
 * `<companion bind address>:<tool.port>` and forwards to
 * `127.0.0.1:<tool.port>`, WebSocket upgrades included, so a dev server with
 * absolute asset URLs and an HMR socket works unchanged. The proxy terminates
 * TLS with the Companion certificate; the tool keeps serving plain HTTP on
 * loopback as before.
 *
 * Access: a paired phone asks the Companion API for a ticket, opens
 * `/__shelf_grant?t=<ticket>` on the proxy port, and receives a cookie scoped
 * to that port. Tickets are single use and short lived; grants last eight
 * hours and die with the listener (tool stopped, toggle off, Companion off)
 * or with the device (revoked). A request without a valid grant gets 401 and
 * never a byte of the tool.
 *
 * Pure Node: the smoke suite runs it against a throwaway backend.
 */
import { randomBytes, timingSafeEqual } from 'node:crypto'
import http from 'node:http'
import https from 'node:https'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'
import type { CompanionPreviewGrant } from './companion-contracts'
import { isLoopbackAddress, isUnspecifiedAddress } from './companion-net'

export interface PreviewTarget {
  toolId: string
  /** The tool's port: the proxy listens on it (companion interface) and forwards to it (loopback). */
  port: number
  backend: 'http' | 'https'
}

export interface PreviewProxyOptions {
  bindAddress: string
  tls: { key: string; cert: string }
  ticketTtlMs?: number
  grantTtlMs?: number
  log?: (message: string) => void
}

export const PREVIEW_COOKIE = 'shelf_preview'
export const PREVIEW_GRANT_PATH = '/__shelf_grant'
const DEFAULT_TICKET_TTL_MS = 60_000
const DEFAULT_GRANT_TTL_MS = 8 * 60 * 60 * 1000

interface Credential {
  deviceId: string
  expiresAt: number
}

interface Listener {
  target: PreviewTarget
  server: https.Server
  origin: string
  tickets: Map<string, Credential>
  grants: Map<string, Credential>
  sockets: Set<Duplex>
}

const REFUSED_HTML = [
  '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width">',
  '<title>Shelf</title><body style="font:16px/1.5 -apple-system,sans-serif;padding:2rem;color:#111">',
  '<h1>Open this preview from the Shelf Companion</h1>',
  '<p>This address belongs to a tool on your Mac. Tap <b>Open preview</b> on its page in the Companion to get in.</p>',
].join('')

export function previewOrigin(bindAddress: string, port: number): string {
  return `https://${bindAddress}:${port}`
}

export { previewBlocker, toolUrlHost } from './companion-preview-policy'

function parseCookies(header: string | undefined): Map<string, string> {
  const cookies = new Map<string, string>()
  for (const part of (header || '').split(';')) {
    const index = part.indexOf('=')
    if (index < 1) continue
    cookies.set(part.slice(0, index).trim(), part.slice(index + 1).trim())
  }
  return cookies
}

/** The forwarded Cookie header without Shelf's own grant; the tool never sees it. */
function stripOwnCookie(header: string | undefined): string | undefined {
  if (!header) return undefined
  const kept = header.split(';').map((part) => part.trim()).filter((part) => part && !part.startsWith(`${PREVIEW_COOKIE}=`))
  return kept.length ? kept.join('; ') : undefined
}

function sameToken(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  return timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'))
}

function lookup(map: Map<string, Credential>, offered: string): [string, Credential] | null {
  const now = Date.now()
  for (const [key, credential] of map) {
    if (credential.expiresAt <= now) {
      map.delete(key)
      continue
    }
    if (sameToken(key, offered)) return [key, credential]
  }
  return null
}

export class PreviewProxy {
  private readonly listeners = new Map<string, Listener>()
  private readonly ticketTtl: number
  private readonly grantTtl: number

  constructor(private readonly options: PreviewProxyOptions) {
    if (isLoopbackAddress(options.bindAddress) || isUnspecifiedAddress(options.bindAddress)) {
      throw new Error('Preview proxy refuses loopback and all-interface addresses.')
    }
    this.ticketTtl = options.ticketTtlMs ?? DEFAULT_TICKET_TTL_MS
    this.grantTtl = options.grantTtlMs ?? DEFAULT_GRANT_TTL_MS
  }

  get bindAddress(): string {
    return this.options.bindAddress
  }

  listening(toolId: string): boolean {
    return this.listeners.has(toolId)
  }

  activeToolIds(): string[] {
    return [...this.listeners.keys()]
  }

  origin(toolId: string): string | null {
    return this.listeners.get(toolId)?.origin || null
  }

  /** Make sure a listener exists for the target. Idempotent; a changed port replaces it. */
  async ensure(target: PreviewTarget): Promise<string> {
    const current = this.listeners.get(target.toolId)
    if (current && current.target.port === target.port && current.target.backend === target.backend) return current.origin
    if (current) await this.release(target.toolId)
    const listener: Listener = {
      target,
      server: https.createServer({ key: this.options.tls.key, cert: this.options.tls.cert, minVersion: 'TLSv1.2' }),
      origin: previewOrigin(this.options.bindAddress, target.port),
      tickets: new Map(),
      grants: new Map(),
      sockets: new Set(),
    }
    listener.server.on('request', (req, res) => this.handle(listener, req, res))
    listener.server.on('upgrade', (req, socket, head) => this.upgrade(listener, req, socket, head))
    listener.server.on('connection', (socket) => {
      listener.sockets.add(socket)
      socket.on('close', () => listener.sockets.delete(socket))
    })
    listener.server.on('tlsClientError', () => { /* plain HTTP on the TLS port: refused */ })
    await new Promise<void>((resolve, reject) => {
      listener.server.once('error', reject)
      listener.server.listen(target.port, this.options.bindAddress, () => {
        listener.server.off('error', reject)
        resolve()
      })
    }).catch((err: NodeJS.ErrnoException) => {
      throw new Error(
        err.code === 'EADDRINUSE'
          ? `Port ${target.port} is already taken on ${this.options.bindAddress}; the tool may already listen on every interface.`
          : err.message,
      )
    })
    listener.server.on('error', (err) => this.options.log?.(`preview proxy ${target.toolId}: ${err.message}`))
    this.listeners.set(target.toolId, listener)
    this.options.log?.(`preview proxy: ${target.toolId} on ${listener.origin} → ${target.backend}://127.0.0.1:${target.port}`)
    return listener.origin
  }

  async release(toolId: string): Promise<void> {
    const listener = this.listeners.get(toolId)
    if (!listener) return
    this.listeners.delete(toolId)
    listener.tickets.clear()
    listener.grants.clear()
    for (const socket of listener.sockets) socket.destroy()
    listener.sockets.clear()
    await new Promise<void>((resolve) => listener.server.close(() => resolve()))
    this.options.log?.(`preview proxy: ${toolId} released`)
  }

  async releaseAll(): Promise<void> {
    await Promise.all(this.activeToolIds().map((toolId) => this.release(toolId)))
  }

  /** A one-time URL the phone opens to receive its grant cookie for the tool's port. */
  issueTicket(toolId: string, deviceId: string): CompanionPreviewGrant {
    const listener = this.listeners.get(toolId)
    if (!listener) throw new Error('Preview is not available for this tool right now.')
    const ticket = randomBytes(24).toString('base64url')
    const expiresAt = Date.now() + this.ticketTtl
    listener.tickets.set(ticket, { deviceId, expiresAt })
    return { url: `${listener.origin}${PREVIEW_GRANT_PATH}?t=${ticket}`, expiresAt: new Date(expiresAt).toISOString() }
  }

  /** A revoked device loses every ticket and grant at once. */
  revokeDevice(deviceId: string): void {
    for (const listener of this.listeners.values()) {
      for (const [key, credential] of listener.tickets) if (credential.deviceId === deviceId) listener.tickets.delete(key)
      for (const [key, credential] of listener.grants) if (credential.deviceId === deviceId) listener.grants.delete(key)
    }
  }

  // ---- requests ---------------------------------------------------------------

  private authorized(listener: Listener, req: IncomingMessage): boolean {
    const offered = parseCookies(req.headers.cookie).get(PREVIEW_COOKIE)
    if (!offered) return false
    return lookup(listener.grants, offered) !== null
  }

  private handle(listener: Listener, req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url || '/', listener.origin)
    if (url.pathname === PREVIEW_GRANT_PATH) {
      const offered = url.searchParams.get('t') || ''
      const found = offered ? lookup(listener.tickets, offered) : null
      if (!found) {
        this.refuse(res)
        return
      }
      listener.tickets.delete(found[0])
      const grant = randomBytes(32).toString('base64url')
      listener.grants.set(grant, { deviceId: found[1].deviceId, expiresAt: Date.now() + this.grantTtl })
      res.writeHead(302, {
        location: '/',
        'cache-control': 'no-store',
        'set-cookie': `${PREVIEW_COOKIE}=${grant}; Path=/; Max-Age=${Math.floor(this.grantTtl / 1000)}; Secure; HttpOnly; SameSite=Lax`,
      })
      res.end()
      return
    }
    if (!this.authorized(listener, req)) {
      this.refuse(res)
      return
    }
    this.forward(listener, req, res)
  }

  private refuse(res: ServerResponse): void {
    res.writeHead(401, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    res.end(REFUSED_HTML)
  }

  private backendHeaders(listener: Listener, req: IncomingMessage): http.OutgoingHttpHeaders {
    const headers: http.OutgoingHttpHeaders = { ...req.headers }
    headers.host = `127.0.0.1:${listener.target.port}`
    headers['x-forwarded-host'] = req.headers.host || listener.origin.replace('https://', '')
    headers['x-forwarded-proto'] = 'https'
    headers['x-forwarded-for'] = req.socket.remoteAddress || ''
    const cookie = stripOwnCookie(req.headers.cookie)
    if (cookie) headers.cookie = cookie
    else delete headers.cookie
    return headers
  }

  /** A redirect back to the tool's loopback address must land on the proxy instead. */
  private rewriteLocation(listener: Listener, value: string | undefined): string | undefined {
    if (!value) return value
    const loopback = new RegExp(`^https?://(127\\.0\\.0\\.1|localhost|\\[::1\\])(:${listener.target.port})?(?=/|$)`, 'i')
    return value.replace(loopback, listener.origin)
  }

  private forward(listener: Listener, req: IncomingMessage, res: ServerResponse): void {
    const client = listener.target.backend === 'https' ? https : http
    const upstream = client.request(
      {
        host: '127.0.0.1',
        port: listener.target.port,
        method: req.method,
        path: req.url,
        headers: this.backendHeaders(listener, req),
        rejectUnauthorized: false,
      },
      (backendRes) => {
        const headers = { ...backendRes.headers }
        if (headers.location) headers.location = this.rewriteLocation(listener, headers.location)
        res.writeHead(backendRes.statusCode || 502, headers)
        backendRes.pipe(res)
      },
    )
    upstream.on('error', (err) => {
      if (res.headersSent) { res.destroy(); return }
      res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
      res.end(`The tool did not answer on 127.0.0.1:${listener.target.port} (${err.message}).`)
    })
    req.pipe(upstream)
  }

  private upgrade(listener: Listener, req: IncomingMessage, socket: Duplex, head: Buffer): void {
    if (!this.authorized(listener, req)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n')
      socket.destroy()
      return
    }
    const client = listener.target.backend === 'https' ? https : http
    const upstream = client.request({
      host: '127.0.0.1',
      port: listener.target.port,
      method: req.method,
      path: req.url,
      headers: this.backendHeaders(listener, req),
      rejectUnauthorized: false,
    })
    upstream.on('upgrade', (backendRes, backendSocket, backendHead) => {
      const lines = [`HTTP/1.1 ${backendRes.statusCode} ${backendRes.statusMessage || 'Switching Protocols'}`]
      for (let i = 0; i < backendRes.rawHeaders.length; i += 2) {
        lines.push(`${backendRes.rawHeaders[i]}: ${backendRes.rawHeaders[i + 1]}`)
      }
      socket.write(lines.join('\r\n') + '\r\n\r\n')
      if (backendHead.length) socket.write(backendHead)
      if (head.length) backendSocket.write(head)
      socket.pipe(backendSocket).pipe(socket)
      socket.on('error', () => backendSocket.destroy())
      backendSocket.on('error', () => socket.destroy())
    })
    upstream.on('response', (backendRes) => {
      // The tool declined the upgrade; pass its answer along and hang up.
      socket.write(`HTTP/1.1 ${backendRes.statusCode} ${backendRes.statusMessage || ''}\r\nConnection: close\r\n\r\n`)
      socket.destroy()
    })
    upstream.on('error', () => socket.destroy())
    upstream.end()
  }
}
