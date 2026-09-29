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
const { ToolDraftStore, acceptToolDraft, DraftStageError } = require('../dist-electron/shared/tool-draft-store')
const { canonicalFolderKey } = require('../dist-electron/shared/register-project')

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

  const other = fs.mkdtempSync(path.join(os.tmpdir(), 'shelf-draft-other-'))
  const rejected = drafts.stage({
    projectPath: other,
    suggestion: { ...suggestion, name: 'Nope', projectPath: other },
    envKeys: [],
  })
  drafts.delete(rejected.id)
  assert.equal(drafts.list().length, 0)
  assert.equal(store.list().length, 1)
  console.log('OK: tool drafts stage, accept, and reject')

  // Staging-side path checks (2.1.x audit).
  const isRegistered = (p) =>
    store.list().some((tool) => tool.projectPath && canonicalFolderKey(tool.projectPath) === canonicalFolderKey(p))
  assert.throws(
    () => drafts.stage({ projectPath: path.join(other, 'missing'), suggestion, envKeys: [] }),
    (err) => err instanceof DraftStageError && err.code === 'invalid_folder',
    'a folder that does not exist is refused, not staged',
  )
  assert.throws(
    () => drafts.stage({ projectPath: path.join(project, 'package.json'), suggestion, envKeys: [] }),
    (err) => err instanceof DraftStageError && err.code === 'invalid_folder',
    'a file is not a folder',
  )
  // A symlinked spelling of an accepted folder is the same folder.
  const link = path.join(other, 'link-to-project')
  fs.symlinkSync(project, link)
  assert.throws(
    () => drafts.stage({ projectPath: link, suggestion, envKeys: [], isRegistered }),
    (err) => err instanceof DraftStageError && err.code === 'already_registered',
  )
  if (process.platform === 'darwin' && fs.existsSync(project.toUpperCase())) {
    assert.throws(
      () => drafts.stage({ projectPath: project.toUpperCase(), suggestion, envKeys: [], isRegistered }),
      (err) => err instanceof DraftStageError && err.code === 'already_registered',
    )
  }
  assert.equal(drafts.list().length, 0)

  // A stale draft for a folder that became a library tool is dropped at the
  // next staging; symlinked spellings of one new folder share a card; the
  // self-reported client label is stripped and capped; description and
  // capabilities ride on the draft.
  const fresh = fs.mkdtempSync(path.join(os.tmpdir(), 'shelf-draft-fresh-'))
  fs.writeFileSync(
    path.join(dataRoot, 'tool-drafts.json'),
    JSON.stringify({
      version: 1,
      drafts: [{ id: 'stale', projectPath: project, name: 'Stale', launchCommand: 'npm start', envKeys: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }],
    }),
  )
  const freshLink = path.join(other, 'fresh-link')
  fs.symlinkSync(fresh, freshLink)
  const labelled = drafts.stage({
    projectPath: freshLink,
    suggestion: { ...suggestion, projectPath: freshLink },
    envKeys: [],
    client: `​cur‮sor${'x'.repeat(200)}`,
    description: '  Does​ things  ',
    capabilities: ['make things', 'Make things', ''],
    isRegistered,
  })
  assert.equal(drafts.get('stale'), undefined, 'stale draft for a registered folder is pruned')
  assert.equal(labelled.projectPath, fs.realpathSync.native(fresh), 'the sheet shows the real folder')
  assert.ok(labelled.client.length <= 80 && labelled.client.startsWith('cursor'), labelled.client)
  assert.equal(labelled.description, 'Does things')
  assert.deepEqual(labelled.capabilities, ['make things'])
  const sameCard = drafts.stage({ projectPath: fresh, suggestion, envKeys: [], isRegistered })
  assert.equal(sameCard.id, labelled.id)
  assert.equal(drafts.findByProjectPath(freshLink)?.id, labelled.id)
  assert.equal(drafts.list().length, 1)
  fs.rmSync(fresh, { recursive: true, force: true })
  fs.rmSync(other, { recursive: true, force: true })
  console.log('OK: staging refuses missing/registered folders, prunes stale drafts, caps the client label')
} finally {
  await processes.stopAll('Smoke cleanup.')
  fs.rmSync(dataRoot, { recursive: true, force: true })
  fs.rmSync(project, { recursive: true, force: true })
}
