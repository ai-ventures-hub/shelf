/**
 * Companion Phase B smoke: the port-for-port preview proxy.
 *
 * A throwaway backend on loopback (HTTP + WebSocket echo) stands in for a
 * tool; the proxy listens on the same port on the Mac's first non-loopback
 * interface with a throwaway certificate. Checks: bare request 401, ticket →
 * cookie, cookie passes, the grant cookie never reaches the tool, loopback
 * redirects are rewritten, WebSocket upgrades reach the tool, revoke and
 * release cut access, and the agent write path (shelf_upsert_tool over the
 * real MCP server) cannot turn the flag on and does not drop it.
 *
 * Run: npm run smoke:companion-preview
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const require = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(__dirname, '..')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shelf-smoke-preview-'))
process.env.SHELF_DATA_ROOT = root

const { listCompanionInterfaces } = require('../dist-electron/shared/companion-net.js')
const { PreviewProxy, previewBlocker, PREVIEW_COOKIE } = require('../dist-electron/shared/companion-preview.js')
const { ensureCompanionCertificate } = require('../dist-electron/shared/companion-cert.js')
const { toolSchema } = require('../dist-electron/shared/tool-validation.js')
const { LibraryStore } = require('../dist-electron/shared/library-store.js')
const { WebSocketServer, WebSocket } = require('ws')

// ---- static policy ---------------------------------------------------------------
{
  assert.equal(previewBlocker({ port: 3000, url: 'http://127.0.0.1:3000' }), null)
  assert.equal(previewBlocker({ port: 3000 }), null)
  assert.match(previewBlocker({ url: 'http://127.0.0.1:3000' }) || '', /needs a port/)
  assert.match(previewBlocker({ port: 3000, url: 'http://192.168.1.5:3000' }) || '', /not this Mac/)
  assert.equal(previewBlocker({ port: 3000, url: 'http://localhost:3000/app' }), null)
  assert.equal(toolSchema.shape.remotePreview.safeParse(true).success, true)
  assert.equal(toolSchema.shape.remotePreview.safeParse(undefined).success, true)
  assert.throws(() => new PreviewProxy({ bindAddress: '127.0.0.1', tls: { key: 'k', cert: 'c' }, basePort: 48621 }), /loopback/)
  assert.throws(() => new PreviewProxy({ bindAddress: '0.0.0.0', tls: { key: 'k', cert: 'c' }, basePort: 48621 }), /loopback|all-interface/)
  assert.throws(() => new PreviewProxy({ bindAddress: '192.168.1.20', tls: { key: 'k', cert: 'c' }, basePort: 80 }), /base port/)
  console.log('OK: preview policy — port required, loopback url only, proxy never binds loopback or 0.0.0.0')
}

// ---- agent write path cannot set the flag --------------------------------------
{
  const library = new LibraryStore()
  const now = new Date().toISOString()
  const fixture = path.join(repo, 'fixtures/sample-tool')
  const tool = library.save({
    id: 'preview-agent-check', name: 'Preview Agent Check', tags: [], capabilities: [], agentAccess: [], favorite: false,
    projectPath: fixture, launchCommand: 'PORT=8767 node server.mjs', port: 8767, url: 'http://127.0.0.1:8767',
    createdAt: now, updatedAt: now,
  })
  assert.equal(tool.remotePreview, undefined)
  const client = new Client({ name: 'shelf-smoke-preview', version: '0.1.0' })
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: [path.join(repo, 'dist-mcp/mcp/server.js')],
    env: { ...process.env, SHELF_DATA_ROOT: root },
    stderr: 'ignore',
  }))
  const upsert = async (args) => {
    const result = await client.callTool({ name: 'shelf_upsert_tool', arguments: args })
    const text = result.content?.find((c) => c.type === 'text')?.text
    assert.ok(!result.isError, text)
    return JSON.parse(text)
  }
  // An agent may ask for preview from the user's paired phones; omitting the
  // field keeps what is stored, and false turns it off again.
  await upsert({ id: tool.id, description: 'edited by an agent', remotePreview: true })
  assert.equal(library.get(tool.id).remotePreview, true, 'shelf_upsert_tool can turn remote preview on')
  assert.equal(library.get(tool.id).description, 'edited by an agent')
  await upsert({ id: tool.id, description: 'edited again by an agent' })
  assert.equal(library.get(tool.id).remotePreview, true, 'shelf_upsert_tool keeps the stored flag when omitted')
  await upsert({ id: tool.id, remotePreview: false })
  assert.equal(library.get(tool.id).remotePreview, undefined, 'false clears the flag (stored as absent)')
  // A NEW folder is only staged; the request rides on the draft for the user to see.
  const stagedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shelf-preview-draft-'))
  fs.writeFileSync(path.join(stagedDir, 'package.json'), JSON.stringify({ name: 'staged', scripts: { start: 'node server.js' } }))
  const staged = await upsert({ name: 'Staged With Preview', projectPath: stagedDir, launchCommand: 'npm start', port: 8768, remotePreview: true })
  assert.equal(staged.outcome, 'pending_consent')
  assert.equal(staged.draft.remotePreview, true, 'the draft says preview was requested')
  const { ToolDraftStore, acceptToolDraft } = require('../dist-electron/shared/tool-draft-store.js')
  const drafts = new ToolDraftStore(root)
  assert.equal(drafts.get(staged.draft.id)?.remotePreview, true)
  const { ProcessManager } = require('../dist-electron/shared/process-manager.js')
  const accepted = await acceptToolDraft(staged.draft.id, drafts, { store: library, processes: new ProcessManager(library, { defaultOrigin: () => ({ kind: 'gui' }) }) }, { expectedUpdatedAt: staged.draft.updatedAt })
  assert.equal(accepted.tool?.remotePreview, true, 'accepting the draft grants the requested preview')
  assert.equal(accepted.tool?.launchCommand, 'npm start')
  fs.rmSync(stagedDir, { recursive: true, force: true })
  await client.close()
  console.log('OK: shelf_upsert_tool sets, keeps, and clears remotePreview; a staged draft carries the request')
}

// ---- live proxy --------------------------------------------------------------------------
const interfaces = listCompanionInterfaces()
if (interfaces.length === 0) {
  console.log('SKIP: no non-loopback IPv4 interface; live proxy checks not run')
  finish()
} else {
  await live(interfaces[0].address).then(finish, (err) => { console.error(err); process.exitCode = 1; finish() })
}

async function live(address) {
  // Backend "tool" on loopback: echoes what it saw, redirects to itself, and echoes WebSocket frames.
  const seen = []
  const backend = http.createServer((req, res) => {
    seen.push({ url: req.url, host: req.headers.host, cookie: req.headers.cookie, forwardedHost: req.headers['x-forwarded-host'] })
    if (req.url === '/redirect') {
      res.writeHead(302, { location: `http://127.0.0.1:${port}/after` })
      res.end()
      return
    }
    res.writeHead(200, { 'content-type': 'text/plain' })
    res.end(`tool saw ${req.method} ${req.url}`)
  })
  const wss = new WebSocketServer({ server: backend })
  wss.on('connection', (socket) => socket.on('message', (data) => socket.send(`echo:${data}`)))
  await new Promise((resolve) => backend.listen(0, '127.0.0.1', resolve))
  const port = backend.address().port

  const cert = ensureCompanionCertificate(root, [address])
  let logs = []
  // Base port chosen at random high in the range so repeated runs do not collide with a stale listener.
  const basePort = 50000 + Math.floor(Math.random() * 5000)
  const proxy = new PreviewProxy({ bindAddress: address, tls: { key: cert.key, cert: cert.cert }, basePort, ticketTtlMs: 500, log: (m) => logs.push(m) })

  assert.equal(proxy.listening('tool'), false)
  assert.throws(() => proxy.issueTicket('tool', 'device-1'), /not available/, 'no ticket without a listener')
  const origin = await proxy.ensure({ toolId: 'tool', port, backend: 'http' })
  const lport = proxy.listenPort('tool')
  assert.equal(lport, basePort, 'the first listener takes the base port')
  assert.notEqual(lport, port, 'the proxy never listens on the tool’s own port number')
  assert.equal(origin, `https://${address}:${lport}`)
  assert.equal(proxy.listening('tool'), true)
  assert.equal(await proxy.ensure({ toolId: 'tool', port, backend: 'http' }), origin, 'ensure is idempotent')
  console.log(`OK: proxy listening on ${origin} → 127.0.0.1:${port} (own port, not the tool’s)`)

  const request = (p, { cookie, method = 'GET', headers = {} } = {}) => new Promise((resolve, reject) => {
    const req = https.request({ host: address, port: lport, method, path: p, rejectUnauthorized: false, headers: { ...(cookie ? { cookie } : {}), ...headers } }, (res) => {
      let text = ''
      res.on('data', (c) => { text += c })
      res.on('end', () => resolve({ status: res.statusCode, body: text, headers: res.headers }))
    })
    req.on('error', reject)
    req.end()
  })

  // Plain HTTP on the TLS port gets nothing.
  await new Promise((resolve) => {
    const socket = net.connect(lport, address, () => socket.write(`GET / HTTP/1.1\r\nHost: ${address}\r\n\r\n`))
    let data = ''
    socket.on('data', (c) => { data += c })
    socket.on('close', () => { assert.equal(data.includes('tool saw'), false); resolve() })
    socket.on('error', () => resolve())
    setTimeout(() => socket.destroy(), 2000).unref()
  })

  // Bare request → 401, and the tool never heard about it.
  const bare = await request('/')
  assert.equal(bare.status, 401)
  assert.match(bare.body, /Shelf Companion/)
  assert.equal(seen.length, 0, 'an unauthorized request never reaches the tool')
  const badCookie = await request('/', { cookie: `${PREVIEW_COOKIE}=${'x'.repeat(43)}` })
  assert.equal(badCookie.status, 401)
  assert.equal(seen.length, 0)
  const badTicket = await request('/__shelf_grant?t=nope')
  assert.equal(badTicket.status, 401)
  console.log('OK: without a grant the proxy answers 401 and forwards nothing')

  // Ticket → cookie, single use.
  const ticket = proxy.issueTicket('tool', 'device-1')
  assert.ok(ticket.url.startsWith(`${origin}/__shelf_grant?t=`))
  const granted = await request(new URL(ticket.url).pathname + new URL(ticket.url).search)
  assert.equal(granted.status, 302)
  assert.equal(granted.headers.location, '/')
  const setCookie = String(granted.headers['set-cookie'])
  assert.match(setCookie, new RegExp(`^${PREVIEW_COOKIE}=[A-Za-z0-9_-]+; Path=/; Max-Age=\\d+; Secure; HttpOnly; SameSite=Lax$`))
  const cookie = setCookie.split(';')[0]
  const reused = await request(new URL(ticket.url).pathname + new URL(ticket.url).search)
  assert.equal(reused.status, 401, 'a ticket is single use')
  const expiring = proxy.issueTicket('tool', 'device-1')
  await new Promise((r) => setTimeout(r, 600))
  assert.equal((await request(new URL(expiring.url).pathname + new URL(expiring.url).search)).status, 401, 'a ticket expires')
  console.log('OK: a ticket becomes a cookie once, then expires')

  // With the cookie: proxied, cookie stripped, host rewritten, forwarded headers present.
  const ok = await request('/hello?x=1', { cookie: `other=1; ${cookie}` })
  assert.equal(ok.status, 200)
  assert.equal(ok.body, 'tool saw GET /hello?x=1')
  const last = seen.at(-1)
  assert.equal(last.host, `127.0.0.1:${port}`, 'Host is rewritten to loopback so dev servers accept it')
  assert.equal(last.cookie, 'other=1', 'the grant cookie never reaches the tool; other cookies do')
  assert.equal(last.forwardedHost, `${address}:${lport}`)
  const redirected = await request('/redirect', { cookie })
  assert.equal(redirected.status, 302)
  assert.equal(redirected.headers.location, `${origin}/after`, 'loopback redirects land back on the proxy')
  console.log('OK: granted requests are proxied with Host rewritten and the grant stripped')

  // WebSocket upgrade reaches the tool; without the cookie it is refused.
  const echoed = await new Promise((resolve, reject) => {
    const ws = new WebSocket(`wss://${address}:${lport}/ws`, { rejectUnauthorized: false, headers: { cookie } })
    ws.on('open', () => ws.send('ping'))
    ws.on('message', (data) => { resolve(String(data)); ws.close() })
    ws.on('error', reject)
    setTimeout(() => reject(new Error('no echo through the proxy')), 4000).unref()
  })
  assert.equal(echoed, 'echo:ping')
  await new Promise((resolve) => {
    const ws = new WebSocket(`wss://${address}:${lport}/ws`, { rejectUnauthorized: false })
    ws.on('open', () => { ws.close(); assert.fail('tokenless upgrade must not open') })
    ws.on('unexpected-response', (_req, res) => { assert.equal(res.statusCode, 401); resolve() })
    ws.on('error', () => resolve())
  })
  console.log('OK: WebSocket upgrades reach the tool only with a grant')

  // Revoke the device: its cookie dies.
  proxy.revokeDevice('device-1')
  assert.equal((await request('/', { cookie })).status, 401, 'revoked device loses its grant')
  // A second device keeps its own grant.
  const t2 = proxy.issueTicket('tool', 'device-2')
  const g2 = await request(new URL(t2.url).pathname + new URL(t2.url).search)
  const cookie2 = String(g2.headers['set-cookie']).split(';')[0]
  assert.equal((await request('/', { cookie: cookie2 })).status, 200)
  console.log('OK: revoking one device leaves the other device’s grant intact')

  // Release: the port closes and grants are gone.
  await proxy.release('tool')
  assert.equal(proxy.listening('tool'), false)
  await assert.rejects(request('/', { cookie: cookie2 }), /ECONNREFUSED|ECONNRESET|socket hang up/, 'released listener is gone')
  assert.throws(() => proxy.issueTicket('tool', 'device-2'), /not available/)
  // Backend still runs on loopback; only the companion-side door closed.
  await new Promise((resolve, reject) => http.get(`http://127.0.0.1:${port}/still`, (res) => { assert.equal(res.statusCode, 200); res.resume(); resolve() }).on('error', reject))

  // A taken port in the range is skipped, and two tools never share a listener port.
  const squatter = net.createServer()
  await new Promise((resolve) => squatter.listen(basePort, address, resolve))
  const again = await proxy.ensure({ toolId: 'tool', port, backend: 'http' })
  assert.equal(proxy.listenPort('tool'), basePort + 1, 'a squatted base port is skipped')
  assert.equal(again, `https://${address}:${basePort + 1}`)
  await proxy.ensure({ toolId: 'other', port, backend: 'http' })
  assert.equal(proxy.listenPort('other'), basePort + 2, 'each tool gets its own port')
  await new Promise((resolve) => squatter.close(resolve))
  // Nothing in the range at all → a clear error, not a hang.
  const tiny = new PreviewProxy({ bindAddress: address, tls: { key: cert.key, cert: cert.cert }, basePort: basePort + 1, portSpan: 1 })
  await assert.rejects(tiny.ensure({ toolId: 'x', port, backend: 'http' }), /No free preview port/)

  await proxy.releaseAll()
  wss.close()
  await new Promise((resolve) => backend.close(resolve))
  console.log('OK: companion preview proxy smoke passed')
}

function finish() {
  fs.rmSync(root, { recursive: true, force: true })
  if (process.exitCode) process.exit(process.exitCode)
}
