/**
 * Smoke 0.8 launch hardening + Collection Power Mode + provenance:
 * - concurrent start() of the same tool coalesces (no double spawn, 1 receipt)
 * - receipts/states carry structured startedBy/origin (incl. adoption)
 * - startCollection/stopCollection launch and stop stacks safely
 * - stack launch surfaces port_in_use per tool (fail) and heals it (reassign)
 * Requires: tsc -p tsconfig.electron.json (smoke:all compile step).
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const require = createRequire(import.meta.url)

const { LibraryStore } = require('../dist-electron/shared/library-store')
const { ProcessManager } = require('../dist-electron/shared/process-manager')
const { ReceiptStore } = require('../dist-electron/shared/receipt-store')
const {
  startCollection,
  stopCollection,
} = require('../dist-electron/shared/collection-launch')
const { findPortOccupant, killPortOccupant } = require('../dist-electron/shared/ports')

const fixture = path.join(root, 'fixtures/sample-tool')
const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'shelf-stack-'))
const now = new Date().toISOString()
const portA = 8771
const portB = 8772
const portC = 8773

const store = new LibraryStore(dataRoot)
const receipts = new ReceiptStore(dataRoot)
const agent = new ProcessManager(store, {
  receipts,
  defaultOrigin: () => ({ kind: 'mcp', client: 'claude-code' }),
})
const gui = new ProcessManager(store, {
  receipts: new ReceiptStore(dataRoot),
  defaultOrigin: () => ({ kind: 'gui' }),
})

function saveFixtureTool(id, name, port) {
  return store.save({
    id,
    name,
    tags: ['Fixtures'],
    favorite: false,
    projectPath: fixture,
    launchCommand: `PORT=${port} node server.mjs`,
    url: `http://127.0.0.1:${port}`,
    port,
    createdAt: now,
    updatedAt: now,
  })
}

const toolA = saveFixtureTool(`smoke-stack-a-${Date.now()}`, 'Stack A', portA)
const toolB = saveFixtureTool(`smoke-stack-b-${Date.now()}`, 'Stack B', portB)
const toolC = saveFixtureTool(`smoke-stack-c-${Date.now()}`, 'Stack C', portC)

let unrelated = null

async function waitForFreePort(port) {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    if (!(await findPortOccupant(port))) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`Port ${port} did not become free`)
}

try {
  // 1. Same-tool double start coalesces onto one launch.
  const [s1, s2] = await Promise.all([agent.start(toolA.id), agent.start(toolA.id)])
  assert.equal(s1.status, 'running')
  assert.equal(s2.status, 'running')
  assert.equal(s1.pid, s2.pid, 'both callers must observe the same process')
  const runReceipts = receipts.list({ toolId: toolA.id })
  assert.equal(runReceipts.length, 1, 'coalesced launch must open exactly one receipt')
  console.log('OK: concurrent same-tool starts coalesced (one spawn, one receipt)')

  // 2. Provenance: structured startedBy/origin on state + receipt, and on adoption.
  assert.equal(s1.origin, 'local')
  assert.equal(s1.port, portA)
  assert.deepEqual(s1.startedBy, { kind: 'mcp', client: 'claude-code' })
  assert.deepEqual(runReceipts[0].startedBy, { kind: 'mcp', client: 'claude-code' })
  const adopted = await gui.getState(toolA.id)
  assert.equal(adopted.status, 'running')
  assert.equal(adopted.origin, 'external')
  assert.deepEqual(
    adopted.startedBy,
    { kind: 'mcp', client: 'claude-code' },
    'adoption must carry provenance from the shared receipt',
  )
  await agent.stop(toolA.id)
  await waitForFreePort(portA)
  console.log('OK: provenance recorded locally and carried through adoption')

  // 3. Stack start/stop over a collection.
  const collection = store.saveCollection({
    id: `smoke-stack-${Date.now()}`,
    name: 'Smoke Stack',
    toolIds: [toolA.id, toolB.id],
    createdAt: now,
    updatedAt: now,
  })
  const started = await startCollection(collection.id, { store, processes: gui })
  assert.deepEqual(
    started.results.map((r) => r.outcome).sort(),
    ['started', 'started'],
  )
  assert.ok(await findPortOccupant(portA))
  assert.ok(await findPortOccupant(portB))

  const again = await startCollection(collection.id, { store, processes: gui })
  assert.deepEqual(
    again.results.map((r) => r.outcome).sort(),
    ['already_running', 'already_running'],
  )

  const stopped = await stopCollection(collection.id, { store, processes: gui })
  assert.deepEqual(stopped.results.map((r) => r.outcome).sort(), ['stopped', 'stopped'])
  await waitForFreePort(portA)
  await waitForFreePort(portB)
  console.log('OK: stack start/skip/stop over the collection')

  // 4. Busy member port: fail policy reports port_in_use; reassign heals it.
  unrelated = spawn('/bin/zsh', ['-lc', `PORT=${portC} node server.mjs`], {
    cwd: fixture,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const deadline = Date.now() + 15_000
  while (!(await findPortOccupant(portC))) {
    if (Date.now() > deadline) throw new Error(`Port ${portC} never occupied`)
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  const conflictCollection = store.saveCollection({
    id: `smoke-stack-conflict-${Date.now()}`,
    name: 'Conflict Stack',
    toolIds: [toolC.id],
    createdAt: now,
    updatedAt: now,
  })
  const refused = await startCollection(conflictCollection.id, { store, processes: gui })
  assert.equal(refused.results[0].outcome, 'failed')
  assert.equal(refused.results[0].state?.code, 'port_in_use')

  const healed = await startCollection(
    conflictCollection.id,
    { store, processes: gui },
    { onPortConflict: 'reassign' },
  )
  assert.equal(healed.results[0].outcome, 'started')
  const reassigned = store.get(toolC.id)
  assert.notEqual(reassigned.port, portC, 'reassign must persist the new port')
  assert.equal(healed.results[0].state?.port, reassigned.port)
  await stopCollection(conflictCollection.id, { store, processes: gui })
  console.log('OK: stack surfaces port_in_use (fail) and heals it (reassign)')
} finally {
  await gui.stopAll('Smoke cleanup.')
  await agent.stopAll('Smoke cleanup.')
  if (unrelated?.pid) {
    try {
      process.kill(-unrelated.pid, 'SIGKILL')
    } catch {
      // already exited
    }
  }
  for (const port of [portA, portB, portC]) {
    const leftover = await findPortOccupant(port)
    if (leftover) await killPortOccupant(port, { graceMs: 100 })
  }
  fs.rmSync(dataRoot, { recursive: true, force: true })
}

console.log('OK: stack/provenance smoke passed')
