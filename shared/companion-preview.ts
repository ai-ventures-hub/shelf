/**
 * Companion Phase B: port-for-port preview proxy.
 *
 * For a running tool the user marked "Allow remote preview", Shelf listens on
 * a dedicated port of the Companion interface and forwards to
 * `127.0.0.1:<tool.port>`, WebSocket upgrades included, so a dev server with
 * absolute asset URLs and an HMR socket works unchanged. The proxy terminates
 * TLS with the Companion certificate; the tool keeps serving plain HTTP on
 * loopback as before.
 *
 * Access: a paired phone asks the Companion API for a ticket, opens
 * `/__shelf_grant?t=<ticket>` on the proxy port, and receives a cookie scoped
 * to that tool. Tickets are single use and short lived; grants last eight
 * hours and die with the listener (tool stopped, toggle off, Companion off)
 * or with the device (revoked). A request without a valid grant gets 401 and
 * never a byte of the tool.
 *
 * Pure Node: the smoke suite runs it against a throwaway backend.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import http from 'node:http'
import https from 'node:https'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'
import type { CompanionPreviewGrant } from './companion-contracts'
import { isLoopbackAddress, isUnspecifiedAddress } from './companion-net'
import { companionRequestUrl } from './companion-http'
import { PREVIEW_COOKIE, forwardToolCookies, rememberToolCookies, type IssuedCookie } from './companion-cookies'

export interface PreviewTarget {
  toolId: string
  /** The tool's own port on loopback, where the proxy forwards to. */
  port: number
  backend: 'http' | 'https'
}

export interface PreviewProxyOptions {
  bindAddress: string
  tls: { key: string; cert: string }
  /**
   * First port the proxy may listen on; each tool gets the next free one
   * above it. The proxy never listens on the tool's own port number: Shelf's
   * process truth is port-based (lsof), and a proxy holding the tool's port
   * on another interface reads as the tool being up when it is not.
   */
  basePort: number
  /** How many ports above basePort may be tried. */
  portSpan?: number
  ticketTtlMs?: number
  grantTtlMs?: number
  log?: (message: string) => void
}

export { PREVIEW_COOKIE } from './companion-cookies'
export const PREVIEW_GRANT_PATH = '/__shelf_grant'
const DEFAULT_TICKET_TTL_MS = 60_000
const DEFAULT_GRANT_TTL_MS = 8 * 60 * 60 * 1000

interface Credential {
  deviceId: string
  expiresAt: number
}

interface Listener {
  target: PreviewTarget
  /** The port this listener holds on the companion interface (never target.port). */
  listenPort: number
  server: https.Server
  origin: string
  tickets: Map<string, Credential>
  grants: Map<string, Credential>
  sockets: Set<Duplex>
  connections: Map<string, Set<() => void>>
  /** Only cookies issued by this backend to this device may return to it. */
  cookies: Map<string, Map<string, IssuedCookie>>
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

function sameToken(a: string, b: string): boolean {
  if (!/^[A-Za-z0-9_-]+$/.test(b)) return false
  const left = Buffer.from(a, 'utf8')
  const right = Buffer.from(b, 'utf8')
  return left.length === right.length && timingSafeEqual(left, right)
}

/** Cookies are shared across ports, so each tool needs a distinct cookie name. */
export function previewCookieName(toolId: string): string {
  return `${PREVIEW_COOKIE}_${createHash('sha256').update(toolId).digest('hex')}`
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
  private readonly portSpan: number

  constructor(private readonly options: PreviewProxyOptions) {
    if (isLoopbackAddress(options.bindAddress) || isUnspecifiedAddress(options.bindAddress)) {
      throw new Error('Preview proxy refuses loopback and all-interface addresses.')
    }
    if (!Number.isInteger(options.basePort) || options.basePort < 1024 || options.basePort > 65535) {
      throw new Error('Preview proxy needs a base port between 1024 and 65535.')
    }
    this.ticketTtl = options.ticketTtlMs ?? DEFAULT_TICKET_TTL_MS
    this.grantTtl = options.grantTtlMs ?? DEFAULT_GRANT_TTL_MS
    this.portSpan = options.portSpan ?? 200
  }

  listenPort(toolId: string): number | null {
    return this.listeners.get(toolId)?.listenPort ?? null
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

  /** Make sure a listener exists for the target. Idempotent; a changed backend replaces it. */
  async ensure(target: PreviewTarget): Promise<string> {
    const current = this.listeners.get(target.toolId)
    if (current && current.target.port === target.port && current.target.backend === target.backend) return current.origin
    if (current) await this.release(target.toolId)
    const server = https.createServer({ key: this.options.tls.key, cert: this.options.tls.cert, minVersion: 'TLSv1.2' })
    const listenPort = await this.bind(server)
    const listener: Listener = {
      target,
      listenPort,
      server,
      origin: previewOrigin(this.options.bindAddress, listenPort),
      tickets: new Map(),
      grants: new Map(),
      sockets: new Set(),
      connections: new Map(),
      cookies: new Map(),
    }
    server.on('request', (req, res) => this.handle(listener, req, res))
    server.on('upgrade', (req, socket, head) => this.upgrade(listener, req, socket, head))
    server.on('connection', (socket) => {
      listener.sockets.add(socket)
      socket.on('close', () => listener.sockets.delete(socket))
    })
    server.on('tlsClientError', () => { /* plain HTTP on the TLS port: refused */ })
    server.on('error', (err) => this.options.log?.(`preview proxy ${target.toolId}: ${err.message}`))
    this.listeners.set(target.toolId, listener)
    this.options.log?.(`preview proxy: ${target.toolId} on ${listener.origin} → ${target.backend}://127.0.0.1:${target.port}`)
    return listener.origin
  }

  /** First free port at or above basePort that no listener of ours holds. */
  private async bind(server: https.Server): Promise<number> {
    const taken = new Set([...this.listeners.values()].map((item) => item.listenPort))
    const last = Math.min(65535, this.options.basePort + this.portSpan)
    for (let port = this.options.basePort; port <= last; port += 1) {
      if (taken.has(port)) continue
      const outcome = await new Promise<'ok' | 'busy'>((resolve, reject) => {
        const onError = (err: NodeJS.ErrnoException) => {
          server.off('listening', onListening)
          if (err.code === 'EADDRINUSE' || err.code === 'EACCES') resolve('busy')
          else reject(err)
        }
        const onListening = () => {
          server.off('error', onError)
          resolve('ok')
        }
        server.once('error', onError)
        server.once('listening', onListening)
        server.listen(port, this.options.bindAddress)
      })
      if (outcome === 'ok') return port
    }
    throw new Error(`No free preview port between ${this.options.basePort} and ${last} on ${this.options.bindAddress}.`)
  }

  async release(toolId: string): Promise<void> {
    const listener = this.listeners.get(toolId)
    if (!listener) return
    this.listeners.delete(toolId)
    listener.tickets.clear()
    listener.grants.clear()
    listener.cookies.clear()
    for (const connections of listener.connections.values()) for (const close of [...connections]) close()
    for (const socket of listener.sockets) socket.destroy()
    listener.sockets.clear()
    await new Promise<void>((resolve) => listener.server.close(() => resolve()))
    this.options.log?.(`preview proxy: ${toolId} released`)
  }

  async releaseAll(): Promise<void> {
    await Promise.all(this.activeToolIds().map((toolId) => this.release(toolId)))
  }

  /** A one-time URL the phone opens to receive the tool's grant cookie. */
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
      for (const close of [...(listener.connections.get(deviceId) || [])]) close()
      listener.cookies.delete(deviceId)
    }
  }

  // ---- requests ---------------------------------------------------------------

  private authorized(listener: Listener, req: IncomingMessage): Credential | null {
    const offered = parseCookies(req.headers.cookie).get(previewCookieName(listener.target.toolId))
    return offered ? lookup(listener.grants, offered)?.[1] || null : null
  }

  private track(listener: Listener, deviceId: string, close: () => void): () => void {
    const connections = listener.connections.get(deviceId) || new Set<() => void>()
    connections.add(close)
    listener.connections.set(deviceId, connections)
    return () => {
      connections.delete(close)
      if (!connections.size) listener.connections.delete(deviceId)
    }
  }

  private handle(listener: Listener, req: IncomingMessage, res: ServerResponse): void {
    const url = companionRequestUrl(req.url, listener.origin)
    if (!url) {
      res.writeHead(400, { 'cache-control': 'no-store' })
      res.end()
      return
    }
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
        'set-cookie': `${previewCookieName(listener.target.toolId)}=${grant}; Path=/; Max-Age=${Math.floor(this.grantTtl / 1000)}; Secure; HttpOnly; SameSite=Lax`,
      })
      res.end()
      return
    }
    const credential = this.authorized(listener, req)
    if (!credential) {
      this.refuse(res)
      return
    }
    this.forward(listener, req, res, credential.deviceId)
  }

  private refuse(res: ServerResponse): void {
    res.writeHead(401, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    res.end(REFUSED_HTML)
  }

  private rememberCookies(listener: Listener, deviceId: string, req: IncomingMessage, values: string[] | undefined): void {
    if (!values?.length) return
    const issued = listener.cookies.get(deviceId) || new Map<string, IssuedCookie>()
    rememberToolCookies(issued, new URL(req.url!, listener.origin), values)
    listener.cookies.set(deviceId, issued)
  }

  private backendHeaders(listener: Listener, req: IncomingMessage, deviceId: string): http.OutgoingHttpHeaders {
    const headers: http.OutgoingHttpHeaders = { ...req.headers }
    headers.host = `127.0.0.1:${listener.target.port}`
    headers['x-forwarded-host'] = req.headers.host || listener.origin.replace('https://', '')
    headers['x-forwarded-proto'] = 'https'
    headers['x-forwarded-for'] = req.socket.remoteAddress || ''
    const cookie = forwardToolCookies(req.headers.cookie, listener.cookies.get(deviceId), new URL(req.url!, listener.origin))
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

  private forward(listener: Listener, req: IncomingMessage, res: ServerResponse, deviceId: string): void {
    const client = listener.target.backend === 'https' ? https : http
    let response: IncomingMessage | undefined
    const upstream = client.request(
      {
        host: '127.0.0.1',
        port: listener.target.port,
        method: req.method,
        path: req.url,
        headers: this.backendHeaders(listener, req, deviceId),
        rejectUnauthorized: false,
      },
      (backendRes) => {
        response = backendRes
        if (res.destroyed) { backendRes.destroy(); return }
        this.rememberCookies(listener, deviceId, req, backendRes.headers['set-cookie'])
        const headers = { ...backendRes.headers }
        if (headers.location) headers.location = this.rewriteLocation(listener, headers.location)
        res.writeHead(backendRes.statusCode || 502, headers)
        backendRes.pipe(res)
      },
    )
    const close = () => { upstream.destroy(); response?.destroy(); res.destroy() }
    const untrack = this.track(listener, deviceId, close)
    res.once('close', () => { untrack(); close() })
    upstream.on('error', (err) => {
      if (res.headersSent) { res.destroy(); return }
      res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
      res.end(`The tool did not answer on 127.0.0.1:${listener.target.port} (${err.message}).`)
    })
    req.pipe(upstream)
  }

  private upgrade(listener: Listener, req: IncomingMessage, socket: Duplex, head: Buffer): void {
    const url = companionRequestUrl(req.url, listener.origin)
    const credential = url ? this.authorized(listener, req) : null
    if (!credential) {
      socket.write(`HTTP/1.1 ${url ? '401 Unauthorized' : '400 Bad Request'}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`)
      socket.destroy()
      return
    }
    const client = listener.target.backend === 'https' ? https : http
    const upstream = client.request({
      host: '127.0.0.1',
      port: listener.target.port,
      method: req.method,
      path: req.url,
      headers: this.backendHeaders(listener, req, credential.deviceId),
      rejectUnauthorized: false,
    })
    let backend: Duplex | undefined
    const close = () => { upstream.destroy(); backend?.destroy(); socket.destroy() }
    const untrack = this.track(listener, credential.deviceId, close)
    socket.once('close', () => { untrack(); close() })
    upstream.on('upgrade', (backendRes, backendSocket, backendHead) => {
      backend = backendSocket
      if (socket.destroyed) { backendSocket.destroy(); return }
      this.rememberCookies(listener, credential.deviceId, req, backendRes.headers['set-cookie'])
      backendSocket.once('close', () => socket.destroy())
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
