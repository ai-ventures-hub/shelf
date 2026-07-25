/**
 * Smoke ReceiptStore begin/markRunning/end + orphan close.
 * Requires: tsc -p tsconfig.electron.json (smoke:all compile step).
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { ReceiptStore } = require('../dist-electron/shared/receipt-store.js')

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shelf-receipts-'))

try {
  const store = new ReceiptStore(root)
  const open = store.begin({
    toolId: 't1',
    toolName: 'Demo',
    launchCommand: 'PORT=1234 npm run dev',
    port: 1234,
    message: 'Starting…',
  })
  assert.equal(open.outcome, 'starting')
  assert.ok(!open.endedAt)

  const running = store.markRunning(open.id, {
    pid: 42,
    message: 'Running · port 1234',
  })
  assert.equal(running.outcome, 'running')
  assert.equal(running.pid, 42)

  const ended = store.end(open.id, {
    outcome: 'stopped',
    message: 'Stopped',
  })
  assert.equal(ended.outcome, 'stopped')
  assert.ok(ended.endedAt)
  assert.ok(typeof ended.durationMs === 'number')

  const failed = store.recordFailed({
    toolId: 't1',
    toolName: 'Demo',
    launchCommand: 'npm run dev',
    message: 'Port busy',
  })
  assert.equal(failed.outcome, 'failed')

  const listed = store.list({ toolId: 't1', limit: 10 })
  assert.ok(listed.length >= 2)

  // Orphan open receipt closed on next store open.
  store.begin({
    toolId: 't2',
    toolName: 'Other',
    launchCommand: 'node server.mjs',
  })
  const reopened = new ReceiptStore(root)
  const orphans = reopened.list({ toolId: 't2' })
  assert.equal(orphans[0].outcome, 'interrupted')
  assert.ok(orphans[0].endedAt)

  const cleared = reopened.clear({ toolId: 't1' })
  assert.ok(cleared.removed >= 2)
  assert.equal(reopened.list({ toolId: 't1' }).length, 0)

  console.log('OK: receipt store smoke passed')
} finally {
  fs.rmSync(root, { recursive: true, force: true })
}
