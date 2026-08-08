/**
 * Smoke registerProject one-shot flow: launch, idempotent re-register,
 * draft on unrecognizable folders, dryRun, and busy-port reassign.
 * Requires: tsc -p tsconfig.electron.json (smoke:all compile step).
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const require = createRequire(import.meta.url)

const { LibraryStore } = require('../dist-electron/shared/library-store')
const { ProcessManager } = require('../dist-electron/shared/process-manager')
const { ReceiptStore } = require('../dist-electron/shared/receipt-store')
const { registerProject } = require('../dist-electron/shared/register-project')

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'shelf-register-'))
const store = new LibraryStore(dataRoot)
const receipts = new ReceiptStore(dataRoot)
const processes = new ProcessManager(store, { receipts })
const deps = { store, processes }

// Own copy of the sample server WITHOUT a pinned PORT in the npm script, so
// env-based port reassignment can actually take effect (the shared fixture
// hard-codes PORT=8765 inside its start script).
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'shelf-register-proj-'))
fs.copyFileSync(
  path.join(root, 'fixtures/sample-tool/server.mjs'),
  path.join(fixture, 'server.mjs'),
)
fs.writeFileSync(
  path.join(fixture, 'package.json'),
  JSON.stringify(
    {
      name: 'register-smoke-fixture',
      private: true,
      scripts: { start: 'node server.mjs' },
    },
    null,
    2,
  ),
)

try {
  // 1) dryRun: gate info, nothing saved.
  const dry = await registerProject(fixture, deps, { dryRun: true })
  assert.equal(dry.outcome, 'dry_run')
  assert.equal(dry.autoRunnable, true)
  assert.equal(store.list().length, 0)
  console.log('OK: dryRun gates without saving')

  // 2) Fixture registers and launches end-to-end.
  const first = await registerProject(fixture, deps)
  assert.equal(first.outcome, 'launched', first.state?.message)
  assert.ok(first.created)
  assert.ok(first.tool?.id)
  assert.equal(first.state?.status, 'running')
  assert.equal(first.setupNeeds.length, 0, 'dependency-less fixture needs no setup')
  const receiptRows = receipts.list({ toolId: first.tool.id })
  assert.ok(receiptRows.length >= 1, 'launch must write a receipt')
  console.log(`OK: launched fixture on port ${first.tool.port}`)

  // 3) Re-register the same folder: update, never duplicate; user edits survive.
  store.save({ ...store.get(first.tool.id), name: 'My Renamed Tool' })
  await processes.stop(first.tool.id)
  const again = await registerProject(fixture, deps)
  assert.equal(again.outcome, 'launched', again.state?.message)
  assert.equal(again.created, false)
  assert.equal(store.list().length, 1, 'must not duplicate the entry')
  assert.equal(again.tool.name, 'My Renamed Tool', 'user-edited name preserved')
  await processes.stop(again.tool.id)
  console.log('OK: idempotent re-register preserved edits')

  // 4) Busy port → silent reassign (existing entry, occupied port).
  const port = store.get(first.tool.id).port
  const blocker = http.createServer((_req, res) => res.end('busy'))
  await new Promise((resolve) => blocker.listen(port, '127.0.0.1', resolve))
  const reassigned = await registerProject(fixture, deps)
  assert.equal(reassigned.outcome, 'launched', reassigned.state?.message)
  assert.notEqual(reassigned.tool.port, port, 'port must be reassigned')
  assert.ok(
    reassigned.tool.launchCommand.includes(`PORT=${reassigned.tool.port}`),
    'launch command rewritten to the new port',
  )
  await processes.stop(reassigned.tool.id)
  await new Promise((resolve) => blocker.close(resolve))
  console.log(`OK: busy port ${port} reassigned to ${reassigned.tool.port}`)

  // 5) Unrecognizable folder → saved draft for review.
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'shelf-register-empty-'))
  const draft = await registerProject(empty, deps)
  assert.equal(draft.outcome, 'saved_needs_review')
  assert.equal(draft.autoRunnable, false)
  assert.ok(draft.tool?.id)
  assert.equal(draft.tool.launchCommand, '')
  fs.rmSync(empty, { recursive: true, force: true })
  console.log('OK: unknown folder saved as review draft')

  // 6) Missing folder → invalid_folder, nothing saved.
  const beforeCount = store.list().length
  const missing = await registerProject(path.join(dataRoot, 'nope'), deps)
  assert.equal(missing.outcome, 'invalid_folder')
  assert.equal(missing.issues[0]?.code, 'folder_missing')
  assert.equal(store.list().length, beforeCount)
  console.log('OK: missing folder rejected')

  console.log('OK: register smoke passed')
} finally {
  await processes.stopAll('smoke cleanup', { scope: 'all' }).catch(() => {})
  fs.rmSync(dataRoot, { recursive: true, force: true })
  fs.rmSync(fixture, { recursive: true, force: true })
}
