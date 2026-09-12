/** Simplification boundaries: fixtures only; no user library or client configuration. */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
const require = createRequire(import.meta.url)
const { toolSchema, agentAccessInputSchema } = require('../dist-electron/shared/tool-validation.js')
const { storedToolSchema } = require('../dist-electron/shared/library-validation.js')
const { readProjectFacts, projectInstallCommands } = require('../dist-electron/shared/project-facts.js')
const { inspectProject } = require('../dist-electron/shared/project-import.js')
const { detectBootstrapNeeds } = require('../dist-electron/shared/project-bootstrap.js')
const { preflightProject } = require('../dist-electron/shared/launch-preflight.js')
const { LibraryStore } = require('../dist-electron/shared/library-store.js')
const { ProcessManager } = require('../dist-electron/shared/process-manager.js')
const { prepareArchive, extractArchive } = require('../dist-electron/shared/archive-tasks.js')
const { buildZip } = require('../dist-electron/shared/zip.js')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shelf-phase2-'))
try {
  const store = new LibraryStore(path.join(root, 'library'))
  const tool = store.save({ name: 'Boundary fixture', launchCommand: 'node app.js' })
  assert.equal(toolSchema.safeParse(tool).success, true)
  for (const port of [0, -1, 65536, 1.5, '3000']) {
    assert.equal(toolSchema.safeParse({ ...tool, port }).success, false)
    assert.equal(storedToolSchema.safeParse({ port }).success, false)
  }
  assert.equal(toolSchema.safeParse({ ...tool, port: 65535 }).success, true)
  assert.equal(agentAccessInputSchema.safeParse({ kind: 'mcp', entrypoint: 'node server.js' }).success, true)
  assert.equal(agentAccessInputSchema.safeParse({ kind: 'invented', entrypoint: '' }).success, false)
  assert.equal(storedToolSchema.safeParse({ name: 'Legacy', futureField: true }).success, true)
  assert.equal(storedToolSchema.safeParse({ agentAccess: [{ kind: 'cli', entrypoint: 'app' }] }).success, true)
  const browser = await build({
    stdin: { contents: "export { toolSchema } from './shared/tool-validation'; export { DEFAULT_UI_PREFS } from './shared/types'; export { flattenTokens } from './shared/design-tokens'; export { GLOBAL_SHORTCUT_PRESETS } from './shared/global-shortcut'", resolveDir: process.cwd() },
    bundle: true, platform: 'browser', write: false, metafile: true, logLevel: 'silent',
  })
  assert.ok(Object.keys(browser.metafile.inputs).every((file) => !/shared\/(?:library-store|process-manager|tool-share|project-facts)/.test(file)))
  console.log('OK: browser-safe schemas, shared port bounds, and legacy record compatibility')

  const project = path.join(root, 'project'); fs.mkdirSync(project)
  fs.writeFileSync(path.join(project, 'package.json'), JSON.stringify({ name: 'fixture', scripts: { start: 'node app.js', invalid: 42 }, dependencies: { example: '1' } }))
  for (const file of ['pnpm-lock.yaml', 'yarn.lock', 'bun.lock', 'requirements.txt']) fs.writeFileSync(path.join(project, file), '')
  let facts = readProjectFacts(project)
  assert.equal(facts.packageManager, 'pnpm')
  assert.deepEqual(Object.keys(facts.packageJson.scripts), ['start'])
  assert.equal((await inspectProject(project, facts)).launchCommand, 'pnpm run start')
  assert.deepEqual(detectBootstrapNeeds(project, facts).map((step) => step.command), projectInstallCommands(facts, 'missing'))
  assert.equal(preflightProject(project, '.venv/bin/python app.py', facts).length, 2)
  fs.mkdirSync(path.join(project, 'node_modules')); fs.mkdirSync(path.join(project, '.venv'))
  facts = readProjectFacts(project)
  assert.deepEqual(detectBootstrapNeeds(project, facts), [])
  assert.deepEqual(preflightProject(project, '.venv/bin/python app.py', facts), [])
  assert.deepEqual(projectInstallCommands(facts, 'refresh'), ['pnpm install', '.venv/bin/pip install -r requirements.txt'])
  for (const [removed, next] of [['pnpm-lock.yaml', 'yarn'], ['yarn.lock', 'bun'], ['bun.lock', 'npm']]) {
    fs.unlinkSync(path.join(project, removed)); assert.equal(readProjectFacts(project).packageManager, next)
  }
  fs.writeFileSync(path.join(project, 'package.json'), '{bad json')
  assert.equal(readProjectFacts(project).packageJson, null)
  assert.ok(!(await inspectProject(project)).signals.includes('Found package.json'))
  console.log('OK: import, setup, preflight, and update planning share project observations')

  const manager = new ProcessManager(store)
  const reconcile = manager.reconcileTool.bind(manager)
  let calls = 0
  let release
  const gate = new Promise((resolve) => { release = resolve })
  manager.reconcileTool = async (id) => { calls++; await gate; return reconcile(id) }
  const reads = Array.from({ length: 12 }, () => manager.getStates())
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(calls, 1, 'simultaneous readers share one probe per tool')
  release()
  const snapshots = await Promise.all(reads)
  for (const snapshot of snapshots) assert.deepEqual(snapshot, snapshots[0])
  manager.peekStates(); assert.equal(calls, 1, 'tray snapshots do not probe')
  await manager.getStates(); assert.equal(calls, 2, 'later reads refresh evidence')
  manager.reconcileTool = async () => { throw new Error('fixture probe failure') }
  await assert.rejects(manager.getStates(), /fixture probe failure/)
  manager.reconcileTool = reconcile
  assert.equal((await manager.getStates()).length, 1, 'failed refresh can recover')
  console.log('OK: concurrent runtime reads coalesce, later reads stay fresh, and failures recover')

  const source = path.join(root, 'source'); fs.mkdirSync(source)
  fs.writeFileSync(path.join(source, 'app.js'), 'reviewed source')
  fs.writeFileSync(path.join(source, '.env'), 'SYNTHETIC_SECRET=private')
  fs.writeFileSync(path.join(source, 'large.txt'), 'archive fixture\n'.repeat(1_000_000))
  fs.mkdirSync(path.join(source, 'node_modules'))
  fs.writeFileSync(path.join(source, 'node_modules', 'private.js'), 'excluded')
  let ticks = 0
  const heartbeat = setInterval(() => { ticks++ }, 1)
  let prepared
  try { prepared = await prepareArchive(source) } finally { clearInterval(heartbeat) }
  assert.ok(ticks > 0, 'main event loop remains available during archive work')
  assert.ok(prepared.files.some((file) => file.name === 'app.js'))
  assert.ok(prepared.files.every((file) => file.name !== '.env' && !file.name.startsWith('node_modules/')))
  fs.writeFileSync(path.join(source, 'app.js'), 'changed after review')
  const zip = path.join(root, 'reviewed.zip'); fs.writeFileSync(zip, prepared.zip)
  const extracted = path.join(root, 'extracted')
  await extractArchive(zip, extracted)
  assert.equal(fs.readFileSync(path.join(extracted, 'app.js'), 'utf8'), 'reviewed source')
  assert.equal(fs.existsSync(path.join(extracted, '.env')), false)
  await assert.rejects(extractArchive(zip, path.join(root, 'limited'), { maxBytes: 1 }), /exceeds.*uncompressed/i)
  const hostile = path.join(root, 'hostile.zip')
  fs.writeFileSync(hostile, buildZip([{ name: '../escaped.txt', data: Buffer.from('unsafe') }, { name: 'safe.txt', data: Buffer.from('safe') }]))
  const guarded = await extractArchive(hostile, path.join(root, 'guarded'))
  assert.ok(guarded.skipped.includes('../escaped.txt'))
  assert.equal(fs.existsSync(path.join(root, 'escaped.txt')), false)
  const cancelled = new AbortController(); cancelled.abort()
  await assert.rejects(prepareArchive(source, cancelled.signal), /cancelled/)
  const interrupted = new AbortController()
  const partial = path.join(root, 'interrupted')
  const extracting = extractArchive(zip, partial, undefined, interrupted.signal)
  setImmediate(() => interrupted.abort())
  await assert.rejects(extracting, /cancelled/)
  fs.rmSync(partial, { recursive: true, force: true })
  await extractArchive(zip, path.join(root, 'after-failure'))
  assert.equal(fs.existsSync(partial), false, 'terminated worker cannot write after cleanup')
  console.log('OK: worker responsiveness, frozen review bytes, exclusions, containment, limits, cancellation, and queue recovery')
} finally {
  fs.rmSync(root, { recursive: true, force: true })
}
