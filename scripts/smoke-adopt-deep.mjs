/**
 * Deep cross-process adoption smoke — the field scenarios smoke-adopt.mjs
 * does not cover:
 *   1. adopt-on-start success (Launch clicked while another manager owns it)
 *   2. deep process tree: listener in a different pgid but same ancestry
 *   3. portless tools adopted via live receipt (no duplicate spawn)
 *   4. receipt/tool port mismatch falls back to ancestry-verified adoption
 *   5. a REAL separate OS process launches; this process adopts and stops
 *   6. stopAll scope 'local' leaves externally-launched tools running
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
const { findPortOccupant } = require('../dist-electron/shared/ports')
const { invalidateProcessSnapshot } = require('../dist-electron/shared/process-ownership')

const fixture = path.join(root, 'fixtures/sample-tool')
const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'shelf-adopt-deep-'))
const now = new Date().toISOString()
const store = new LibraryStore(dataRoot)
const receipts = new ReceiptStore(dataRoot)
const owner = new ProcessManager(store, { receipts: new ReceiptStore(dataRoot) })
const outsider = new ProcessManager(store, { receipts: new ReceiptStore(dataRoot) })

function saveTool(patch) {
  return store.save({
    name: 'Deep Adopt',
    description: 'smoke',
    tags: [],
    favorite: false,
    projectPath: fixture,
    createdAt: now,
    updatedAt: now,
    ...patch,
  })
}

async function waitForPort(port, expectedOccupied, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    invalidateProcessSnapshot()
    const occupied = Boolean(await findPortOccupant(port))
    if (occupied === expectedOccupied) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`Port ${port} did not become ${expectedOccupied ? 'occupied' : 'free'}`)
}

function newestReceipt(toolId) {
  return receipts.list({ toolId, limit: 100 })[0]
}

try {
  // —— 1 + 6: adopt-on-start success; local-scope stopAll leaves it running ——
  {
    const port = 8771
    const tool = saveTool({
      id: 'deep-adopt-basic',
      launchCommand: `PORT=${port} node server.mjs`,
      url: `http://127.0.0.1:${port}`,
      port,
    })
    const started = await owner.start(tool.id)
    assert.equal(started.status, 'running')

    invalidateProcessSnapshot()
    const adopted = await outsider.start(tool.id)
    assert.equal(adopted.status, 'running')
    assert.match(adopted.message || '', /external/)
    console.log('OK: adopt-on-start success —', adopted.message)

    // Quitting the outsider (GUI) must not stop the owner's tool.
    await outsider.stopAll('Shelf is quitting.', { scope: 'local' })
    assert.ok(await findPortOccupant(port), 'local-scope stopAll must leave external running')
    console.log('OK: stopAll scope=local left external tool running')

    // Cross-process stop still works and finalizes the owner receipt.
    const stopped = await outsider.stop(tool.id)
    assert.equal(stopped.status, 'stopped')
    await waitForPort(port, false)
    const receipt = newestReceipt(tool.id)
    assert.ok(receipt.endedAt, 'external stop must finalize the receipt')
    assert.equal(receipt.outcome, 'stopped')
    console.log('OK: external stop finalized receipt')
  }

  // —— 2: deep process tree (listener pgid ≠ receipt pid, but descendant) ——
  {
    const port = 8772
    const tool = saveTool({
      id: 'deep-adopt-tree',
      launchCommand: `PORT=${port} node wrapper.mjs`,
      url: `http://127.0.0.1:${port}`,
      port,
    })
    const started = await owner.start(tool.id)
    assert.equal(started.status, 'running')

    invalidateProcessSnapshot()
    const adopted = await outsider.start(tool.id)
    assert.equal(adopted.status, 'running', `deep tree adoption failed: ${adopted.message}`)
    assert.match(adopted.message || '', /external/)
    console.log('OK: deep-tree listener adopted via ancestry')

    const stopped = await outsider.stop(tool.id)
    assert.equal(stopped.status, 'stopped', `deep tree stop failed: ${stopped.message}`)
    await waitForPort(port, false)
    console.log('OK: deep-tree external stop freed the port')
  }

  // —— 3: portless tool — receipt-based adoption, no duplicate spawn ——
  {
    const tool = saveTool({
      id: 'deep-adopt-portless',
      launchCommand: `node -e "setInterval(() => {}, 1000)"`,
      projectPath: undefined,
      url: undefined,
      port: undefined,
    })
    const started = await owner.start(tool.id)
    assert.equal(started.status, 'running')

    const seen = await outsider.getState(tool.id)
    assert.equal(seen.status, 'running')
    assert.match(seen.message || '', /external/)
    console.log('OK: portless tool visible as Running (external) via receipt')

    const adopted = await outsider.start(tool.id)
    assert.match(adopted.message || '', /external/, 'portless start must adopt, not respawn')
    console.log('OK: portless start adopted instead of spawning a duplicate')

    const stopped = await outsider.stop(tool.id)
    assert.equal(stopped.status, 'stopped')
    const receipt = newestReceipt(tool.id)
    assert.ok(receipt.endedAt, 'portless external stop must finalize the receipt')
    console.log('OK: portless external stop finalized receipt')
  }

  // —— 4: receipt.port mismatch → ancestry-verified fallback adoption ——
  {
    const port = 8773
    // Silent listener: no ready line, so the owner's receipt keeps port unset.
    const tool = saveTool({
      id: 'deep-adopt-mismatch',
      launchCommand: `node -e "require('http').createServer((q, s) => s.end('ok')).listen(${port}, '127.0.0.1')"`,
      projectPath: undefined,
      url: undefined,
      port: undefined,
    })
    const started = await owner.start(tool.id)
    assert.equal(started.status, 'running')
    await waitForPort(port, true)
    assert.equal(newestReceipt(tool.id).port, undefined)

    // The user (or log sniffing) later sets the real port on the tool.
    store.save({ ...store.get(tool.id), port })

    invalidateProcessSnapshot()
    const adopted = await outsider.start(tool.id)
    assert.equal(adopted.status, 'running', `mismatch adoption failed: ${adopted.message}`)
    assert.match(adopted.message || '', /external/)
    assert.equal(newestReceipt(tool.id).port, port, 'adoption must heal the receipt port')
    console.log('OK: port-mismatch fallback adopted and healed receipt')

    await outsider.stop(tool.id)
    await waitForPort(port, false)
  }

  // —— 5: a real separate OS process launches; this process adopts + stops ——
  {
    const port = 8774
    const tool = saveTool({
      id: 'deep-adopt-cross-os',
      launchCommand: `PORT=${port} node server.mjs`,
      url: `http://127.0.0.1:${port}`,
      port,
    })
    await new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        ['scripts/smoke-adopt-launcher.mjs', dataRoot, tool.id],
        { cwd: root, stdio: ['ignore', 'inherit', 'inherit'] },
      )
      child.on('error', reject)
      child.on('exit', (code) =>
        code === 0 ? resolve() : reject(new Error(`launcher helper exited ${code}`)),
      )
    })
    await waitForPort(port, true)

    invalidateProcessSnapshot()
    const adopted = await outsider.start(tool.id)
    assert.equal(adopted.status, 'running', `cross-OS adoption failed: ${adopted.message}`)
    assert.match(adopted.message || '', /external/)
    console.log('OK: tool launched by a separate OS process adopted')

    const stopped = await outsider.stop(tool.id)
    assert.equal(stopped.status, 'stopped', `cross-OS stop failed: ${stopped.message}`)
    await waitForPort(port, false)
    console.log('OK: cross-OS external stop freed the port')
  }

  console.log('OK: deep adoption smoke passed')
} finally {
  await owner.stopAll('smoke cleanup')
  await outsider.stopAll('smoke cleanup')
  fs.rmSync(dataRoot, { recursive: true, force: true })
}
