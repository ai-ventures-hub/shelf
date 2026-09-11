/** Fault injection for safe sharing, malformed records, and resumable updates/imports. */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { LibraryStore } = require('../dist-electron/shared/library-store.js')
const { ProcessManager } = require('../dist-electron/shared/process-manager.js')
const { bundleFolder, listZip } = require('../dist-electron/shared/zip.js')
const { applyToolUpdate, checkToolUpdates, workingTreeFingerprint, stageSharedTool, confirmStagedShare, cleanStagingRoot, validateRepoUrl } = require('../dist-electron/shared/tool-share.js')
const { readImport, pendingImportIds } = require('../dist-electron/shared/import-journal.js')
const { replaceClientConfig } = require('../dist-electron/shared/client-config-file.js')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shelf-recovery-'))
const data = path.join(root, 'data')
const store = new LibraryStore(data)
const processes = new ProcessManager(store)
const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, '-c', 'user.name=Shelf test', '-c', 'user.email=test@example.invalid', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const makeTool = (id, projectPath) => store.save({ id, name: id, projectPath, launchCommand: 'node app.js', tags: [], capabilities: [], agentAccess: [], favorite: false, createdAt: '', updatedAt: '', source: { kind: 'git', repo: 'https://example.invalid/tool.git', addedAt: new Date().toISOString() } })
try {
  const config = path.join(root, 'client.json')
  fs.writeFileSync(config, 'newer edit', { mode: 0o600 })
  assert.throws(() => replaceClientConfig(config, 'replacement', 'stale edit'), /changed/)
  assert.equal(fs.readFileSync(config, 'utf8'), 'newer edit')
  assert.equal(validateRepoUrl('https://synthetic-token@github.com/org/repo.git').ok, false)
  console.log('OK: stale client-config writes and credential-bearing clone URLs fail closed')

  const nonGit = path.join(root, 'non-git'); fs.mkdirSync(nonGit)
  fs.writeFileSync(path.join(nonGit, '.gitignore'), 'private-notes.txt\n')
  fs.writeFileSync(path.join(nonGit, 'private-notes.txt'), 'private fixture')
  fs.writeFileSync(path.join(nonGit, 'private.sqlite'), 'private fixture')
  fs.writeFileSync(path.join(nonGit, 'app.js'), 'console.log("fixture")')
  fs.writeFileSync(path.join(nonGit, 'shelf.json'), JSON.stringify({ shelfManifest: 1, name: 'Import fixture', launchCommand: 'node app.js', env: {}, bootstrap: [] }))
  const bundle = path.join(root, 'fixture.zip')
  fs.writeFileSync(bundle, bundleFolder(nonGit))
  const names = listZip(bundle)
  assert.ok(names.includes('app.js')); assert.ok(names.includes('shelf.json'))
  assert.ok(!names.includes('private-notes.txt')); assert.ok(!names.includes('private.sqlite'))
  git(nonGit, 'init', '-q')
  git(nonGit, 'add', 'app.js', 'shelf.json', '.gitignore')
  fs.writeFileSync(path.join(nonGit, 'untracked.txt'), 'not opted in')
  fs.writeFileSync(bundle, bundleFolder(nonGit))
  assert.ok(!listZip(bundle).includes('untracked.txt'))
  console.log('OK: bundle membership respects ignores and excludes private stores/untracked Git data')

  const library = path.join(data, 'library.json')
  const good = makeTool('valid', nonGit)
  const raw = JSON.parse(fs.readFileSync(library, 'utf8'))
  raw.tools.push({ ...good, id: 'malformed', tags: 'not an array' })
  fs.writeFileSync(library, JSON.stringify(raw))
  const recovered = new LibraryStore(data)
  assert.deepEqual(recovered.list().map((t) => t.id), ['valid'])
  assert.match(recovered.recoveryNotice(), /1 invalid/)
  assert.ok(fs.readdirSync(data).some((f) => f.startsWith('library.quarantine-')))
  const future = path.join(root, 'future'); fs.mkdirSync(future)
  const futureText = JSON.stringify({ version: 999, tools: [good], collections: [] })
  fs.writeFileSync(path.join(future, 'library.json'), futureText)
  assert.throws(() => new LibraryStore(future), /newer Shelf/)
  assert.equal(fs.readFileSync(path.join(future, 'library.json'), 'utf8'), futureText)
  const broken = path.join(root, 'broken'); fs.mkdirSync(broken)
  fs.writeFileSync(path.join(broken, 'library.json'), 'null')
  assert.equal(new LibraryStore(broken).list().length, 0)
  assert.ok(fs.readdirSync(broken).some((name) => name.startsWith('library.corrupt-backup-')))
  const blockedRoot = path.join(root, 'write-failure'); fs.mkdirSync(blockedRoot)
  const oldText = JSON.stringify({ version: 2, tools: [good] })
  const blockedFile = path.join(blockedRoot, 'library.json')
  fs.writeFileSync(blockedFile, oldText)
  const realRename = fs.renameSync
  fs.renameSync = (from, to) => { if (to === blockedFile) throw new Error('injected rename failure'); return realRename(from, to) }
  try { assert.throws(() => new LibraryStore(blockedRoot), /injected rename failure/) }
  finally { fs.renameSync = realRename }
  assert.equal(fs.readFileSync(blockedFile, 'utf8'), oldText)
  console.log('OK: invalid records are quarantined and future libraries are never rewritten')

  const stage = await stageSharedTool({ kind: 'bundle', bundlePath: bundle }, { dataRoot: data, toolsRoot: path.join(root, 'tools') })
  const destination = path.join(root, 'imported')
  const originalSave = store.save.bind(store)
  store.save = () => { throw new Error('injected disk failure') }
  await assert.rejects(confirmStagedShare(stage, { destination, env: {}, runSetup: false, launch: false }, { store, processes, dataRoot: data }), /Files are safe/)
  assert.ok(fs.existsSync(path.join(destination, 'app.js')))
  assert.ok(pendingImportIds(data).includes(stage.stageId))
  cleanStagingRoot(data)
  store.save = originalSave
  const recovery = readImport(data, stage.stageId)
  const resumed = await confirmStagedShare(recovery.stage, { destination, env: {}, runSetup: false, launch: false }, { store, processes, dataRoot: data })
  assert.ok(resumed.tool)
  assert.equal(pendingImportIds(data).length, 0)
  assert.equal(store.list().filter((t) => t.projectPath === destination).length, 1)
  console.log('OK: failed import registration resumes from preserved files without another download')

  const project = path.join(root, 'update'); fs.mkdirSync(project)
  git(project, 'init', '-q', '--initial-branch=main')
  const manifest = { shelfManifest: 1, name: 'update', description: 'before', launchCommand: 'node app.js', env: {}, bootstrap: [] }
  fs.writeFileSync(path.join(project, 'shelf.json'), JSON.stringify(manifest))
  fs.writeFileSync(path.join(project, 'app.js'), 'console.log("before")')
  git(project, 'add', '.'); git(project, 'commit', '-qm', 'before')
  const before = git(project, 'rev-parse', 'HEAD')
  fs.writeFileSync(path.join(project, 'shelf.json'), JSON.stringify({ ...manifest, description: 'after' }))
  git(project, 'add', '.'); git(project, 'commit', '-qm', 'after')
  const after = git(project, 'rev-parse', 'HEAD')
  git(project, 'update-ref', 'refs/remotes/origin/main', after)
  git(project, 'reset', '--hard', before)
  let t = makeTool('update', project)
  t = store.save({ ...t, description: 'before' })
  const input = { mode: 'fast_forward', target: 'origin/main', expectedRef: before, expectedTargetRef: after, expectedWorkingTree: await workingTreeFingerprint(project) }
  fs.appendFileSync(path.join(project, 'app.js'), '\n// user edit')
  assert.equal((await applyToolUpdate(t, input, { store, processes })).ok, false)
  assert.equal(git(project, 'rev-parse', 'HEAD'), before)
  git(project, 'restore', 'app.js')
  store.save = () => { throw new Error('injected metadata failure') }
  const partial = await applyToolUpdate(t, input, { store, processes })
  assert.equal(partial.ok, false); assert.ok(partial.operationId)
  assert.equal(git(project, 'rev-parse', 'HEAD'), after)
  store.save = originalSave
  const pending = await checkToolUpdates(store.get(t.id), data)
  assert.equal(pending.state, 'recovery_required')
  fs.appendFileSync(path.join(project, 'app.js'), '\n// changed during pause')
  const changedPause = await applyToolUpdate(store.get(t.id), pending.input, { store, processes })
  assert.equal(changedPause.ok, false); assert.match(changedPause.message, /Tracked files changed/)
  git(project, 'restore', 'app.js')
  // A moved remote must not prevent recovery of the immutable revision already applied.
  git(project, 'update-ref', 'refs/remotes/origin/main', before)
  const finished = await applyToolUpdate(store.get(t.id), pending.input, { store, processes })
  assert.equal(finished.ok, true, finished.message)
  assert.equal(store.get(t.id).description, 'after')
  console.log('OK: reviewed revisions reject changed files; metadata failure resumes after files applied')

  const commands = ['printf x >> setup-count', 'test -f setup-ready']
  fs.writeFileSync(path.join(project, 'shelf.json'), JSON.stringify({ ...manifest, description: 'setup version', bootstrap: commands }))
  git(project, 'add', '.'); git(project, 'commit', '-qm', 'with setup')
  const setupRef = git(project, 'rev-parse', 'HEAD')
  git(project, 'update-ref', 'refs/remotes/origin/main', setupRef)
  git(project, 'reset', '--hard', after)
  const setupInput = { mode: 'fast_forward', target: 'origin/main', expectedRef: after, expectedTargetRef: setupRef, expectedWorkingTree: await workingTreeFingerprint(project), runSetup: true, setupCommands: commands }
  const failedSetup = await applyToolUpdate(store.get(t.id), setupInput, { store, processes })
  assert.equal(failedSetup.ok, false); assert.ok(failedSetup.operationId)
  assert.deepEqual(failedSetup.setup.map((step) => step.ok), [true, false])
  fs.writeFileSync(path.join(project, 'setup-ready'), '')
  const retry = await checkToolUpdates(store.get(t.id), data)
  const completed = await applyToolUpdate(store.get(t.id), retry.input, { store, processes })
  assert.equal(completed.ok, true, completed.message)
  assert.equal(fs.readFileSync(path.join(project, 'setup-count'), 'utf8'), 'x', 'successful setup steps must not be repeated')
  console.log('OK: interrupted setup retries only incomplete commands after explicit resume')

} finally {
  await processes.stopAll('fixture cleanup', { scope: 'local' })
  fs.rmSync(root, { recursive: true, force: true })
}
