/**
 * Accept saves exactly what the review sheet showed. A draft re-staged after
 * the sheet opened, a draft with no command, and a folder that became a
 * library tool in the meantime are all refused instead of saved.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { LibraryStore } = require('../dist-electron/shared/library-store')
const { ProcessManager } = require('../dist-electron/shared/process-manager')
const { ReceiptStore } = require('../dist-electron/shared/receipt-store')
const { ToolDraftStore, acceptToolDraft } = require('../dist-electron/shared/tool-draft-store')

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'shelf-draft-accept-'))
const store = new LibraryStore(dataRoot)
const processes = new ProcessManager(store, { receipts: new ReceiptStore(dataRoot) })
const drafts = new ToolDraftStore(dataRoot)
const deps = { store, processes }

function project(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `shelf-${name}-`))
  fs.writeFileSync(path.join(dir, 'server.mjs'), 'console.log("fixture")\n')
  return dir
}

const base = {
  launchAlternatives: [],
  tags: [],
  designMd: { found: false },
  agentAccess: [],
  confidence: 'high',
  signals: [],
}

try {
  // 1. Re-staged while the sheet was open: refused, nothing saved.
  const moving = project('moving')
  const shown = drafts.stage({ projectPath: moving, suggestion: { ...base, projectPath: moving, name: 'Shown', launchCommand: 'node server.mjs' }, envKeys: [] })
  await new Promise((resolve) => setTimeout(resolve, 5))
  drafts.stage({ projectPath: moving, suggestion: { ...base, projectPath: moving, name: 'Shown', launchCommand: 'touch MARKER' }, envKeys: [] })
  await assert.rejects(acceptToolDraft(shown.id, drafts, deps, { expectedUpdatedAt: shown.updatedAt }), /changed after it was shown/)
  assert.equal(store.list().length, 0)
  console.log('OK: a draft re-staged after the sheet opened is refused')

  // 2. The sheet showed no command or port; a later package.json must not fill them in.
  const empty = project('empty')
  const blank = drafts.stage({ projectPath: empty, suggestion: { ...base, projectPath: empty, name: 'Blank', launchCommand: '' }, envKeys: [] })
  fs.writeFileSync(path.join(empty, 'package.json'), JSON.stringify({ name: 'late', scripts: { dev: 'PORT=5199 node server.mjs --port 5199' } }))
  await assert.rejects(acceptToolDraft(blank.id, drafts, deps, { expectedUpdatedAt: blank.updatedAt }), /no launch command/)
  assert.equal(store.list().length, 0)
  console.log('OK: a draft without a command is refused, not filled from a new scan')

  const portless = project('portless')
  const shownPortless = drafts.stage({ projectPath: portless, suggestion: { ...base, projectPath: portless, name: 'Portless', launchCommand: 'node server.mjs' }, envKeys: [] })
  fs.writeFileSync(path.join(portless, 'package.json'), JSON.stringify({ name: 'late', scripts: { start: 'PORT=5198 node server.mjs' } }))
  const saved = await acceptToolDraft(shownPortless.id, drafts, deps, { expectedUpdatedAt: shownPortless.updatedAt })
  assert.equal(saved.tool?.launchCommand, 'node server.mjs')
  assert.equal(saved.tool?.port, undefined, 'the port the sheet did not show is not saved')
  console.log('OK: accept saves the shown command and no scanned port')

  // 3. The folder became a tool some other way (symlink and case variants included).
  const twin = project('twin')
  const alias = path.join(os.tmpdir(), `shelf-twin-link-${Date.now()}`)
  fs.symlinkSync(twin, alias)
  const stale = drafts.stage({ projectPath: alias, suggestion: { ...base, projectPath: alias, name: 'Twin draft', launchCommand: 'touch MARKER' }, envKeys: [] })
  store.save({ id: '', name: 'Twin', tags: [], capabilities: [], agentAccess: [], favorite: false, projectPath: twin, launchCommand: 'node server.mjs', createdAt: '', updatedAt: '' })
  await assert.rejects(acceptToolDraft(stale.id, drafts, deps, { expectedUpdatedAt: stale.updatedAt }), /already in your library/)
  assert.equal(store.list().filter((tool) => tool.name.startsWith('Twin')).length, 1)
  assert.equal(drafts.get(stale.id), undefined, 'the stale draft is cleared')
  assert.ok(!fs.existsSync(path.join(twin, 'MARKER')))
  fs.rmSync(alias, { force: true })
  console.log('OK: a draft for a folder already in the library is refused and cleared')

  console.log('OK: draft acceptance smoke passed')
} finally {
  await processes.stopAll('smoke cleanup')
  fs.rmSync(dataRoot, { recursive: true, force: true })
}
