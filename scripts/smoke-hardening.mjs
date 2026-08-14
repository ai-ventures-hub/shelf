/**
 * 1.1.1 security-hardening smoke: env-value redaction, chunk-split log
 * masking, error-report masking, stop-failure-still-kills, delete pruning.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const require = createRequire(import.meta.url)

const { LibraryStore } = require('../dist-electron/shared/library-store')
const { ProcessManager } = require('../dist-electron/shared/process-manager')
const { ProcessRuntimeSupport } = require('../dist-electron/shared/process-runtime-support')
const { ReceiptStore } = require('../dist-electron/shared/receipt-store')
const { buildErrorReport } = require('../dist-electron/shared/launch-diagnostics')
const { sanitizeToolForOutput } = require('../dist-electron/shared/types')
const { findPortOccupant } = require('../dist-electron/shared/ports')

// --- Env values: ALL masked for agent output, keys preserved ---
const sanitized = sanitizeToolForOutput({
  id: 't',
  name: 'T',
  tags: [],
  capabilities: [],
  agentAccess: [],
  favorite: false,
  launchCommand: 'true',
  createdAt: 'x',
  updatedAt: 'x',
  env: {
    DATABASE_URL: 'postgres://user:hunter2@host/db',
    PORT: '3000',
    MY_API_KEY: 'abc123',
  },
})
assert.deepEqual(
  sanitized.env,
  { DATABASE_URL: '***', PORT: '***', MY_API_KEY: '***' },
  'every env value is masked — a key-name allowlist missed DATABASE_URL',
)
console.log('OK: env values fully masked for agents')

// --- Inline secrets in adjacent fields mask too (audit-round finding) ---
const cmdSanitized = sanitizeToolForOutput({
  id: 't2',
  name: 'T2',
  tags: [],
  capabilities: [],
  agentAccess: [],
  favorite: false,
  launchCommand: 'API_KEY=abc123 DATABASE_URL=postgres://u:hunter2@h/db PORT=3000 npm start',
  stopCommand: 'TOKEN=tok456 ./stop.sh',
  notes: 'Remember DATABASE_URL=postgres://u:hunter2@h/db and PORT=3000 here.',
  createdAt: 'x',
  updatedAt: 'x',
})
assert.equal(
  cmdSanitized.launchCommand,
  'API_KEY=*** DATABASE_URL=*** PORT=3000 npm start',
  'command env-prefix masks, benign PORT survives, command itself intact',
)
assert.equal(cmdSanitized.stopCommand, 'TOKEN=*** ./stop.sh')
assert.ok(!cmdSanitized.notes.includes('hunter2'), 'notes assignments masked')
assert.ok(cmdSanitized.notes.includes('PORT=3000'), 'benign keys survive in notes')
const flagSanitized = sanitizeToolForOutput({
  id: 't3',
  name: 'T3',
  tags: [],
  capabilities: [],
  agentAccess: [],
  favorite: false,
  launchCommand: 'node server.mjs --config=./app.json',
  createdAt: 'x',
  updatedAt: 'x',
})
assert.equal(
  flagSanitized.launchCommand,
  'node server.mjs --config=./app.json',
  'flags after the command word are never masked',
)
console.log('OK: adjacent-field masking (commands, notes)')

// --- Chunk-split masking: partial lines held until the newline arrives ---
const rt = new ProcessRuntimeSupport()
rt.appendLog('t1', 'stdout', 'prefix API_K')
rt.appendLog('t1', 'stdout', 'EY=supersecret123 suffix\nplain line\n')
let texts = rt.getLogs('t1').map((l) => l.text)
assert.ok(
  texts.some((t) => t.includes('API_KEY=***')),
  'reassembled line is masked',
)
assert.ok(!texts.join('\n').includes('supersecret123'), 'split secret never leaks')
assert.ok(texts.includes('plain line'))

rt.appendLog('t1', 'stdout', 'held partial without newline')
assert.ok(
  !rt.getLogs('t1').some((l) => l.text.includes('held partial')),
  'partial line is not committed early',
)
rt.flushLogs('t1')
assert.ok(
  rt.getLogs('t1').some((l) => l.text === 'held partial without newline'),
  'flush commits the residue',
)
rt.appendLog('t1', 'system', 'system message, no newline')
assert.ok(
  rt.getLogs('t1').some((l) => l.text === 'system message, no newline'),
  'system messages commit immediately (authored line-complete)',
)
rt.forget('t1')
assert.equal(rt.getLogs('t1').length, 0, 'forget clears logs')
assert.equal(rt.listKnownStates().length, 0, 'forget clears states')
console.log('OK: chunk-split masking, flush, forget')

// --- Error report masks the launch command ---
const report = buildErrorReport(
  { name: 'X', launchCommand: 'API_KEY=abc123 npm start', port: 1 },
  { status: 'error', message: 'boom' },
  [],
)
assert.ok(report.includes('API_KEY=***'), 'report masks inline env assignment')
assert.ok(!report.includes('abc123'), 'secret value absent from report')
console.log('OK: error report masks launch command')

// --- A failing stopCommand no longer aborts the kill ---
const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'shelf-hardening-'))
const fixture = path.join(root, 'fixtures/sample-tool')
const port = 8771
const now = new Date().toISOString()
const store = new LibraryStore(dataRoot)
const manager = new ProcessManager(store, { receipts: new ReceiptStore(dataRoot) })
const tool = store.save({
  id: `smoke-hardening-${Date.now()}`,
  name: 'Hardening Smoke',
  tags: [],
  favorite: false,
  projectPath: fixture,
  launchCommand: `PORT=${port} node server.mjs`,
  stopCommand: 'exit 1', // always fails — must not prevent termination
  url: `http://127.0.0.1:${port}`,
  port,
  createdAt: now,
  updatedAt: now,
})

try {
  const started = await manager.start(tool.id)
  assert.equal(started.status, 'running', `tool started (${started.message})`)

  const stopped = await manager.stop(tool.id)
  assert.equal(
    stopped.status,
    'stopped',
    `stop succeeds despite failing stopCommand (${stopped.message})`,
  )
  const deadline = Date.now() + 5_000
  while ((await findPortOccupant(port)) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 100))
  }
  assert.equal(await findPortOccupant(port), null, 'child is actually dead')
  assert.ok(
    manager
      .getLogs(tool.id)
      .some((l) => l.text.includes('Stop command failed (continuing to terminate)')),
    'failure is logged, not swallowed',
  )

  // Delete pruning: after stop + delete + forget, no ghost state remains.
  store.delete(tool.id)
  manager.forget(tool.id)
  const states = await manager.getStates()
  assert.ok(
    !states.some((s) => s.toolId === tool.id),
    'deleted tool leaves no ghost runtime state',
  )
  console.log('OK: failing stopCommand still kills; delete leaves no ghost state')

  // A NEVER-STARTED tool whose stopCommand fails yields the dedicated code
  // (audit-round finding: delete flows treat it as safe-to-remove).
  const idle = store.save({
    id: `smoke-idle-${Date.now()}`,
    name: 'Idle Broken Stop',
    tags: [],
    favorite: false,
    launchCommand: 'true',
    stopCommand: 'exit 1',
    createdAt: now,
    updatedAt: now,
  })
  const idleStop = await manager.stop(idle.id)
  assert.equal(idleStop.status, 'error')
  assert.equal(
    idleStop.code,
    'stop_command_failed',
    'idle tool with failing stopCommand reports the deletable error code',
  )
  store.delete(idle.id)
  manager.forget(idle.id)
  console.log('OK: idle failing-stopCommand tool is distinguishable (deletable)')
} finally {
  await manager.stopAll('all').catch(() => {})
  fs.rmSync(dataRoot, { recursive: true, force: true })
}

console.log('OK: hardening smoke passed')
