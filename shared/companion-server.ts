/**
 * The Companion server: HTTPS + WebSocket, bound to one non-loopback
 * interface, speaking the same operations the desktop IPC handlers call.
 *
 * Pure Node so the smoke suite can run it outside Electron. Everything the
 * server does to Shelf goes through `CompanionHost`, which main.ts fills
 * with the real stores and ProcessManager; the server itself adds no
 * business logic and holds no state beyond live sockets and pairing codes.
 *
 * Auth: every /api request but /api/pair carries `Authorization: Bearer
 * <device token>`; the WebSocket names the token as a second subprotocol so
 * it never appears in a URL. Failures get a 401 with one fixed body, and a
 * source that keeps failing is rate limited.
 */
import { randomBytes, timingSafeEqual } from 'node:crypto'
import fs from 'node:fs'
import https from 'node:https'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'
import path from 'node:path'
import { WebSocket, WebSocketServer } from 'ws'
import {
  COMPANION_PAIRING_TTL_MS,
  COMPANION_WS_PROTOCOL,
  type CompanionOverview,
  type CompanionPairResponse,
  type CompanionPreviewGrant,
  type CompanionTool,
  type CompanionToolIcon,
  type CompanionWsMessage,
  type PairedDeviceView,
} from './companion-contracts'
import { CompanionDeviceStore, mintDeviceToken, sanitizeDeviceName } from './companion-store'
import { isLoopbackAddress, isUnspecifiedAddress } from './companion-net'
import type {
  Collection,
  CollectionActionResult,
  LogLine,
  RunReceipt,
  Tool,
  ToolHealth,
  ToolRuntimeState,
} from './contracts'
import type { MorningEvent } from './morning-board'

/** What the server may do to Shelf. main.ts supplies the real thing. */
export interface CompanionHost {
  appVersion: string
  listTools(): Tool[]
  listCollections(): Collection[]
  getStates(): Promise<ToolRuntimeState[]>
  peekStates(): ToolRuntimeState[]
  health(): Promise<ToolHealth[]>
  board(): MorningEvent[]
  start(toolId: string, device: PairedDeviceView): Promise<ToolRuntimeState>
  stop(toolId: string): Promise<ToolRuntimeState>
  restart(toolId: string, device: PairedDeviceView): Promise<ToolRuntimeState>
  logs(toolId: string, runId?: string): LogLine[]
  errorReport(toolId: string, runId?: string): Promise<string | null>
  receipts(toolId: string): RunReceipt[]
  startCollection(collectionId: string, device: PairedDeviceView): Promise<CollectionActionResult>
  stopCollection(collectionId: string): Promise<CollectionActionResult>
  keepAwakeActive(): boolean
  /** The tool's icon as the phone should draw it, or null for the letter fallback. */
  toolIcon(tool: Tool): CompanionToolIcon | null
  /** Phase B: is the preview proxy listening for this tool right now? */
  previewReady(toolId: string): boolean
  /** Phase B: a one-time grant URL for the device, or throw with the reason. */
  previewGrant(toolId: string, device: PairedDeviceView): Promise<CompanionPreviewGrant>
}

export interface CompanionServerOptions {
  host: CompanionHost
  devices: CompanionDeviceStore
  tls: { key: string; cert: string; fingerprint: string }
  /** Built companion web app: `<staticRoot>/companion/index.html` + `<staticRoot>/assets/*`. */
  staticRoot?: string
  /** PNG for the Home Screen icon (apple-touch-icon). */
  iconPngPath?: string
  onClientsChanged?: (count: number) => void
  onDevicesChanged?: () => void
  log?: (message: string) => void
}

export interface PairingState {
  /** The one-time code; kept only in memory and only until used or expired. */
  code: string
  expiresAt: number
}

export interface ListenInfo {
  address: string
  port: number
  url: string
}

const MAX_BODY_BYTES = 64 * 1024
const AUTH_FAILURE_WINDOW_MS = 60_000
const AUTH_FAILURE_LIMIT = 20
/** A device's lastSeen is written at most this often. */
const TOUCH_INTERVAL_MS = 60_000
const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}

export function toCompanionTool(tool: Tool, previewReady = false, icon: CompanionToolIcon | null = null): CompanionTool {
  return {
    remotePreview: Boolean(tool.remotePreview),
    previewReady: Boolean(tool.remotePreview) && previewReady,
    ...(icon ? { icon } : {}),
    id: tool.id,
    name: tool.name,
    description: tool.description,
    tags: tool.tags,
    favorite: tool.favorite,
    port: tool.port,
    url: tool.url,
    iconLucide: tool.iconLucide,
    iconColor: tool.iconColor,
    iconBackground: tool.iconBackground,
    hasProject: Boolean(tool.projectPath),
    lastLaunchedAt: tool.lastLaunchedAt,
  }
}

/** Pairing codes: 8 characters from an unambiguous alphabet, typed if the camera fails. */
export function mintPairingCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = randomBytes(8)
  let code = ''
  for (const byte of bytes) code += alphabet[byte % alphabet.length]
  return code
}

export class CompanionServer {
  private server: https.Server | null = null
  private wss: WebSocketServer | null = null
  private readonly sockets = new Set<Duplex>()
  private readonly clients = new Map<WebSocket, PairedDeviceView>()
  private pairing: PairingState | null = null
  private pairingTimer: ReturnType<typeof setTimeout> | null = null
  private listenInfo: ListenInfo | null = null
  private readonly authFailures = new Map<string, { count: number; resetAt: number }>()
  private readonly lastTouch = new Map<string, number>()

  constructor(private readonly options: CompanionServerOptions) {}

  get clientCount(): number {
    return this.clients.size
  }

  get listening(): ListenInfo | null {
    return this.listenInfo
  }

  pairingState(): { url: string; expiresAt: string } | null {
    if (!this.pairing || !this.listenInfo) return null
    if (this.pairing.expiresAt <= Date.now()) {
      this.cancelPairing()
      return null
    }
    return {
      url: `${this.listenInfo.url}/pair#${this.pairing.code}.${this.options.tls.fingerprint}`,
      expiresAt: new Date(this.pairing.expiresAt).toISOString(),
    }
  }

  /** Mint a single-use pairing code valid for the TTL. Replaces any live one. */
  beginPairing(ttlMs = COMPANION_PAIRING_TTL_MS): { url: string; expiresAt: string } {
    if (!this.listenInfo) throw new Error('Turn Companion on before pairing a device.')
    this.cancelPairing()
    this.pairing = { code: mintPairingCode(), expiresAt: Date.now() + ttlMs }
    this.pairingTimer = setTimeout(() => this.cancelPairing(), ttlMs)
    this.pairingTimer.unref?.()
    return this.pairingState()!
  }

  cancelPairing(): void {
    if (this.pairingTimer) clearTimeout(this.pairingTimer)
    this.pairingTimer = null
    this.pairing = null
  }

  async listen(address: string, port: number): Promise<ListenInfo> {
    if (this.server) throw new Error('Companion server is already running.')
    if (isLoopbackAddress(address) || isUnspecifiedAddress(address)) {
      throw new Error('Companion refuses loopback and all-interface addresses.')
    }
    const server = https.createServer(
      { key: this.options.tls.key, cert: this.options.tls.cert, minVersion: 'TLSv1.2' },
      (req, res) => { void this.handle(req, res) },
    )
    // Plain HTTP on a TLS port fails the handshake; Node reports it here.
    server.on('tlsClientError', () => { /* refused by design */ })
    server.on('connection', (socket) => {
      this.sockets.add(socket)
      socket.on('close', () => this.sockets.delete(socket))
    })
    const wss = new WebSocketServer({
      noServer: true,
      handleProtocols: (protocols) => (protocols.has(COMPANION_WS_PROTOCOL) ? COMPANION_WS_PROTOCOL : false),
    })
    server.on('upgrade', (req, socket, head) => this.upgrade(wss, req, socket, head))
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(port, address, () => {
        server.off('error', reject)
        resolve()
      })
    })
    server.on('error', (err) => this.options.log?.(`companion server error: ${err.message}`))
    this.server = server
    this.wss = wss
    const bound = server.address()
    const boundPort = typeof bound === 'object' && bound ? bound.port : port
    this.listenInfo = { address, port: boundPort, url: `https://${address}:${boundPort}` }
    return this.listenInfo
  }

  async close(): Promise<void> {
    this.cancelPairing()
    for (const ws of this.clients.keys()) {
      try { ws.close(1001, 'Companion is turning off') } catch { /* already gone */ }
    }
    this.clients.clear()
    this.options.onClientsChanged?.(0)
    const server = this.server
    this.server = null
    this.wss?.close()
    this.wss = null
    this.listenInfo = null
    if (!server) return
    for (const socket of this.sockets) socket.destroy()
    this.sockets.clear()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }

  /** Fan a ProcessManager event out to every connected phone. */
  broadcast(channel: string, payload: unknown): void {
    if (this.clients.size === 0) return
    let message: CompanionWsMessage | null = null
    if (channel === 'process:update') message = { type: 'process:update', state: payload as ToolRuntimeState }
    else if (channel === 'logs:line') message = { type: 'logs:line', line: payload as LogLine }
    else if (channel === 'receipts:update') message = { type: 'receipts:update', receipt: payload as RunReceipt }
    if (message) this.send(message)
  }

  notifyLibraryChanged(): void {
    this.send({ type: 'library:changed' })
  }

  private send(message: CompanionWsMessage): void {
    const text = JSON.stringify(message)
    for (const ws of this.clients.keys()) {
      if (ws.readyState === WebSocket.OPEN) ws.send(text)
    }
  }

  // ---- HTTP -----------------------------------------------------------

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url || '/', 'https://companion.invalid')
    const method = req.method || 'GET'
    try {
      if (url.pathname.startsWith('/api/')) {
        await this.api(method, url, req, res)
        return
      }
      if (method !== 'GET' && method !== 'HEAD') throw new HttpError(405, 'Method not allowed')
      this.serveStatic(url.pathname, res)
    } catch (err) {
      if (res.headersSent) { res.end(); return }
      if (err instanceof HttpError) {
        this.json(res, err.status, { error: err.message })
        return
      }
      const message = err instanceof Error ? err.message : String(err)
      this.json(res, 500, { error: message })
    }
  }

  private async api(method: string, url: URL, req: IncomingMessage, res: ServerResponse): Promise<void> {
    const remote = req.socket.remoteAddress || 'unknown'
    const parts = url.pathname.split('/').filter(Boolean) // ['api', ...]

    if (parts[1] === 'pair') {
      if (method !== 'POST') throw new HttpError(405, 'Method not allowed')
      this.assertNotRateLimited(remote)
      const body = await this.readJson(req) as { code?: unknown; name?: unknown }
      const result = this.pair(body, remote)
      if (!result) {
        this.noteAuthFailure(remote)
        throw new HttpError(400, 'That pairing code is not valid. Ask Shelf for a new QR code.')
      }
      this.options.onDevicesChanged?.()
      this.json(res, 200, result)
      return
    }

    const device = this.authenticate(req, remote)
    const host = this.options.host

    if (parts[1] === 'overview' && method === 'GET') {
      const [states, health] = await Promise.all([host.getStates(), host.health()])
      const overview: CompanionOverview = {
        appVersion: host.appVersion,
        generatedAt: new Date().toISOString(),
        tools: host.listTools().map((tool) => toCompanionTool(tool, host.previewReady(tool.id), host.toolIcon(tool))),
        collections: host.listCollections(),
        states,
        health,
        board: host.board(),
        keepAwakeActive: host.keepAwakeActive(),
      }
      this.json(res, 200, overview)
      return
    }

    if (parts[1] === 'me') {
      if (method === 'GET') { this.json(res, 200, device); return }
      if (method === 'DELETE') {
        // The phone unpairs itself; its token dies with this request.
        this.options.devices.revoke(device.id)
        this.dropClientsOf(device.id)
        this.options.onDevicesChanged?.()
        this.json(res, 200, { ok: true })
        return
      }
      throw new HttpError(405, 'Method not allowed')
    }

    if (parts[1] === 'tools' && parts[2]) {
      const toolId = decodeURIComponent(parts[2])
      this.assertToolExists(toolId)
      const action = parts[3]
      if (method === 'GET' && action === 'logs') {
        const runId = url.searchParams.get('runId') || undefined
        this.json(res, 200, host.logs(toolId, runId))
        return
      }
      if (method === 'GET' && action === 'report') {
        const runId = url.searchParams.get('runId') || undefined
        this.json(res, 200, { report: await host.errorReport(toolId, runId) })
        return
      }
      if (method === 'GET' && action === 'receipts') {
        this.json(res, 200, host.receipts(toolId))
        return
      }
      if (method === 'POST' && action === 'start') { this.json(res, 200, await host.start(toolId, device)); return }
      if (method === 'POST' && action === 'stop') { this.json(res, 200, await host.stop(toolId)); return }
      if (method === 'POST' && action === 'restart') { this.json(res, 200, await host.restart(toolId, device)); return }
      if (method === 'POST' && action === 'preview-grant') {
        try {
          this.json(res, 200, await host.previewGrant(toolId, device))
        } catch (err) {
          throw new HttpError(409, err instanceof Error ? err.message : String(err))
        }
        return
      }
      throw new HttpError(404, 'Not found')
    }

    if (parts[1] === 'collections' && parts[2] && method === 'POST') {
      const collectionId = decodeURIComponent(parts[2])
      if (!host.listCollections().some((item) => item.id === collectionId)) throw new HttpError(404, 'Collection not found')
      if (parts[3] === 'start') { this.json(res, 200, await host.startCollection(collectionId, device)); return }
      if (parts[3] === 'stop') { this.json(res, 200, await host.stopCollection(collectionId)); return }
    }

    throw new HttpError(404, 'Not found')
  }

  private assertToolExists(toolId: string): void {
    if (!this.options.host.listTools().some((tool) => tool.id === toolId)) {
      throw new HttpError(404, 'That tool is no longer in the library.')
    }
  }

  private pair(body: { code?: unknown; name?: unknown }, remote: string): CompanionPairResponse | null {
    const live = this.pairing
    if (!live || live.expiresAt <= Date.now()) {
      this.cancelPairing()
      return null
    }
    const offered = typeof body.code === 'string' ? body.code.trim().toUpperCase() : ''
    if (offered.length !== live.code.length) return null
    if (!timingSafeEqual(Buffer.from(offered, 'utf8'), Buffer.from(live.code, 'utf8'))) return null
    // Single use: the code dies the moment it matches, before the token exists.
    this.cancelPairing()
    const token = mintDeviceToken()
    const device = this.options.devices.create(sanitizeDeviceName(body.name, 'Paired phone'), token)
    this.options.devices.touch(device.id, remote)
    this.options.log?.(`companion: paired “${device.name}” from ${remote}`)
    return { token, device: { ...device, lastSeenAt: new Date().toISOString(), lastSeenFrom: remote } }
  }

  private authenticate(req: IncomingMessage, remote: string): PairedDeviceView {
    this.assertNotRateLimited(remote)
    const header = req.headers.authorization || ''
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
    const device = token ? this.options.devices.authenticate(token) : null
    if (!device) {
      this.noteAuthFailure(remote)
      throw new HttpError(401, 'Unauthorized')
    }
    this.touch(device.id, remote)
    return device
  }

  private touch(deviceId: string, remote: string): void {
    const now = Date.now()
    const last = this.lastTouch.get(deviceId) || 0
    if (now - last < TOUCH_INTERVAL_MS) return
    this.lastTouch.set(deviceId, now)
    try {
      this.options.devices.touch(deviceId, remote)
      this.options.onDevicesChanged?.()
    } catch { /* a missed lastSeen is not worth failing a request */ }
  }

  private assertNotRateLimited(remote: string): void {
    const entry = this.authFailures.get(remote)
    if (!entry) return
    if (entry.resetAt <= Date.now()) {
      this.authFailures.delete(remote)
      return
    }
    if (entry.count >= AUTH_FAILURE_LIMIT) throw new HttpError(429, 'Too many attempts. Try again in a minute.')
  }

  private noteAuthFailure(remote: string): void {
    const now = Date.now()
    const entry = this.authFailures.get(remote)
    if (!entry || entry.resetAt <= now) {
      this.authFailures.set(remote, { count: 1, resetAt: now + AUTH_FAILURE_WINDOW_MS })
      return
    }
    entry.count += 1
  }

  private readJson(req: IncomingMessage): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = []
      let size = 0
      req.on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size > MAX_BODY_BYTES) {
          reject(new HttpError(413, 'Request too large'))
          req.destroy()
          return
        }
        chunks.push(chunk)
      })
      req.on('end', () => {
        if (chunks.length === 0) { resolve({}); return }
        try {
          const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
          resolve(parsed && typeof parsed === 'object' ? parsed : {})
        } catch {
          reject(new HttpError(400, 'Body must be JSON'))
        }
      })
      req.on('error', reject)
    })
  }

  private json(res: ServerResponse, status: number, body: unknown): void {
    res.writeHead(status, JSON_HEADERS)
    res.end(JSON.stringify(body))
  }

  // ---- static web app ---------------------------------------------------

  private serveStatic(pathname: string, res: ServerResponse): void {
    const root = this.options.staticRoot
    if (pathname === '/manifest.webmanifest') {
      res.writeHead(200, { 'content-type': 'application/manifest+json', 'cache-control': 'no-store' })
      res.end(JSON.stringify({
        name: 'Shelf Companion',
        short_name: 'Shelf',
        start_url: '/',
        display: 'standalone',
        background_color: '#090d16',
        theme_color: '#090d16',
        icons: [{ src: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
      }))
      return
    }
    if (pathname === '/apple-touch-icon.png' || pathname === '/icon.png') {
      const icon = this.options.iconPngPath
      if (icon && fs.existsSync(icon)) {
        res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'public, max-age=86400' })
        fs.createReadStream(icon).pipe(res)
        return
      }
      throw new HttpError(404, 'Not found')
    }
    if (!root) throw new HttpError(404, 'The companion web app is not built. Run npm run build.')

    // Only two places are ever served: the built bundle's assets, and the
    // companion index for every app route. A path that resolves anywhere
    // else is a 404, symlinks included.
    if (pathname.startsWith('/assets/')) {
      const assetsDir = fs.realpathSync(path.join(root, 'assets'))
      const candidate = path.resolve(assetsDir, '.' + pathname.slice('/assets'.length))
      if (!candidate.startsWith(assetsDir + path.sep)) throw new HttpError(404, 'Not found')
      let real: string
      try { real = fs.realpathSync(candidate) } catch { throw new HttpError(404, 'Not found') }
      if (!real.startsWith(assetsDir + path.sep) || !fs.statSync(real).isFile()) throw new HttpError(404, 'Not found')
      res.writeHead(200, { 'content-type': contentTypeFor(real), 'cache-control': 'public, max-age=31536000, immutable' })
      fs.createReadStream(real).pipe(res)
      return
    }
    const index = path.join(root, 'companion', 'index.html')
    if (!fs.existsSync(index)) throw new HttpError(404, 'The companion web app is not built. Run npm run build.')
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    fs.createReadStream(index).pipe(res)
  }

  // ---- WebSocket ----------------------------------------------------------

  private upgrade(wss: WebSocketServer, req: IncomingMessage, socket: Duplex, head: Buffer): void {
    const remote = req.socket.remoteAddress || 'unknown'
    const url = new URL(req.url || '/', 'https://companion.invalid')
    const protocols = (req.headers['sec-websocket-protocol'] || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
    const token = protocols.find((item) => item !== COMPANION_WS_PROTOCOL) || ''
    let device: PairedDeviceView | null = null
    try {
      this.assertNotRateLimited(remote)
      device = url.pathname === '/ws' && protocols.includes(COMPANION_WS_PROTOCOL) && token
        ? this.options.devices.authenticate(token)
        : null
    } catch { device = null }
    if (!device) {
      this.noteAuthFailure(remote)
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\nContent-Length: 0\r\n\r\n')
      socket.destroy()
      return
    }
    const paired = device
    this.touch(paired.id, remote)
    wss.handleUpgrade(req, socket, head, (ws) => {
      this.clients.set(ws, paired)
      this.options.onClientsChanged?.(this.clients.size)
      // The probed table, not the in-memory one: tools launched by an agent
      // or adopted from outside are running too, and the phone's list must
      // not flip to Stopped on every reconnect.
      void this.options.host.getStates()
        .catch(() => this.options.host.peekStates())
        .then((states) => {
          if (ws.readyState !== WebSocket.OPEN) return
          const hello: CompanionWsMessage = { type: 'hello', states, device: paired }
          ws.send(JSON.stringify(hello))
        })
      ws.on('message', () => { /* the phone only listens; nothing is accepted here */ })
      ws.on('close', () => {
        this.clients.delete(ws)
        this.options.onClientsChanged?.(this.clients.size)
      })
      ws.on('error', () => ws.terminate())
    })
  }

  /** After a revoke: a connected phone loses its stream at once, not at its next request. */
  dropClientsOf(deviceId: string): void {
    for (const [ws, device] of this.clients) {
      if (device.id !== deviceId) continue
      this.clients.delete(ws)
      try { ws.close(4001, 'Device revoked') } catch { /* already gone */ }
    }
    this.options.onClientsChanged?.(this.clients.size)
  }
}

function contentTypeFor(file: string): string {
  switch (path.extname(file).toLowerCase()) {
    case '.js': return 'text/javascript; charset=utf-8'
    case '.css': return 'text/css; charset=utf-8'
    case '.svg': return 'image/svg+xml'
    case '.png': return 'image/png'
    case '.woff2': return 'font/woff2'
    case '.woff': return 'font/woff'
    case '.json': return 'application/json; charset=utf-8'
    case '.map': return 'application/json; charset=utf-8'
    default: return 'application/octet-stream'
  }
}
