/**
 * Smoke cross-process adoption without ever taking ownership of an unrelated
 * listener. Also covers clean one-shot completion and forced-stop escalation.
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
  findPortOccupant,
  killPortOccupant,
} = require('../dist-electron/shared/ports')
const { terminateProcess } = require('../dist-electron/shared/process-lifecycle')

const fixture = path.join(root, 'fixtures/sample-tool')
const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'shelf-adopt-'))
const port = 8767
const now = new Date().toISOString()
const store = new LibraryStore(dataRoot)
const owner = new ProcessManager(store, { receipts: new ReceiptStore(dataRoot) })
const outsider = new ProcessManager(store, { receipts: new ReceiptStore(dataRoot) })

const tool = store.save({
  id: `smoke-adopt-${Date.now()}`,
  name: 'Adopt Smoke',
  description: 'Verified cross-process adoption smoke',
  tags: ['Fixtures'],
  favorite: false,
  projectPath: fixture,
  launchCommand: `PORT=${port} node server.mjs`,
  url: `http://127.0.0.1:${port}`,
  port,
  createdAt: now,
  updatedAt: now,
})

let unrelated = null
let stubborn = null

async function waitForPort(expectedOccupied) {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    const occupied = Boolean(await findPortOccupant(port))
    if (occupied === expectedOccupied) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`Port ${port} did not become ${expectedOccupied ? 'occupied' : 'free'}`)
}

try {
  // A random listener must never be adopted or killed merely because its port matches.
  unrelated = spawn('/bin/zsh', ['-lc', tool.launchCommand], {
    cwd: fixture,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  await waitForPort(true)

  const unrelatedState = await outsider.getState(tool.id)
  assert.equal(unrelatedState.status, 'stopped')

  const refusedStart = await outsider.start(tool.id)
  assert.equal(refusedStart.status, 'error')
  assert.match(refusedStart.message || '', /already in use/)

  const refusedStop = await outsider.stop(tool.id)
  assert.equal(refusedStop.status, 'error')
  assert.match(refusedStop.message || '', /did not launch/)
  assert.ok(await findPortOccupant(port), 'unrelated listener should still be running')
  console.log('OK: unrelated port owner was neither adopted nor stopped')

  if (unrelated.pid) process.kill(-unrelated.pid, 'SIGKILL')
  unrelated = null
  await waitForPort(false)

  // A launch with a shared active receipt is safe for another manager to adopt.
  const started = await owner.start(tool.id)
  assert.equal(started.status, 'running')

  const adopted = await outsider.getState(tool.id)
  assert.equal(adopted.status, 'running')
  assert.match(adopted.message || '', /external/)

  const stopped = await outsider.stop(tool.id)
  assert.equal(stopped.status, 'stopped')
  await waitForPort(false)
  console.log('OK: verified Shelf process was adopted and stopped')

  // Browser-open failures must not turn a healthy child into an untracked orphan.
  const urlFailOwner = new ProcessManager(store, {
    receipts: new ReceiptStore(dataRoot),
    onReadyUrl: async () => {
      throw new Error('simulated browser failure')
    },
  })
  const runningAfterUrlFailure = await urlFailOwner.start(tool.id)
  assert.equal(runningAfterUrlFailure.status, 'running')
  assert.ok(
    urlFailOwner
      .getLogs(tool.id)
      .some((line) => line.text.includes('URL could not be opened')),
  )
  await urlFailOwner.stop(tool.id)
  await waitForPort(false)
  console.log('OK: URL-open failure left the process managed and stoppable')

  // One-shot commands that complete successfully must settle as stopped, never running/error.
  const oneShot = store.save({
    ...tool,
    id: `smoke-oneshot-${Date.now()}`,
    name: 'One-shot Smoke',
    launchCommand: `node -e "process.exit(0)"`,
    port: undefined,
    url: undefined,
  })
  const oneShotState = await owner.start(oneShot.id)
  assert.equal(oneShotState.status, 'stopped')
  assert.match(oneShotState.message || '', /cleanly/)
  console.log('OK: clean one-shot exit reported stopped')

  const earlyExitServer = store.save({
    ...tool,
    id: `smoke-early-exit-${Date.now()}`,
    name: 'Early-exit Server Smoke',
    launchCommand: `node -e "process.exit(0)"`,
    port: 8768,
    url: 'http://127.0.0.1:8768',
  })
  const earlyExitState = await owner.start(earlyExitServer.id)
  assert.equal(earlyExitState.status, 'error')
  assert.match(earlyExitState.message || '', /before port 8768 became ready/)
  console.log('OK: server exit before readiness reported error')

  // A process that ignores SIGTERM must be escalated and actually exit.
  stubborn = spawn(
    process.execPath,
    ['-e', "process.on('SIGTERM',()=>{}); setInterval(()=>{},1000)"],
    { detached: true, stdio: 'ignore' },
  )
  await new Promise((resolve) => setTimeout(resolve, 150))
  await terminateProcess({ child: stubborn, pgid: stubborn.pid })
  assert.ok(stubborn.exitCode !== null || stubborn.signalCode)
  console.log('OK: stubborn process escalated to SIGKILL')
} finally {
  await owner.stopAll('Smoke cleanup failed.')
  if (unrelated?.pid) {
    try {
      process.kill(-unrelated.pid, 'SIGKILL')
    } catch {
      // already exited
    }
  }
  if (stubborn?.pid && stubborn.exitCode === null) {
    try {
      process.kill(-stubborn.pid, 'SIGKILL')
    } catch {
      // already exited
    }
  }
  const leftover = await findPortOccupant(port)
  if (leftover) await killPortOccupant(port, { graceMs: 100 })
  fs.rmSync(dataRoot, { recursive: true, force: true })
}

console.log('OK: adoption/lifecycle smoke passed')
