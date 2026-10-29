/**
 * Companion server smoke (Phase A): bind policy, the device store, pairing,
 * auth, rate limiting, the live stream, and the sample fixture started from
 * a "phone".
 *
 * Runs under Node against dist-electron/shared (no Electron). The live part
 * needs a non-loopback IPv4 interface — the server refuses loopback by
 * design — and the system openssl for the certificate; without either it
 * reports what it skipped and still passes the policy checks.
 *
 * Run: npm run smoke:companion
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import https from 'node:https'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shelf-smoke-companion-'))
process.env.SHELF_DATA_ROOT = root

const {
  listCompanionInterfaces, validateBindAddress, resolveBindAddress, isTailscaleAddress, validateCompanionPort,
} = require('../dist-electron/shared/companion-net.js')
const { CompanionDeviceStore, hashDeviceToken } = require('../dist-electron/shared/companion-store.js')
const { CompanionServer, toCompanionTool, mintPairingCode } = require('../dist-electron/shared/companion-server.js')
const { ensureCompanionCertificate, certificateProblem } = require('../dist-electron/shared/companion-cert.js')
const { LibraryStore } = require('../dist-electron/shared/library-store.js')
const { ProcessManager } = require('../dist-electron/shared/process-manager.js')
const { ReceiptStore } = require('../dist-electron/shared/receipt-store.js')
const { COMPANION_WS_PROTOCOL } = require('../dist-electron/shared/companion-contracts.js')
const WebSocket = require('ws')

// ---- bind policy (pure) ------------------------------------------------------
{
  const fake = [
    { name: 'en0', address: '192.168.1.20', tailscale: false },
    { name: 'utun4', address: '100.101.4.7', tailscale: true },
  ]
  assert.equal(isTailscaleAddress('100.101.4.7'), true)
  assert.equal(isTailscaleAddress('100.63.0.1'), false)
  assert.equal(isTailscaleAddress('192.168.1.20'), false)
  for (const bad of ['0.0.0.0', '::', '', '127.0.0.1', 'localhost', '::1', '10.9.9.9']) {
    const check = validateBindAddress(bad, fake)
    assert.equal(check.ok, false, `refuses ${JSON.stringify(bad)}`)
  }
  assert.deepEqual(validateBindAddress('192.168.1.20', fake), { ok: true, address: '192.168.1.20' })
  assert.deepEqual(resolveBindAddress('tailscale', fake), { ok: true, address: '100.101.4.7' })
  assert.equal(resolveBindAddress('tailscale', [fake[0]]).ok, false, 'tailscale pref without a utun is an error, never a fallback')
  assert.equal(validateCompanionPort(48620), 48620)
  assert.equal(validateCompanionPort(80), null)
  assert.equal(validateCompanionPort('48620'), null)
  const table = {
    lo0: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
    en0: [{ address: '192.168.1.20', family: 'IPv4', internal: false }, { address: 'fe80::1', family: 'IPv6', internal: false }],
    utun4: [{ address: '100.101.4.7', family: 'IPv4', internal: false }],
    utun1: [{ address: '10.8.0.2', family: 'IPv4', internal: false }],
  }
  const listed = listCompanionInterfaces(table)
  assert.deepEqual(listed.map((i) => i.address), ['100.101.4.7', '192.168.1.20', '10.8.0.2'], 'tailscale first, loopback and IPv6 dropped')
  assert.equal(listed[0].tailscale, true)
  assert.equal(listed[2].tailscale, false, 'a non-CGNAT utun is a plain VPN, not Tailscale')
  console.log('OK: bind policy refuses loopback, wildcard, unknown; prefers Tailscale')
}

// ---- device store --------------------------------------------------------------
{
  const store = new CompanionDeviceStore(root)
  assert.deepEqual(store.list(), [])
  const token = 'a'.repeat(43)
  const view = store.create('  Carlos\u0007 iPhone  ', token)
  assert.equal(view.name, 'Carlos iPhone', 'control characters stripped, trimmed')
  assert.equal('tokenHash' in view, false, 'the view never carries the hash')
  const file = JSON.parse(fs.readFileSync(path.join(root, 'companion', 'devices.json'), 'utf8'))
  assert.equal(file.devices[0].tokenHash, hashDeviceToken(token))
  assert.equal(JSON.stringify(file).includes(token), false, 'the token itself is never written')
  assert.equal(store.authenticate(token)?.id, view.id)
  assert.equal(store.authenticate('b'.repeat(43)), null)
  assert.equal(store.authenticate('short'), null)
  assert.equal(store.rename(view.id, 'Work phone').name, 'Work phone')
  assert.equal(store.revoke(view.id), true)
  assert.equal(store.authenticate(token), null, 'revoked token no longer authenticates')
  assert.equal(store.revoke(view.id), false)
  // Corrupt file → backup + reset.
  fs.writeFileSync(path.join(root, 'companion', 'devices.json'), '{not json')
  const recovered = new CompanionDeviceStore(root)
  assert.deepEqual(recovered.list(), [])
  assert.ok(fs.readdirSync(path.join(root, 'companion')).some((f) => f.startsWith('devices.corrupt-backup-')), 'corrupt file kept as a backup')
  const mode = fs.statSync(path.join(root, 'companion', 'devices.json')).mode & 0o777
  assert.equal(mode, 0o600, 'devices.json is private to the user')
  console.log('OK: device store hashes tokens, revokes, and recovers from corruption')
}

// ---- tool view -----------------------------------------------------------------
{
  const now = new Date().toISOString()
  const view = toCompanionTool({
    id: 't1', name: 'Secret Tool', launchCommand: 'API_KEY=sk-live-123 node server.js', tags: [], capabilities: [], agentAccess: [],
    favorite: false, env: { API_KEY: 'sk-live-123' }, notes: 'password hunter2', port: 3000, projectPath: '/tmp/x', createdAt: now, updatedAt: now,
  })
  const text = JSON.stringify(view)
  assert.equal(text.includes('sk-live'), false, 'launch command and env never reach the phone')
  assert.equal(text.includes('hunter2'), false, 'notes never reach the phone')
  assert.equal(view.hasProject, true)
  assert.equal(mintPairingCode().length, 8)
  assert.notEqual(mintPairingCode(), mintPairingCode())
  console.log('OK: the phone-facing tool view strips env, commands, and notes')
}

// ---- live server -------------------------------------------------------------------
const interfaces = listCompanionInterfaces()
if (interfaces.length === 0) {
  console.log('SKIP: no non-loopback IPv4 interface on this machine; live server checks not run')
  finish()
} else {
  await live(interfaces[0]).then(finish, (err) => { console.error(err); process.exitCode = 1; finish() })
}

async function live(iface) {
  const address = iface.address
  let cert = ensureCompanionCertificate(root, [address])
  assert.match(cert.fingerprint, /^[0-9a-f]{64}$/)
  assert.equal(fs.statSync(cert.keyPath).mode & 0o777, 0o600, 'private key is 0600')
  const again = ensureCompanionCertificate(root, [address])
  assert.equal(again.fingerprint, cert.fingerprint, 'a good certificate is never regenerated')
  {
    const { X509Certificate } = await import('node:crypto')
    const parsed = new X509Certificate(cert.cert)
    const days = (Date.parse(parsed.validTo) - Date.parse(parsed.validFrom)) / 86_400_000
    assert.ok(days <= 825, `iOS refuses server certificates over 825 days (got ${days})`)
    assert.equal(parsed.ca, true, 'iOS only trusts a self-signed server certificate that is a CA')
    assert.match(parsed.subjectAltName || '', /IP Address:/, 'SAN carries the Mac address')
    assert.equal(certificateProblem(cert.cert), null)
    // A pre-fix certificate (10 years, CA:FALSE) is replaced on the next load.
    fs.writeFileSync(cert.certPath, oldStyleCert(cert.keyPath))
    const replaced = ensureCompanionCertificate(root, [address])
    assert.notEqual(replaced.fingerprint, cert.fingerprint, 'a certificate iOS cannot trust is regenerated')
    assert.ok(fs.readdirSync(path.dirname(cert.certPath)).some((f) => /companion-cert\.pem\.(too-long|not-ca)-/.test(f)), 'the old certificate is set aside, not deleted')
    assert.equal(certificateProblem(replaced.cert), null)
    cert = replaced
  }

  const library = new LibraryStore()
  const receipts = new ReceiptStore()
  const processes = new ProcessManager(library, {
    receipts,
    defaultOrigin: () => ({ kind: 'gui' }),
    onEvent: (channel, payload) => server.broadcast(channel, payload),
  })
  const devices = new CompanionDeviceStore(root)
  let clientCount = 0
  const host = {
    appVersion: '0.0.0-smoke',
    listTools: () => library.list(),
    listCollections: () => library.listCollections(),
    getStates: () => processes.getStates(),
    peekStates: () => processes.peekStates(),
    health: async () => [],
    board: () => [],
    start: (id, device) => processes.start(id, { origin: { kind: 'companion', client: device.name }, openUrlWhenReady: false }),
    stop: (id) => processes.stop(id),
    restart: (id, device) => processes.restart(id, { origin: { kind: 'companion', client: device.name }, openUrlWhenReady: false }),
    logs: (id, runId) => processes.getLogs(id, runId),
    errorReport: async () => 'report',
    receipts: (id) => receipts.list({ toolId: id, limit: 50 }),
    startCollection: async () => ({ collectionId: 'x', name: 'x', results: [] }),
    stopCollection: async () => ({ collectionId: 'x', name: 'x', results: [] }),
    keepAwakeActive: () => false,
  }
  const server = new CompanionServer({
    host, devices,
    tls: { key: cert.key, cert: cert.cert, fingerprint: cert.fingerprint },
    onClientsChanged: (n) => { clientCount = n },
  })

  await assert.rejects(server.listen('127.0.0.1', 0), /loopback/, 'listen refuses loopback')
  await assert.rejects(server.listen('0.0.0.0', 0), /loopback|all-interface/, 'listen refuses 0.0.0.0')

  const info = await server.listen(address, 0)
  assert.equal(info.address, address)
  console.log(`OK: companion listening on ${info.url} (smoke, ephemeral port)`)

  const request = (method, p, { token, body, headers = {} } = {}) => new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body)
    const req = https.request({
      host: address, port: info.port, method, path: p, rejectUnauthorized: false,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {}),
        ...headers,
      },
    }, (res) => {
      let text = ''
      res.on('data', (c) => { text += c })
      res.on('end', () => resolve({ status: res.statusCode, body: text ? JSON.parse(text) : null, headers: res.headers }))
    })
    req.on('error', reject)
    if (payload) req.write(payload)
    req.end()
  })

  // Plain HTTP on the TLS port never gets a response.
  await new Promise((resolve, reject) => {
    const socket = net.connect(info.port, address, () => {
      socket.write(`GET /api/overview HTTP/1.1\r\nHost: ${address}\r\n\r\n`)
    })
    let data = ''
    socket.on('data', (c) => { data += c })
    socket.on('close', () => { assert.equal(data.includes('HTTP/1.1 200'), false, 'plain HTTP must not be served'); resolve() })
    socket.on('error', () => resolve())
    setTimeout(() => { socket.destroy(); reject(new Error('plain HTTP socket stayed open')) }, 3000).unref()
  })
  console.log('OK: plain HTTP is refused')

  // No token → 401 with a fixed body; the same body for a wrong token.
  const anon = await request('GET', '/api/overview')
  assert.equal(anon.status, 401)
  const wrong = await request('GET', '/api/overview', { token: 'x'.repeat(43) })
  assert.equal(wrong.status, 401)
  assert.deepEqual(anon.body, wrong.body, 'missing and wrong tokens are indistinguishable')
  assert.equal(anon.headers['cache-control'], 'no-store')

  // Pairing: no live code → 400; wrong code → 400; the right code once.
  assert.equal(server.pairingState(), null)
  assert.equal((await request('POST', '/api/pair', { body: { code: 'ABCDEFGH' } })).status, 400, 'no pairing in progress')
  assert.throws(() => { const s2 = new CompanionServer({ host, devices, tls: { key: cert.key, cert: cert.cert, fingerprint: cert.fingerprint } }); s2.beginPairing() }, /Turn Companion on/, 'pairing needs a running server')
  const pairing = server.beginPairing()
  assert.ok(pairing.url.startsWith(`${info.url}/pair#`))
  assert.ok(pairing.url.endsWith(`.${cert.fingerprint}`), 'QR carries the certificate fingerprint')
  const code = pairing.url.split('#')[1].split('.')[0]
  assert.equal(code.length, 8)
  assert.equal((await request('POST', '/api/pair', { body: { code: 'ZZZZZZZZ' } })).status, 400, 'wrong code refused')
  assert.ok(server.pairingState(), 'a wrong guess does not consume the code')
  const paired = await request('POST', '/api/pair', { body: { code: code.toLowerCase(), name: 'Smoke iPhone' } })
  assert.equal(paired.status, 200)
  assert.equal(typeof paired.body.token, 'string')
  assert.equal(paired.body.device.name, 'Smoke iPhone')
  assert.equal(server.pairingState(), null, 'code is single use')
  assert.equal((await request('POST', '/api/pair', { body: { code } })).status, 400, 'reused code refused')
  const token = paired.body.token
  console.log('OK: pairing code is single-use and mints a device token')

  // Expiry: a 1 ms code is dead before it can be used.
  server.beginPairing(1)
  await new Promise((r) => setTimeout(r, 20))
  assert.equal(server.pairingState(), null, 'expired pairing clears itself')
  assert.equal((await request('POST', '/api/pair', { body: { code } })).status, 400)

  // Authenticated overview matches the ProcessManager.
  const overview = await request('GET', '/api/overview', { token })
  assert.equal(overview.status, 200)
  assert.deepEqual(overview.body.states, await processes.getStates(), 'state stream matches ProcessManager.getStates()')
  assert.equal(overview.body.appVersion, '0.0.0-smoke')
  assert.equal(Array.isArray(overview.body.tools), true)
  const me = await request('GET', '/api/me', { token })
  assert.equal(me.body.id, paired.body.device.id)
  assert.equal('tokenHash' in me.body, false)

  // Unknown tool → 404; unknown route → 404; wrong method → 405.
  assert.equal((await request('POST', '/api/tools/nope/start', { token })).status, 404)
  assert.equal((await request('GET', '/api/nothing', { token })).status, 404)
  assert.equal((await request('GET', '/api/pair', { token })).status, 405)

  // Live stream: hello carries states; the token rides as a subprotocol.
  const ws = new WebSocket(`wss://${address}:${info.port}/ws`, [COMPANION_WS_PROTOCOL, token], { rejectUnauthorized: false })
  const messages = []
  const hello = await new Promise((resolve, reject) => {
    ws.on('message', (data) => { const m = JSON.parse(String(data)); messages.push(m); if (m.type === 'hello') resolve(m) })
    ws.on('error', reject)
    setTimeout(() => reject(new Error('no hello')), 4000).unref()
  })
  assert.deepEqual(hello.states, processes.peekStates())
  assert.equal(hello.device.id, paired.body.device.id)
  assert.equal(clientCount, 1, 'onClientsChanged fired')
  // A socket without the token is refused at upgrade.
  await new Promise((resolve) => {
    const bad = new WebSocket(`wss://${address}:${info.port}/ws`, [COMPANION_WS_PROTOCOL], { rejectUnauthorized: false })
    bad.on('open', () => { bad.close(); assert.fail('tokenless socket must not open') })
    bad.on('error', () => resolve())
    bad.on('unexpected-response', (_req, res) => { assert.equal(res.statusCode, 401); resolve() })
  })
  console.log('OK: live stream says hello to a paired phone and refuses an unpaired one')

  // Start the fixture from the "phone": receipt carries companion provenance, the stream reports it.
  const fixture = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../fixtures/sample-tool')
  const now = new Date().toISOString()
  const tool = library.save({
    id: `smoke-companion-${Date.now()}`, name: 'Sample Tool', tags: [], capabilities: [], agentAccess: [], favorite: false,
    projectPath: fixture, launchCommand: 'PORT=8766 node server.mjs', url: 'http://127.0.0.1:8766', port: 8766,
    createdAt: now, updatedAt: now,
  })
  const started = await request('POST', `/api/tools/${tool.id}/start`, { token })
  assert.equal(started.status, 200, JSON.stringify(started.body))
  assert.equal(started.body.status, 'running', started.body.message)
  assert.equal(started.body.startedBy?.kind, 'companion')
  assert.equal(started.body.startedBy?.client, 'Smoke iPhone')
  await new Promise((r) => setTimeout(r, 100))
  assert.ok(messages.some((m) => m.type === 'process:update' && m.state.toolId === tool.id && m.state.status === 'running'), 'process:update reached the phone')
  assert.ok(messages.some((m) => m.type === 'logs:line' && m.line.toolId === tool.id), 'log lines reach the phone')
  const logs = await request('GET', `/api/tools/${tool.id}/logs`, { token })
  assert.ok(logs.body.some((l) => l.text.includes('Sample tool listening')))
  const receiptsNow = await request('GET', `/api/tools/${tool.id}/receipts`, { token })
  assert.equal(receiptsNow.body[0]?.startedBy?.kind, 'companion', 'the receipt records the phone as the origin')
  const stopped = await request('POST', `/api/tools/${tool.id}/stop`, { token })
  assert.equal(stopped.body.status, 'stopped')
  console.log('OK: a phone can start and stop a tool; receipts say so')

  // Revoke: next request 401 and the live socket drops now.
  const closed = new Promise((resolve) => ws.on('close', (codeNum) => resolve(codeNum)))
  assert.equal(devices.revoke(paired.body.device.id), true)
  server.dropClientsOf(paired.body.device.id)
  assert.equal(await closed, 4001, 'revoked phone loses its stream at once')
  assert.equal((await request('GET', '/api/overview', { token })).status, 401, 'revoked token is refused on the next request')
  assert.equal(clientCount, 0)

  // Rate limit: a source that keeps failing gets 429.
  let limited = false
  for (let i = 0; i < 25; i += 1) {
    const r = await request('GET', '/api/overview', { token: 'y'.repeat(43) })
    if (r.status === 429) { limited = true; break }
  }
  assert.equal(limited, true, 'repeated auth failures are rate limited')
  console.log('OK: revoke takes effect at once; brute force is rate limited')

  // Static: without a built bundle the app route is a clear 404, never a directory listing.
  const page = await request('GET', '/')
  assert.equal(page.status, 404)
  const manifest = await request('GET', '/manifest.webmanifest')
  assert.equal(manifest.status, 200)
  assert.equal(manifest.body.display, 'standalone')

  await server.close()
  assert.equal(server.listening, null)
  console.log('OK: companion server smoke passed')
}

/** A certificate the way Phase A minted it: ten years, CA:FALSE. */
function oldStyleCert(keyPath) {
  const { execFileSync } = require('node:child_process')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shelf-old-cert-'))
  const cfg = path.join(dir, 'o.cnf')
  fs.writeFileSync(cfg, '[req]\ndistinguished_name=dn\nx509_extensions=v3\nprompt=no\n[dn]\nCN=Shelf Companion\n[v3]\nbasicConstraints=CA:FALSE\nsubjectAltName=IP:127.0.0.1\n')
  const out = path.join(dir, 'c.pem')
  execFileSync('/usr/bin/openssl', ['req', '-x509', '-new', '-key', keyPath, '-sha256', '-days', '3650', '-out', out, '-config', cfg], { stdio: 'ignore' })
  const pem = fs.readFileSync(out, 'utf8')
  fs.rmSync(dir, { recursive: true, force: true })
  return pem
}

function finish() {
  fs.rmSync(root, { recursive: true, force: true })
  if (process.exitCode) process.exit(process.exitCode)
}
