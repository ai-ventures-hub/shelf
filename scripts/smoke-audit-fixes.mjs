/**
 * Regressions from the September 28, 2026 audit (shared/ and main-process
 * fixes). Everything runs against temporary data roots and stubs.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { WebSocket } from 'ws'

const require = createRequire(import.meta.url)
const dist = (name) => require(`../dist-electron/shared/${name}.js`)
const { LibraryStore } = dist('library-store')
const { ReceiptStore } = dist('receipt-store')
const { ProjectMemoryStore } = dist('project-memory-store')
const { DesignProfileStore } = dist('design-profile-store')
const { VerificationStore } = dist('verification-store')
const { CapabilityGapStore } = dist('capability-gap-store')
const { ProcessOperations } = dist('process-operation')
const { ProcessManager } = dist('process-manager')
const { classifyLaunchFailure, remedyFor } = dist('launch-diagnostics')
const { startCollection, stopCollection } = dist('collection-launch')
const { findFreePort } = dist('ports')
const { sanitizeBackendSetCookies, PREVIEW_COOKIE } = dist('companion-cookies')
const { PreviewProxy, previewCookieName } = dist('companion-preview')
const { COMPANION_WS_PROTOCOL } = dist('companion-contracts')
const { CompanionServer } = dist('companion-server')
const { CompanionDeviceStore, mintDeviceToken } = dist('companion-store')
const { ensureCompanionCertificate } = dist('companion-cert')
const { listCompanionInterfaces } = dist('companion-net')
const { validateCatalogStarter } = dist('catalog-starter')
const { prepareProjectHandoff } = dist('project-handoff')
const { adoptedRunNote, maskCommandEnvPrefix } = dist('types')
const { saveUpdateResume, takeUpdateResume } = dist('update-resume')
const { containedDataUrl, ICON_MIME_TYPES } = dist('contained-data-url')
const { containsLikelySecret } = dist('capability-intelligence')

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shelf-audit-fixes-'))
const tool = (store, fields) => store.save({ id: '', tags: [], capabilities: [], agentAccess: [], favorite: false, createdAt: '', updatedAt: '', ...fields })

try {
  // Handoffs mask any-case inline assignments, like shelf_get_tool does.
  {
    const dataRoot = fs.mkdtempSync(path.join(root, 'handoff-'))
    const library = new LibraryStore(dataRoot)
    const saved = tool(library, { name: 'Leaky', launchCommand: 'openai_key=abc123LIVEVALUE npm run dev' })
    assert.equal(maskCommandEnvPrefix('db_pass=hunter22 node app.js'), 'db_pass=*** node app.js')
    const handoff = await prepareProjectHandoff({ library, memory: new ProjectMemoryStore(dataRoot), receipts: new ReceiptStore(dataRoot), design: new DesignProfileStore(dataRoot) }, saved.id, {})
    assert.ok(!JSON.stringify(handoff).includes('abc123LIVEVALUE'), 'handoff must not carry an inline env value')
    console.log('OK: handoffs mask lowercase inline env assignments')
  }

  // Catalog export checks what it writes, after invisible characters are stripped.
  {
    const token = 'ghp_' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8'
    const hidden = token.slice(0, 12) + '​' + token.slice(12)
    assert.throws(() => validateCatalogStarter(JSON.stringify({ shelfCatalog: 1, name: 'Team', tools: [{ name: 'A', description: `uses ${hidden}`, capabilities: [], repo: 'https://github.com/acme/a' }] })), /credential/)
    console.log('OK: catalog export refuses a token split by a zero-width space')
  }

  // A crashed host's lease whose pid now belongs to another user is stale.
  {
    const dataRoot = fs.mkdtempSync(path.join(root, 'lease-'))
    const ops = new ProcessOperations(dataRoot)
    const file = path.join(dataRoot, 'operations', `${createHash('sha256').update('tool-x').digest('hex')}.json`)
    // pid 1 (launchd) answers kill(1, 0) with EPERM for a normal user.
    fs.writeFileSync(file, JSON.stringify({ generation: 0, lease: { pid: 1, token: 'dead-host', startedAt: 'Thu Jan  1 00:00:00 1970' } }))
    const started = Date.now()
    assert.equal(await ops.run('tool-x', async () => 'ran'), 'ran')
    assert.ok(Date.now() - started < 5_000, 'a stale EPERM lease must not wait out the 90 s deadline')
    console.log('OK: an EPERM lease from a reused pid does not block the tool')
  }

  // An ordered stack waits for a member that is still starting.
  {
    const dataRoot = fs.mkdtempSync(path.join(root, 'stack-'))
    const library = new LibraryStore(dataRoot)
    const db = tool(library, { name: 'db', launchCommand: 'node db.js', port: 50001 })
    const api = tool(library, { name: 'api', launchCommand: 'node api.js', port: 50002 })
    const collection = library.saveCollection({ id: '', name: 'Stack', toolIds: [db.id, api.id], stack: { ordered: true, steps: [] } })
    const events = []
    let dbPolls = 0
    const processes = {
      async getState(id) {
        if (id === db.id) {
          dbPolls += 1
          events.push(`db:${dbPolls < 3 ? 'starting' : 'running'}`)
          return { toolId: id, status: dbPolls < 3 ? 'starting' : 'running' }
        }
        return { toolId: id, status: 'stopped' }
      },
      async start(id) { events.push(`start:${id === api.id ? 'api' : 'db'}`); return { toolId: id, status: 'running', port: 50002 } },
    }
    const result = await startCollection(collection.id, { store: library, processes })
    assert.deepEqual(events, ['db:starting', 'db:starting', 'db:running', 'start:api'], 'api must not spawn before db answers')
    assert.deepEqual(result.results.map((row) => row.outcome), ['already_running', 'started'])
    console.log('OK: ordered stacks wait for a member that is still starting')
  }

  // Deleting a tool leaves unrelated collections untouched.
  {
    const dataRoot = fs.mkdtempSync(path.join(root, 'collections-'))
    const library = new LibraryStore(dataRoot)
    const a = tool(library, { name: 'A', launchCommand: 'true' })
    const b = tool(library, { name: 'B', launchCommand: 'true' })
    const holds = library.saveCollection({ id: '', name: 'Holds A', toolIds: [a.id] })
    const other = library.saveCollection({ id: '', name: 'Only B', toolIds: [b.id] })
    await new Promise((resolve) => setTimeout(resolve, 5))
    library.delete(a.id)
    assert.equal(library.getCollection(other.id).updatedAt, other.updatedAt)
    assert.notEqual(library.getCollection(holds.id).updatedAt, holds.updatedAt)
    assert.deepEqual(library.getCollection(holds.id).toolIds, [])
    console.log('OK: deleting a tool stamps only the collections that held it')
  }

  // Deleted tools do not keep notes or verification history.
  {
    const dataRoot = fs.mkdtempSync(path.join(root, 'forget-'))
    const memory = new ProjectMemoryStore(dataRoot)
    const saved = memory.save({ toolId: 'gone', expectedRevision: null, fields: { purpose: 'kept until delete', conventions: '', decisions: '', knownIssues: '', nextSteps: '' } })
    assert.ok(saved.revision)
    memory.forget('gone')
    assert.equal(memory.get('gone'), null)
    const verification = new VerificationStore(dataRoot)
    verification.save({ toolId: 'gone', expectedRevision: null, steps: [{ id: '0f8fad5b-d9cb-469f-a165-70867728950e', label: 'Test', command: 'npm test', timeoutSeconds: 60 }] })
    assert.ok(verification.get('gone').workflow)
    verification.forget('gone')
    assert.equal(verification.get('gone').workflow, null)
    console.log('OK: deleted tools drop their memory and verification records')
  }

  // Adopted runs say who started them; interrupted runs drop their live status.
  {
    assert.equal(adoptedRunNote({ kind: 'gui' }), '(started in Shelf)')
    assert.match(adoptedRunNote({ kind: 'mcp', client: 'codex-mcp-client' }), /^\(started by /)
    assert.equal(adoptedRunNote(undefined), '(started by another Shelf process)')
    const dataRoot = fs.mkdtempSync(path.join(root, 'receipts-'))
    fs.writeFileSync(path.join(dataRoot, 'receipts.json'), JSON.stringify({ version: 1, receipts: [{ id: 'r1', toolId: 't', toolName: 'T', launchCommand: 'x', pid: 999999, startedAt: new Date(Date.now() - 1000).toISOString(), outcome: 'running', message: 'Running · port 5100' }] }))
    const receipts = new ReceiptStore(dataRoot)
    const closed = receipts.list().find((row) => row.id === 'r1')
    assert.equal(closed.outcome, 'interrupted')
    assert.doesNotMatch(closed.message, /^Running/)
    console.log('OK: adopted and interrupted runs describe themselves accurately')
  }

  // Restart and update resumes only fresh lists, once.
  {
    const dataRoot = fs.mkdtempSync(path.join(root, 'resume-'))
    saveUpdateResume(dataRoot, ['a', 'b', 'a'])
    assert.deepEqual(takeUpdateResume(dataRoot), ['a', 'b'])
    assert.deepEqual(takeUpdateResume(dataRoot), [], 'the list is consumed')
    saveUpdateResume(dataRoot, ['late'])
    assert.deepEqual(takeUpdateResume(dataRoot, Date.now() + 16 * 60_000), [], 'a stale list is ignored')
    fs.writeFileSync(path.join(dataRoot, 'resume-after-update.json'), '{not json')
    assert.deepEqual(takeUpdateResume(dataRoot), [])
    console.log('OK: update resume lists are fresh, deduplicated, and single-use')
  }

  // Secret detection sees through invisible characters for every caller.
  {
    const token = 'ghp_' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8'
    assert.ok(containsLikelySecret(token.slice(0, 10) + '\u2060' + token.slice(10)))
    assert.ok(!containsLikelySecret('Resize client photos\u200B for the web'))
    console.log('OK: containsLikelySecret strips invisible characters before matching')
  }

  // Preview reads stay inside their folder and their file types.
  {
    const dir = fs.mkdtempSync(path.join(root, 'icons-'))
    const outside = fs.mkdtempSync(path.join(root, 'outside-'))
    fs.writeFileSync(path.join(dir, 'ok.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    fs.writeFileSync(path.join(outside, 'secret.png'), 'not yours')
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'text')
    fs.symlinkSync(path.join(outside, 'secret.png'), path.join(dir, 'planted.png'))
    assert.match(containedDataUrl(dir, path.join(dir, 'ok.png'), ICON_MIME_TYPES), /^data:image\/png;base64,/)
    assert.equal(containedDataUrl(dir, path.join(dir, 'planted.png'), ICON_MIME_TYPES), null, 'a planted symlink must not escape')
    assert.equal(containedDataUrl(dir, path.join(dir, '..', path.basename(outside), 'secret.png'), ICON_MIME_TYPES), null)
    assert.equal(containedDataUrl(dir, path.join(dir, 'notes.txt'), ICON_MIME_TYPES), null, 'unlisted types are never read')
    assert.equal(containedDataUrl(dir, 42, ICON_MIME_TYPES), null)
    console.log('OK: preview data URLs stay contained')
  }

  // Non-http(s) tool URLs are refused on save; deleting a design profile clears collection refs.
  {
    const dataRoot = fs.mkdtempSync(path.join(root, 'url-and-design-'))
    const library = new LibraryStore(dataRoot)
    assert.throws(() => tool(library, { name: 'BadFile', launchCommand: 'true', url: 'file:///etc/passwd' }), /http:\/\/ or https:\/\//)
    assert.throws(() => tool(library, { name: 'BadJs', launchCommand: 'true', url: 'javascript:alert(1)' }), /http:\/\/ or https:\/\//)
    const ok = tool(library, { name: 'GoodWeb', launchCommand: 'true', url: 'http://127.0.0.1:4123/' })
    assert.equal(ok.url, 'http://127.0.0.1:4123/')
    const col = library.saveCollection({ id: '', name: 'Branded', toolIds: [ok.id], designProfileId: 'prof-1', origin: 'user' })
    assert.equal(library.getCollection(col.id).designProfileId, 'prof-1')
    library.clearDesignProfile('prof-1')
    assert.equal(library.getCollection(col.id).designProfileId, undefined)
    console.log('OK: tool URLs require http(s) and deleted design profiles unlink from collections')
  }

  // Ordered stack teardown stops dependents in reverse order.
  {
    const dataRoot = fs.mkdtempSync(path.join(root, 'stack-stop-'))
    const library = new LibraryStore(dataRoot)
    const db = tool(library, { name: 'db', launchCommand: 'node db.js', port: 50011 })
    const api = tool(library, { name: 'api', launchCommand: 'node api.js', port: 50012 })
    const web = tool(library, { name: 'web', launchCommand: 'node web.js', port: 50013 })
    const col = library.saveCollection({ id: '', name: 'Ordered', toolIds: [db.id, api.id, web.id], stack: { ordered: true, steps: [] }, origin: 'user' })
    const stopped = []
    const processes = {
      async getState(id) { return { toolId: id, status: 'running' } },
      async stop(id) { stopped.push(id); return { toolId: id, status: 'stopped' } },
    }
    await stopCollection(col.id, { store: library, processes })
    assert.deepEqual(stopped, [web.id, api.id, db.id], 'ordered stacks must stop in reverse order')
    console.log('OK: ordered stacks stop in reverse dependency order')
  }

  // Reused PIDs (alive PID with mismatched processStartedAt) are closed as orphans.
  {
    const dataRoot = fs.mkdtempSync(path.join(root, 'pid-reuse-'))
    fs.writeFileSync(path.join(dataRoot, 'receipts.json'), JSON.stringify({
      version: 1,
      receipts: [{
        id: 'reused-1',
        toolId: 't-reuse',
        toolName: 'Reused',
        launchCommand: 'node app.js',
        pid: process.pid,
        processStartedAt: 'Thu Jan  1 00:00:00 1970',
        startedAt: new Date(Date.now() - 5_000).toISOString(),
        outcome: 'running',
        message: 'Running · port 5100',
      }],
    }))
    const receipts = new ReceiptStore(dataRoot)
    const row = receipts.list().find((r) => r.id === 'reused-1')
    assert.equal(row.outcome, 'interrupted', 'receipt with mismatched processStartedAt must close even if PID is alive')
    console.log('OK: PID reuse closes stale receipts instead of keeping them running forever')
  }

  // findFreePort honors exclude set for preferred and scanned ports.
  {
    const res = await findFreePort({ preferred: 46100, from: 46100, to: 46110, count: 2, exclude: [46100, 46101] })
    assert.equal(res.preferredFree, false)
    assert.ok(!res.candidates.includes(46100) && !res.candidates.includes(46101), 'excluded ports must be skipped')
    console.log('OK: findFreePort excludes reserved library/companion ports')
  }

  // CapabilityGapStore.update({ refuseIfClosed: true }) enforces user decisions inside the lock.
  {
    const dataRoot = fs.mkdtempSync(path.join(root, 'gaps-'))
    const gaps = new CapabilityGapStore(dataRoot)
    const { gap } = gaps.record({ task: 'OCR PDFs', reason: 'No local OCR tool', capabilities: ['pdf-ocr'] })
    gaps.updateStatus(gap.id, 'resolved')
    assert.throws(() => gaps.update(gap.id, { status: 'planned', refuseIfClosed: true }), /resolved/)
    console.log('OK: CapabilityGapStore enforces closed-gap refusal inside the file lock')
  }

  // sanitizeBackendSetCookies blocks grant cookie tossing and strips loopback Domains.
  {
    const cleaned = sanitizeBackendSetCookies([
      `${PREVIEW_COOKIE}_deadbeef=evil; Path=/`,
      `${PREVIEW_COOKIE}=evil; Path=/`,
      'sid=ok123; Domain=127.0.0.1; Path=/; HttpOnly',
      'prefs=dark; Domain=localhost; Path=/',
      'foreign=keep; Domain=other.example; Path=/',
    ])
    assert.deepEqual(cleaned, [
      'sid=ok123; Path=/; HttpOnly',
      'prefs=dark; Path=/',
      'foreign=keep; Domain=other.example; Path=/',
    ])
    console.log('OK: sanitizeBackendSetCookies blocks shelf_preview* tossing and strips loopback domains')
  }

  // PreviewProxy: avoids target/reserved ports, proxies IPv6-only (::1) backends, rewrites Origin/Referer, strips shelf_preview* Set-Cookie.
  const ifaces = listCompanionInterfaces()
  if (ifaces.length > 0) {
    const bindAddress = ifaces[0].address
    const dataRoot = fs.mkdtempSync(path.join(root, 'proxy-v6-'))
    const cert = ensureCompanionCertificate(dataRoot, [bindAddress])
    let seenHeaders = null
    const v6Backend = http.createServer((req, res) => {
      seenHeaders = req.headers
      res.writeHead(200, {
        'content-type': 'text/plain',
        'set-cookie': [
          `${previewCookieName('other-tool')}=clobber; Path=/`,
          'app_sess=v6ok; Domain=localhost; Path=/',
        ],
      })
      res.end('ipv6-ok')
    })
    await new Promise((resolve) => v6Backend.listen(0, '::1', resolve))
    const v6Port = v6Backend.address().port
    const proxy = new PreviewProxy({
      bindAddress,
      tls: { key: cert.key, cert: cert.cert },
      basePort: v6Port, // intentionally equal to target.port to verify exclusion
      reservedPorts: () => [v6Port + 1],
    })
    try {
      const origin = await proxy.ensure({ toolId: 'v6-tool', port: v6Port, backend: 'http' })
      const listenPort = proxy.listenPort('v6-tool')
      assert.notEqual(listenPort, v6Port, 'proxy must never bind the tool port itself')
      assert.notEqual(listenPort, v6Port + 1, 'proxy must skip reservedPorts')
      const ticket = proxy.issueTicket('v6-tool', 'dev-1')
      const grantRes = await new Promise((resolve, reject) => {
        https.get(ticket.url, { rejectUnauthorized: false }, (res) => {
          res.resume()
          resolve(res)
        }).on('error', reject)
      })
      const grantCookie = (grantRes.headers['set-cookie'] || [])[0].split(';')[0]
      const proxied = await new Promise((resolve, reject) => {
        https.get(`${origin}/check`, {
          rejectUnauthorized: false,
          headers: { cookie: grantCookie, origin, referer: `${origin}/page` },
        }, (res) => {
          let body = ''
          res.setEncoding('utf8')
          res.on('data', (chunk) => { body += chunk })
          res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }))
        }).on('error', reject)
      })
      assert.equal(proxied.status, 200)
      assert.equal(proxied.body, 'ipv6-ok')
      assert.equal(seenHeaders.origin, `http://[::1]:${v6Port}`)
      assert.equal(seenHeaders.referer, `http://[::1]:${v6Port}/page`)
      const outCookies = proxied.headers['set-cookie'] || []
      assert.ok(!outCookies.some((c) => c.includes(PREVIEW_COOKIE)), 'backend must not inject shelf_preview* Set-Cookie')
      assert.ok(outCookies.some((c) => c.startsWith('app_sess=v6ok') && !/Domain=/i.test(c)), 'loopback Domain must be stripped')
      console.log('OK: PreviewProxy handles IPv6-only backends, port exclusions, Origin/Referer, and cookie sanitization')
    } finally {
      await proxy.releaseAll()
      await new Promise((resolve) => v6Backend.close(resolve))
    }

    // CompanionServer: malformed percent-encoding returns 400 (not 500) and heartbeat drops dead clients.
    const devices = new CompanionDeviceStore(dataRoot)
    const token = mintDeviceToken()
    devices.create('Phone', token)
    let clientCounts = []
    const server = new CompanionServer({
      host: {
        appVersion: '2.4.4',
        listTools: () => [],
        listCollections: () => [],
        getStates: async () => [],
        peekStates: () => [],
        health: async () => [],
        board: () => [],
        start: async () => ({ toolId: '', status: 'stopped' }),
        stop: async () => ({ toolId: '', status: 'stopped' }),
        restart: async () => ({ toolId: '', status: 'stopped' }),
        logs: () => [],
        errorReport: async () => null,
        receipts: () => [],
        startCollection: async () => ({ collectionId: '', name: '', results: [] }),
        stopCollection: async () => ({ collectionId: '', name: '', results: [] }),
        keepAwakeActive: () => false,
        toolIcon: () => null,
        previewReady: () => false,
        previewGrant: async () => { throw new Error('off') },
        listDrafts: () => [],
        acceptDraft: async () => ({ outcome: 'saved', message: 'ok' }),
        rejectDraft: () => ({ outcome: 'rejected', message: 'ok' }),
      },
      devices,
      tls: { key: cert.key, cert: cert.cert, fingerprint: cert.fingerprint },
      heartbeatIntervalMs: 80,
      onClientsChanged: (count) => clientCounts.push(count),
    })
    const info = await server.listen(bindAddress, 0)
    try {
      const bad = await new Promise((resolve, reject) => {
        https.get(`${info.url}/api/tools/%E0%A4%A/logs`, {
          rejectUnauthorized: false,
          headers: { authorization: `Bearer ${token}` },
        }, (res) => {
          res.resume()
          resolve(res.statusCode)
        }).on('error', reject)
      })
      assert.equal(bad, 400, 'malformed percent-encoding must return 400, not 500')

      // Simulate a suspended mobile socket that stops answering pings.
      const ws = new WebSocket(`wss://${info.address}:${info.port}/ws`, [COMPANION_WS_PROTOCOL, token], { rejectUnauthorized: false })
      await new Promise((resolve, reject) => {
        ws.once('open', resolve)
        ws.once('error', reject)
      })
      // Pause the underlying socket so ws never replies with pong frames.
      ws._socket.pause()
      await new Promise((resolve) => setTimeout(resolve, 350))
      assert.equal(server.clientCount, 0, 'heartbeat sweep must terminate unresponsive mobile sockets')
      assert.ok(clientCounts.includes(1) && clientCounts[clientCounts.length - 1] === 0)
      console.log('OK: CompanionServer returns 400 on bad encoding and drops silent dead WebSockets via heartbeat')
    } finally {
      await server.close()
    }
  }

  // v2.5: missing env diagnostics (`env_missing` -> `edit_env`) & detail extraction.
  {
    const c1 = classifyLaunchFailure([
      { id: '1', toolId: 't', stream: 'stderr', text: 'Error: Missing required environment variable: STRIPE_API_KEY', at: new Date().toISOString() },
    ])
    assert.equal(c1.code, 'env_missing')
    assert.equal(c1.detail, 'STRIPE_API_KEY')
    assert.equal(remedyFor(c1.code), 'edit_env')

    const c2 = classifyLaunchFailure([
      { id: '2', toolId: 't', stream: 'stderr', text: "KeyError: 'DATABASE_URL'", at: new Date().toISOString() },
    ])
    assert.equal(c2.code, 'env_missing')
    assert.equal(c2.detail, 'DATABASE_URL')
    console.log('OK: classifyLaunchFailure detects missing env vars with key detail and edit_env remedy')
  }

  // v2.5: opt-in autoRestart persistence, transient crash backoff, non-transient skip, and stop cancellation.
  {
    const autoRoot = fs.mkdtempSync(path.join(root, 'auto-restart-'))
    const store = new LibraryStore(autoRoot)
    const transient = store.save({
      id: 'auto-crash',
      name: 'Auto Crash',
      launchCommand: 'node -e "setTimeout(() => process.exit(1), 25)"',
      tags: [],
      autoRestart: true,
    })
    assert.equal(store.get(transient.id)?.autoRestart, true)
    const disabled = store.save({
      id: 'auto-off',
      name: 'Auto Off',
      launchCommand: 'echo hi',
      tags: [],
      autoRestart: false,
    })
    assert.equal(store.get(disabled.id)?.autoRestart, undefined)

    const envCrash = store.save({
      id: 'auto-env',
      name: 'Auto Env Crash',
      launchCommand: 'node -e "console.error(\'Missing required environment variable: SECRET_TOKEN\'); process.exit(1)"',
      tags: [],
      autoRestart: true,
    })

    const states = []
    const pm = new ProcessManager(store, {
      autoRestartDelaysMs: [40, 60],
      onEvent: (ch, payload) => {
        if (ch === 'process:update') states.push(payload)
      },
    })
    try {
      // Transient crash retries twice then settles in error state with exhausted message.
      await pm.start(transient.id, { openUrlWhenReady: false })
      for (let i = 0; i < 60; i++) {
        const cur = pm.peekState(transient.id)
        if (cur.status === 'error' && cur.message?.includes('Auto-restart gave up')) break
        await new Promise((r) => setTimeout(r, 40))
      }
      const finalTransient = pm.peekState(transient.id)
      assert.equal(finalTransient.status, 'error', `expected exhausted error state, got ${JSON.stringify(finalTransient)}`)
      assert.match(finalTransient.message || '', /Auto-restart gave up after 2 attempts/)
      const attemptsSeen = states
        .filter((s) => s.toolId === transient.id && s.autoRestartAttempts)
        .map((s) => s.autoRestartAttempts)
      assert.deepEqual(attemptsSeen, [1, 2], 'auto-restart should attempt 1 then 2 before giving up')

      // Deterministic missing-env failure must skip auto-restart immediately and report detail.
      await pm.start(envCrash.id, { openUrlWhenReady: false })
      for (let i = 0; i < 40; i++) {
        if (pm.peekState(envCrash.id).status === 'error') break
        await new Promise((r) => setTimeout(r, 30))
      }
      const finalEnv = pm.peekState(envCrash.id)
      assert.equal(finalEnv.status, 'error')
      assert.equal(finalEnv.code, 'env_missing')
      assert.equal(finalEnv.remedy, 'edit_env')
      assert.equal(finalEnv.detail, 'SECRET_TOKEN')
      assert.equal(
        states.some((s) => s.toolId === envCrash.id && s.autoRestartAttempts),
        false,
        'non-transient env_missing failure must not trigger auto-restart loop',
      )
      console.log('OK: opt-in autoRestart retries transient crashes with backoff and skips non-transient env errors')
    } finally {
      await pm.stopAll('smoke cleanup')
    }
  }

  console.log('OK: audit fixes smoke passed')
} finally {
  fs.rmSync(root, { recursive: true, force: true })
}
