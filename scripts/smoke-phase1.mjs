/** Regressions from the September 2026 product audit. All data/processes are fixtures. */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import { spawn, fork } from 'node:child_process'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { LibraryStore } = require('../dist-electron/shared/library-store.js')
const { ReceiptStore } = require('../dist-electron/shared/receipt-store.js')
const { ProcessManager } = require('../dist-electron/shared/process-manager.js')
const { maskSecrets, sanitizeToolForOutput, sanitizeOutput } = require('../dist-electron/shared/types.js')
const { buildErrorReport } = require('../dist-electron/shared/launch-diagnostics.js')
const { connectCodexMcp, getCodexMcpStatus } = require('../dist-electron/shared/codex-mcp.js')
const { ProcessRuntimeSupport } = require('../dist-electron/shared/process-runtime-support.js')
const { terminateProcess } = require('../dist-electron/shared/process-lifecycle.js')
const { RunLogStore } = require('../dist-electron/shared/run-log-store.js')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shelf-phase1-'))
const store = new LibraryStore(root)
const receipts = new ReceiptStore(root)
const managers = []
const manager = () => { const m = new ProcessManager(store, { receipts }); managers.push(m); return m }
const quote = (s) => "'" + s.replaceAll("'", "'\\''") + "'"
const free = () => new Promise((resolve) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)) }) })
const tool = (id, code, port) => {
  const file = path.join(root, id + '.cjs'); fs.writeFileSync(file, code)
  return store.save({ id, name: id, tags: [], capabilities: [], agentAccess: [], favorite: false, projectPath: root, launchCommand: `${quote(process.execPath)} ${quote(file)}`, port, createdAt: '', updatedAt: '' })
}
try {
  const secret = 'synthetic-audit-password'
  const command = `DATABASE_URL="postgres://audit:${secret}@localhost/db with space" PORT=5210 node app.js`
  assert.ok(!maskSecrets(command).includes(secret))
  assert.ok(!maskSecrets(command).includes('with space'))
  assert.ok(maskSecrets(command).includes('PORT=5210'))
  assert.ok(!maskSecrets(`https://${secret}@github.com/org/repo`).includes(secret))
  const record = { ...tool('redaction', ''), launchCommand: command, env: { CUSTOM_AUTH: secret } }
  const runtime = new ProcessRuntimeSupport(undefined, receipts, () => [secret])
  runtime.appendLog(record.id, 'system', command)
  runtime.appendLog(record.id, 'stdout', secret.slice(0, 10))
  runtime.appendLog(record.id, 'stdout', secret.slice(10) + '\n')
  runtime.emitFailedReceipt({ toolId: record.id, toolName: record.name, launchCommand: command, message: secret })
  for (const output of [sanitizeToolForOutput(record), runtime.getLogs(record.id), receipts.list(), buildErrorReport(record, { status: 'error', message: secret }, [{ toolId: record.id, stream: 'stderr', text: secret, at: new Date().toISOString() }])]) {
    assert.ok(!JSON.stringify(output).includes(secret), 'synthetic secret must not cross an output boundary')
  }
  const cp = path.join(root, 'config.toml')
  const serverPath = path.resolve('dist-electron/shared/types.js')
  fs.writeFileSync(cp, '[unrelated]\nvalue="kept"\n', { mode: 0o600 })
  const connected = await connectCodexMcp({ configPath: cp, serverPath })
  assert.equal(fs.statSync(cp).mode & 0o777, 0o600)
  assert.equal(fs.statSync(connected.backupPath).mode & 0o777, 0o600)
  fs.writeFileSync(cp, `[mcp_servers.shelf]\ncommand="/nonexistent/audit-node"\nargs=[${JSON.stringify(serverPath)}]\nenabled=false\n`)
  const disabled = await getCodexMcpStatus({ configPath: cp, serverPath, nodeCommand: process.execPath })
  assert.equal(disabled.matches, false, 'disabled/broken config must not qualify as usable')
  assert.deepEqual(sanitizeOutput({ toolId: 'fixture', status: 'error', message: 'credential error' }, ['fixture', 'error']), { toolId: 'fixture', status: 'error', message: 'credential ***' })
  const unavailable = new ProcessRuntimeSupport(undefined, undefined, () => [], { currentRun() { return undefined }, append() { throw new Error('disk full') }, read() { return [] } })
  unavailable.appendLog('unavailable', 'system', 'Locally retained evidence')
  assert.ok(unavailable.getLogs('unavailable').some((line) => line.text === 'Locally retained evidence'))
  assert.ok(unavailable.getLogs('unavailable').some((line) => line.text.includes('unavailable')))
  console.log('OK: output redaction and private configuration writes')

  const latest = tool('edits', '')
  const newer = store.save({ ...latest, description: 'newer human edit' })
  assert.throws(() => store.save({ ...latest, port: 51230 }), /changed/)
  store.patch(newer.id, { port: 51230 })
  assert.equal(store.get(newer.id).description, 'newer human edit')
  console.log('OK: stale full saves fail and field patches preserve concurrent edits')

  const p = await free()
  tool('concurrent', `require('node:http').createServer((q,s)=>s.end('audit')).listen(process.env.PORT || ${p},'127.0.0.1',()=>console.log('fixture ready'));`, p)
  const a = manager(), b = manager()
  const states = await Promise.all([a.start('concurrent'), b.start('concurrent', { onPortConflict: 'reassign' })])
  assert.equal(states[0].status, 'running'); assert.equal(states[1].status, 'running')
  assert.equal(states[0].pid, states[1].pid)
  assert.equal(receipts.list({ toolId: 'concurrent' }).length, 1)
  assert.ok(b.getLogs('concurrent').some((line) => line.text.includes('fixture ready')), 'other host can read launch output')
  assert.ok(b.getLogs('concurrent').every((line) => line.runId), 'logs belong to a durable run')
  await b.stop('concurrent')
  assert.equal((await a.getState('concurrent')).status, 'stopped')
  console.log('OK: independent managers share one run, its logs, and stop outcome')
  const retryRun = await a.start('concurrent')
  const originalKill = process.kill
  process.kill = (pid, signal) => {
    if (pid === -retryRun.pid && signal === 'SIGTERM') { const err = new Error('injected signal refusal'); err.code = 'EPERM'; throw err }
    return originalKill.call(process, pid, signal)
  }
  try {
    const failedStop = await a.stop('concurrent')
    assert.equal(failedStop.status, 'error'); assert.equal(failedStop.pid, retryRun.pid)
    assert.ok(receipts.findActiveProcess('concurrent'), 'failed Stop must retain ownership for retry')
  } finally { process.kill = originalKill }
  assert.equal((await a.stop('concurrent')).status, 'stopped')
  console.log('OK: refused termination stays visible and a later Stop can retry')


  const wp = await free()
  tool('worker-race', `require('node:http').createServer((q,s)=>s.end('audit')).listen(${wp},'127.0.0.1')`, wp)
  const workerFile = path.join(root, 'manager-worker.cjs')
  const sharedRoot = path.resolve('dist-electron/shared')
  fs.writeFileSync(workerFile, `const {LibraryStore}=require(${JSON.stringify(path.join(sharedRoot, 'library-store.js'))});const {ReceiptStore}=require(${JSON.stringify(path.join(sharedRoot, 'receipt-store.js'))});const {ProcessManager}=require(${JSON.stringify(path.join(sharedRoot, 'process-manager.js'))});const root=process.argv[2];const manager=new ProcessManager(new LibraryStore(root),{receipts:new ReceiptStore(root)});process.on('message',async()=>{try{process.send({state:await manager.start('worker-race',{onPortConflict:'reassign'})})}catch(e){process.send({error:e.message})}});process.send({ready:true});`)
  const workers = [fork(workerFile, [root], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] }), fork(workerFile, [root], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] })]
  const receive = (child) => new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { cleanup(); reject(new Error('worker timeout')) }, 15000)
    const done = (value) => { cleanup(); resolve(value) }
    const failed = (err) => { cleanup(); reject(err) }
    const cleanup = () => { clearTimeout(timeout); child.off('message', done); child.off('error', failed) }
    child.once('message', done); child.once('error', failed)
  })
  try {
    await Promise.all(workers.map(receive))
    const replies = workers.map(receive)
    workers.forEach((child) => child.send({ start: true }))
    const result = await Promise.all(replies)
    assert.ok(result.every((reply) => reply.state?.status === 'running'), JSON.stringify(result))
    assert.equal(result[0].state.pid, result[1].state.pid)
    assert.equal(receipts.list({ toolId: 'worker-race' }).length, 1)
    assert.equal((await b.stop('worker-race')).status, 'stopped')
  } finally { for (const worker of workers) worker.kill('SIGTERM') }
  console.log('OK: simultaneous starts from two OS processes create exactly one owned run')


  const sp = await free()
  tool('cancel', `setTimeout(()=>require('node:http').createServer((q,s)=>s.end('audit')).listen(${sp},'127.0.0.1'),500)`, sp)
  const c = manager()
  const starting = c.start('cancel')
  const stopped = await b.stop('cancel')
  await starting
  assert.equal(stopped.status, 'stopped')
  assert.equal((await c.getState('cancel')).status, 'stopped')
  assert.equal(receipts.findActiveProcess('cancel'), undefined)
  console.log('OK: cross-host Stop cancels an in-flight start')

  const fp = await free()
  tool('fake-ready', `console.log('Local: http://localhost:${fp}/');setInterval(()=>{},1000)`)
  const fake = await c.start('fake-ready')
  assert.notEqual(fake.status, 'running')
  assert.equal(store.get('fake-ready').port, undefined)
  console.log('OK: a printed URL is not service readiness')

  const orphanFile = path.join(root, 'descendant.pid')
  const descendantCode = `require('node:fs').writeFileSync(${JSON.stringify(orphanFile)}, String(process.pid));process.on('SIGTERM',()=>{});setInterval(()=>{},1000)`
  const leaderCode = `require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(descendantCode)}],{stdio:'ignore'});setTimeout(()=>process.exit(0),300)`
  const leader = spawn(process.execPath, ['-e', leaderCode], { detached: true, stdio: 'ignore' })
  await new Promise((resolve, reject) => { leader.once('exit', resolve); leader.once('error', reject) })
  const descendant = Number(fs.readFileSync(orphanFile, 'utf8'))
  try {
    process.kill(descendant, 0)
    await terminateProcess({ child: leader, pgid: leader.pid })
    assert.throws(() => process.kill(descendant, 0), { code: 'ESRCH' })
  } finally { try { process.kill(-leader.pid, 'SIGKILL') } catch {} }
  console.log('OK: Stop kills a surviving descendant even after its shell exits')

  const logStore = new RunLogStore(root)
  for (let run = 0; run < 7; run++) logStore.begin('bounded')
  logStore.append('bounded', Array.from({ length: 4000 }, (_, i) => ({ toolId: 'bounded', stream: 'stdout', at: new Date().toISOString(), text: String(i) + 'x'.repeat(1000) })))
  assert.ok(logStore.read('bounded').length <= 3000)
  assert.ok(logStore.read('bounded').at(-1).text.startsWith('3999'))
  const logFiles = fs.readdirSync(path.join(root, 'logs'), { recursive: true }).filter((name) => name.endsWith('.jsonl'))
  for (const file of logFiles) assert.ok(fs.statSync(path.join(root, 'logs', file)).size <= 2 * 1024 * 1024)
  assert.equal(logFiles.filter((file) => file.startsWith(require('node:crypto').createHash('sha256').update('bounded').digest('hex'))).length, 5)
  console.log('OK: noisy logs stay within byte, line, and retained-run limits')

} finally {
  for (const m of managers) await m.stopAll('fixture cleanup', { scope: 'local' })
  fs.rmSync(root, { recursive: true, force: true })
}
