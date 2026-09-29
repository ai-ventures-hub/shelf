/**
 * Regressions from the September 28, 2026 audit (shared/ and main-process
 * fixes). Everything runs against temporary data roots and stubs.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const dist = (name) => require(`../dist-electron/shared/${name}.js`)
const { LibraryStore } = dist('library-store')
const { ReceiptStore } = dist('receipt-store')
const { ProjectMemoryStore } = dist('project-memory-store')
const { DesignProfileStore } = dist('design-profile-store')
const { VerificationStore } = dist('verification-store')
const { ProcessOperations } = dist('process-operation')
const { startCollection } = dist('collection-launch')
const { validateCatalogStarter } = dist('catalog-starter')
const { prepareProjectHandoff } = dist('project-handoff')
const { adoptedRunNote, maskCommandEnvPrefix } = dist('types')
const { saveUpdateResume, takeUpdateResume } = dist('update-resume')
const { containedDataUrl, ICON_MIME_TYPES } = dist('contained-data-url')
const { containsLikelySecret } = dist('capability-intelligence')

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shelf-audit-fixes-'))
const tool = (store, fields) => store.save({ id: '', tags: [], capabilities: [], agentAccess: [], favorite: false, createdAt: '', updatedAt: '', ...fields })

try {
  // Handoffs mask any-case inline assignments, like shelf_get_tool does.
  {
    const dataRoot = fs.mkdtempSync(path.join(root, 'handoff-'))
    const library = new LibraryStore(dataRoot)
    const saved = tool(library, { name: 'Leaky', launchCommand: 'openai_key=abc123LIVEVALUE npm run dev' })
    assert.equal(maskCommandEnvPrefix('db_pass=hunter22 node app.js'), 'db_pass=*** node app.js')
    const handoff = await prepareProjectHandoff({ library, memory: new ProjectMemoryStore(dataRoot), receipts: new ReceiptStore(dataRoot), design: new DesignProfileStore(dataRoot) }, saved.id, {})
    assert.ok(!JSON.stringify(handoff).includes('abc123LIVEVALUE'), 'handoff must not carry an inline env value')
    console.log('OK: handoffs mask lowercase inline env assignments')
  }

  // Catalog export checks what it writes, after invisible characters are stripped.
  {
    const token = 'ghp_' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8'
    const hidden = token.slice(0, 12) + '​' + token.slice(12)
    assert.throws(() => validateCatalogStarter(JSON.stringify({ shelfCatalog: 1, name: 'Team', tools: [{ name: 'A', description: `uses ${hidden}`, capabilities: [], repo: 'https://github.com/acme/a' }] })), /credential/)
    console.log('OK: catalog export refuses a token split by a zero-width space')
  }

  // A crashed host's lease whose pid now belongs to another user is stale.
  {
    const dataRoot = fs.mkdtempSync(path.join(root, 'lease-'))
    const ops = new ProcessOperations(dataRoot)
    const file = path.join(dataRoot, 'operations', `${createHash('sha256').update('tool-x').digest('hex')}.json`)
    // pid 1 (launchd) answers kill(1, 0) with EPERM for a normal user.
    fs.writeFileSync(file, JSON.stringify({ generation: 0, lease: { pid: 1, token: 'dead-host', startedAt: 'Thu Jan  1 00:00:00 1970' } }))
    const started = Date.now()
    assert.equal(await ops.run('tool-x', async () => 'ran'), 'ran')
    assert.ok(Date.now() - started < 5_000, 'a stale EPERM lease must not wait out the 90 s deadline')
    console.log('OK: an EPERM lease from a reused pid does not block the tool')
  }

  // An ordered stack waits for a member that is still starting.
  {
    const dataRoot = fs.mkdtempSync(path.join(root, 'stack-'))
    const library = new LibraryStore(dataRoot)
    const db = tool(library, { name: 'db', launchCommand: 'node db.js', port: 50001 })
    const api = tool(library, { name: 'api', launchCommand: 'node api.js', port: 50002 })
    const collection = library.saveCollection({ id: '', name: 'Stack', toolIds: [db.id, api.id], stack: { ordered: true, steps: [] } })
    const events = []
    let dbPolls = 0
    const processes = {
      async getState(id) {
        if (id === db.id) {
          dbPolls += 1
          events.push(`db:${dbPolls < 3 ? 'starting' : 'running'}`)
          return { toolId: id, status: dbPolls < 3 ? 'starting' : 'running' }
        }
        return { toolId: id, status: 'stopped' }
      },
      async start(id) { events.push(`start:${id === api.id ? 'api' : 'db'}`); return { toolId: id, status: 'running', port: 50002 } },
    }
    const result = await startCollection(collection.id, { store: library, processes })
    assert.deepEqual(events, ['db:starting', 'db:starting', 'db:running', 'start:api'], 'api must not spawn before db answers')
    assert.deepEqual(result.results.map((row) => row.outcome), ['already_running', 'started'])
    console.log('OK: ordered stacks wait for a member that is still starting')
  }

  // Deleting a tool leaves unrelated collections untouched.
  {
    const dataRoot = fs.mkdtempSync(path.join(root, 'collections-'))
    const library = new LibraryStore(dataRoot)
    const a = tool(library, { name: 'A', launchCommand: 'true' })
    const b = tool(library, { name: 'B', launchCommand: 'true' })
    const holds = library.saveCollection({ id: '', name: 'Holds A', toolIds: [a.id] })
    const other = library.saveCollection({ id: '', name: 'Only B', toolIds: [b.id] })
    await new Promise((resolve) => setTimeout(resolve, 5))
    library.delete(a.id)
    assert.equal(library.getCollection(other.id).updatedAt, other.updatedAt)
    assert.notEqual(library.getCollection(holds.id).updatedAt, holds.updatedAt)
    assert.deepEqual(library.getCollection(holds.id).toolIds, [])
    console.log('OK: deleting a tool stamps only the collections that held it')
  }

  // Deleted tools do not keep notes or verification history.
  {
    const dataRoot = fs.mkdtempSync(path.join(root, 'forget-'))
    const memory = new ProjectMemoryStore(dataRoot)
    const saved = memory.save({ toolId: 'gone', expectedRevision: null, fields: { purpose: 'kept until delete', conventions: '', decisions: '', knownIssues: '', nextSteps: '' } })
    assert.ok(saved.revision)
    memory.forget('gone')
    assert.equal(memory.get('gone'), null)
    const verification = new VerificationStore(dataRoot)
    verification.save({ toolId: 'gone', expectedRevision: null, steps: [{ id: '0f8fad5b-d9cb-469f-a165-70867728950e', label: 'Test', command: 'npm test', timeoutSeconds: 60 }] })
    assert.ok(verification.get('gone').workflow)
    verification.forget('gone')
    assert.equal(verification.get('gone').workflow, null)
    console.log('OK: deleted tools drop their memory and verification records')
  }

  // Adopted runs say who started them; interrupted runs drop their live status.
  {
    assert.equal(adoptedRunNote({ kind: 'gui' }), '(started in Shelf)')
    assert.match(adoptedRunNote({ kind: 'mcp', client: 'codex-mcp-client' }), /^\(started by /)
    assert.equal(adoptedRunNote(undefined), '(started by another Shelf process)')
    const dataRoot = fs.mkdtempSync(path.join(root, 'receipts-'))
    fs.writeFileSync(path.join(dataRoot, 'receipts.json'), JSON.stringify({ version: 1, receipts: [{ id: 'r1', toolId: 't', toolName: 'T', launchCommand: 'x', pid: 999999, startedAt: new Date(Date.now() - 1000).toISOString(), outcome: 'running', message: 'Running · port 5100' }] }))
    const receipts = new ReceiptStore(dataRoot)
    const closed = receipts.list().find((row) => row.id === 'r1')
    assert.equal(closed.outcome, 'interrupted')
    assert.doesNotMatch(closed.message, /^Running/)
    console.log('OK: adopted and interrupted runs describe themselves accurately')
  }

  // Restart and update resumes only fresh lists, once.
  {
    const dataRoot = fs.mkdtempSync(path.join(root, 'resume-'))
    saveUpdateResume(dataRoot, ['a', 'b', 'a'])
    assert.deepEqual(takeUpdateResume(dataRoot), ['a', 'b'])
    assert.deepEqual(takeUpdateResume(dataRoot), [], 'the list is consumed')
    saveUpdateResume(dataRoot, ['late'])
    assert.deepEqual(takeUpdateResume(dataRoot, Date.now() + 16 * 60_000), [], 'a stale list is ignored')
    fs.writeFileSync(path.join(dataRoot, 'resume-after-update.json'), '{not json')
    assert.deepEqual(takeUpdateResume(dataRoot), [])
    console.log('OK: update resume lists are fresh, deduplicated, and single-use')
  }

  // Secret detection sees through invisible characters for every caller.
  {
    const token = 'ghp_' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8'
    assert.ok(containsLikelySecret(token.slice(0, 10) + '\u2060' + token.slice(10)))
    assert.ok(!containsLikelySecret('Resize client photos\u200B for the web'))
    console.log('OK: containsLikelySecret strips invisible characters before matching')
  }

  // Preview reads stay inside their folder and their file types.
  {
    const dir = fs.mkdtempSync(path.join(root, 'icons-'))
    const outside = fs.mkdtempSync(path.join(root, 'outside-'))
    fs.writeFileSync(path.join(dir, 'ok.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    fs.writeFileSync(path.join(outside, 'secret.png'), 'not yours')
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'text')
    fs.symlinkSync(path.join(outside, 'secret.png'), path.join(dir, 'planted.png'))
    assert.match(containedDataUrl(dir, path.join(dir, 'ok.png'), ICON_MIME_TYPES), /^data:image\/png;base64,/)
    assert.equal(containedDataUrl(dir, path.join(dir, 'planted.png'), ICON_MIME_TYPES), null, 'a planted symlink must not escape')
    assert.equal(containedDataUrl(dir, path.join(dir, '..', path.basename(outside), 'secret.png'), ICON_MIME_TYPES), null)
    assert.equal(containedDataUrl(dir, path.join(dir, 'notes.txt'), ICON_MIME_TYPES), null, 'unlisted types are never read')
    assert.equal(containedDataUrl(dir, 42, ICON_MIME_TYPES), null)
    console.log('OK: preview data URLs stay contained')
  }

  console.log('OK: audit fixes smoke passed')
} finally {
  fs.rmSync(root, { recursive: true, force: true })
}
