/**
 * Agent registration stages a draft. Accept uses registerProject and does
 * not launch. Reject deletes the draft and leaves the library alone.
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
const { ReceiptStore } = require('../dist-electron/shared/receipt-store')
const { ToolDraftStore, acceptToolDraft } = require('../dist-electron/shared/tool-draft-store')

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'shelf-drafts-'))
const store = new LibraryStore(dataRoot)
const processes = new ProcessManager(store, { receipts: new ReceiptStore(dataRoot) })
const drafts = new ToolDraftStore(dataRoot)
const project = fs.mkdtempSync(path.join(os.tmpdir(), 'shelf-draft-proj-'))
fs.copyFileSync(path.join(root, 'fixtures/sample-tool/server.mjs'), path.join(project, 'server.mjs'))
fs.writeFileSync(
  path.join(project, 'package.json'),
  JSON.stringify({ name: 'draft-fixture', private: true, scripts: { start: 'node server.mjs' } }),
)

const suggestion = {
  projectPath: project,
  name: 'Drafted tool',
  launchCommand: 'npm start',
  launchAlternatives: [],
  tags: [],
  designMd: { found: false },
  agentAccess: [],
  confidence: 'high',
  signals: [],
  port: 8791,
}

try {
  const first = drafts.stage({
    projectPath: project,
    suggestion,
    envKeys: ['SHELF_TOKEN', 'SECRET=hunter2'],
    client: 'cursor',
  })
  const second = drafts.stage({
    projectPath: project,
    suggestion,
    envKeys: ['SHELF_TOKEN'],
    client: 'cursor',
  })
  assert.equal(second.id, first.id)
  assert.deepEqual(second.envKeys, ['SHELF_TOKEN'])
  assert.equal(store.list().length, 0)

  const saved = await acceptToolDraft(first.id, drafts, { store, processes })
  assert.equal(saved.outcome, 'saved')
  assert.equal(saved.created, true)
  assert.equal(saved.tool?.launchCommand, 'npm start')
  assert.equal(saved.tool?.port, 8791)
  assert.equal(drafts.list().length, 0)
  assert.equal(store.list().length, 1)

  const rejected = drafts.stage({
    projectPath: path.join(project, 'missing'),
    suggestion: { ...suggestion, name: 'Nope', projectPath: path.join(project, 'missing') },
    envKeys: [],
  })
  drafts.delete(rejected.id)
  assert.equal(drafts.list().length, 0)
  assert.equal(store.list().length, 1)
  console.log('OK: tool drafts stage, accept, and reject')
} finally {
  await processes.stopAll('Smoke cleanup.')
  fs.rmSync(dataRoot, { recursive: true, force: true })
  fs.rmSync(project, { recursive: true, force: true })
}
