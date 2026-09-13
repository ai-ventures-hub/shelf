/** Phase 3 contracts and failure recovery; all files live in a disposable fixture. */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { parsePortOccupants, listPortOccupants } = require('../dist-electron/shared/ports')
const { inspectToolEnvironment } = require('../dist-electron/shared/tool-environment')
const {
  prepareCatalogStarter,
  validateCatalogStarter,
} = require('../dist-electron/shared/catalog-starter')
const { nextAppUpdateState } = require('../dist-electron/shared/app-update-state')
const { LibraryStore } = require('../dist-electron/shared/library-store')
const { ProcessManager } = require('../dist-electron/shared/process-manager')
const { ReceiptStore } = require('../dist-electron/shared/receipt-store')
const { registerProject } = require('../dist-electron/shared/register-project')
const { RunLogStore } = require('../dist-electron/shared/run-log-store')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shelf-phase3-smoke-'))
try {
  const parsed = parsePortOccupants(
    'p123\nf4\nn127.0.0.1:3000\nn[::1]:3000\np456\nn*:3000\nn*:65535\nn*:65536\nninvalid\n',
  )
  assert.deepEqual(
    [...parsed],
    [
      [3000, [123, 456]],
      [65535, [456]],
    ],
  )
  assert.ok((await listPortOccupants()) instanceof Map)
  const ready = { status: 'ready', currentVersion: '1.6.0', version: '1.7.0' }
  assert.deepEqual(nextAppUpdateState(ready, { status: 'error', error: 'offline' }), ready)
  const failed = nextAppUpdateState(
    { status: 'checking', currentVersion: '1.6.0' },
    { status: 'error', error: 'offline' },
  )
  assert.equal(nextAppUpdateState(failed, { status: 'checking' }).error, undefined)
  console.log('OK: listener parsing, duplicate listeners, IPv6, and update-ready retention/retry')
  // Exercise the real Electron controller with an event-emitting update adapter, no network.
  const { EventEmitter } = require('node:events')
  const Module = require('node:module')
  const originalLoad = Module._load
  const updater = new EventEmitter()
  let checks = 0,
    installed = 0,
    finishCheck
  updater.checkForUpdates = () => {
    checks++
    return new Promise((resolve) => {
      finishCheck = resolve
    })
  }
  updater.quitAndInstall = () => {
    installed++
  }
  Module._load = function (id, ...args) {
    if (id === 'electron') return { app: { isPackaged: true, getVersion: () => '1.6.0' } }
    if (id === 'electron-updater') return { autoUpdater: updater }
    return originalLoad.call(this, id, ...args)
  }
  let controller
  try {
    controller = require('../dist-electron/electron/auto-update')
  } finally {
    Module._load = originalLoad
  }
  controller.initAutoUpdate(() => {})
  assert.throws(() => controller.installDownloadedUpdate(), /No downloaded/)
  const firstCheck = controller.checkAppUpdates()
  const concurrentCheck = controller.checkAppUpdates()
  assert.equal(checks, 1)
  updater.emit('error', new Error('private upstream error'))
  assert.equal(controller.getAppUpdateState().status, 'error')
  assert.equal(controller.getAppUpdateState().error.includes('private'), false)
  finishCheck(null)
  await Promise.all([firstCheck, concurrentCheck])
  const retry = controller.checkAppUpdates()
  assert.equal(checks, 2)
  updater.emit('update-not-available')
  finishCheck(null)
  await retry
  assert.equal(controller.getAppUpdateState().status, 'idle')
  assert.ok(controller.getAppUpdateState().checkedAt)
  updater.emit('update-available', { version: '1.7.0' })
  updater.emit('download-progress', { percent: 46.2 })
  assert.equal(controller.getAppUpdateState().percent, 46)
  updater.emit('update-downloaded', { version: '1.7.0' })
  updater.emit('error', new Error('later feed failure'))
  assert.equal(controller.getAppUpdateState().status, 'ready')
  await controller.checkAppUpdates()
  assert.equal(checks, 2)
  controller.installDownloadedUpdate()
  assert.equal(installed, 1)
  console.log(
    'OK: update controller check coalescing, offline retry, progress, ready readback, and install gate',
  )

  const project = path.join(root, 'project')
  fs.mkdirSync(project)
  const marker = path.join(project, 'SHOULD_NOT_RUN')
  fs.writeFileSync(
    path.join(project, 'package.json'),
    JSON.stringify({
      name: 'review-fixture',
      scripts: { start: 'node app.js' },
      dependencies: { example: '1' },
    }),
  )
  const store = new LibraryStore(path.join(root, 'data'))
  const tool = store.save({
    name: 'Fixture',
    projectPath: project,
    launchCommand: `touch '${marker}'`,
    env: { PRIVATE_VALUE: 'phase3-private-value-88412' },
  })
  const environment = await inspectToolEnvironment(tool)
  assert.ok(environment.checks.some((check) => check.status === 'missing'))
  assert.equal(fs.existsSync(marker), false)
  assert.equal(JSON.stringify(environment).includes('phase3-private-value'), false)
  assert.equal(environment.setupSteps[0].command, 'npm install')
  fs.writeFileSync(path.join(project, 'package.json'), '{broken')
  assert.ok(
    (await inspectToolEnvironment(tool)).checks.some(
      (check) => check.label === 'Package metadata' && check.status === 'unknown',
    ),
  )
  assert.ok(
    (await inspectToolEnvironment({ ...tool, projectPath: path.join(root, 'absent') })).checks.some(
      (check) => check.label === 'Project folder' && check.status === 'missing',
    ),
  )
  console.log(
    'OK: environment checks do not launch code or disclose values; malformed and missing projects explain failure',
  )

  const starter = await prepareCatalogStarter('Fixture team', [
    { ...tool, source: { repo: 'https://github.com/example/tool' } },
  ])
  const catalog = JSON.parse(starter.content)
  assert.equal(catalog.tools.length, 1)
  assert.deepEqual(Object.keys(catalog.tools[0]).sort(), ['capabilities', 'name', 'repo'])
  assert.equal(starter.content.includes('PRIVATE_VALUE'), false)
  assert.equal(starter.content.includes('touch'), false)
  assert.equal(validateCatalogStarter(starter.content), starter.content)
  assert.throws(() => validateCatalogStarter('{broken'))
  assert.throws(() =>
    validateCatalogStarter(
      JSON.stringify({
        shelfCatalog: 1,
        name: 'Unsafe',
        tools: [{ name: 'Bad', repo: 'https://user:password@example.com/repo' }],
      }),
    ),
  )
  assert.equal(JSON.parse((await prepareCatalogStarter('Empty team', [])).content).tools.length, 0)
  console.log(
    'OK: catalog preview/export parity, credential URL refusal, and no command/env payload',
  )

  const receipts = new ReceiptStore(path.join(root, 'data'))
  const manager = new ProcessManager(store, { receipts })
  const ports = require('../dist-electron/shared/ports')
  const originalSnapshot = ports.listPortOccupants,
    originalFind = ports.findPortOccupants
  const portTool = store.save({ name: 'Batch fixture', launchCommand: 'node app.js', port: 61234 })
  let snapshots = 0,
    individual = 0
  try {
    ports.listPortOccupants = async () => {
      snapshots++
      return new Map()
    }
    ports.findPortOccupants = async () => {
      individual++
      return []
    }
    await manager.getStates()
    assert.equal(snapshots, 1)
    assert.equal(individual, 0)
    ports.listPortOccupants = async () => null
    await manager.getStates()
    assert.equal(individual, 1, 'failed batch falls back to individual inspection')
  } finally {
    ports.listPortOccupants = originalSnapshot
    ports.findPortOccupants = originalFind
    store.delete(portTool.id)
  }
  console.log(
    'OK: one batch for reconciliation and individual fallback when a batch cannot be read',
  )

  // A dry run cannot register or run the setup/launch commands it discovers.
  const fresh = path.join(root, 'fresh')
  fs.mkdirSync(fresh)
  fs.writeFileSync(
    path.join(fresh, 'package.json'),
    JSON.stringify({ name: 'review-only', scripts: { start: 'node app.js' } }),
  )
  const before = store.list().length
  const review = await registerProject(fresh, { store, processes: manager }, { dryRun: true })
  assert.equal(review.outcome, 'dry_run')
  assert.equal(store.list().length, before)
  const existingReview = await registerProject(project, { store, processes: manager }, { dryRun: true })
  assert.equal(existingReview.tool.id, tool.id, 'review identifies an already registered folder without saving')
  const saved = await registerProject(
    fresh,
    { store, processes: manager },
    { autoLaunch: false, overrides: { launchCommand: `touch '${marker}'` } },
  )
  assert.equal(saved.outcome, 'saved')
  assert.equal(fs.existsSync(marker), false)
  fs.writeFileSync(path.join(fresh, 'app.js'), 'setInterval(() => {}, 1000)')
  const quitTool = store.save({ name: 'Quit lifecycle', projectPath: fresh, launchCommand: 'node app.js' })
  try {
    assert.equal((await manager.start(quitTool.id)).status, 'running')
    await manager.stop(quitTool.id, 'Shelf is quitting.')
    assert.equal(receipts.list({ toolId: quitTool.id })[0].outcome, 'stopped', 'intentional quit is not a failed launch')
  } finally { await manager.stop(quitTool.id); store.delete(quitTool.id) }
  console.log('OK: intentional quit records a stopped run rather than a failure')
  const logs = new RunLogStore(path.join(root, 'data'))
  const oldRun = logs.begin(tool.id)
  logs.append(
    tool.id,
    [
      {
        toolId: tool.id,
        at: new Date().toISOString(),
        stream: 'stdout',
        text: 'old run phase3-private-value-88412',
      },
    ],
    oldRun,
  )
  const current = logs.begin(tool.id)
  logs.append(
    tool.id,
    [{ toolId: tool.id, at: new Date().toISOString(), stream: 'stdout', text: 'current run' }],
    current,
  )
  const old = logs.read(tool.id, ['phase3-private-value-88412'], oldRun)
  assert.ok(old[0].text.startsWith('old run'))
  assert.equal(old[0].text.includes('phase3-private-value'), false)
  assert.equal(logs.read(tool.id)[0].text, 'current run')
  assert.ok(manager.getLogs(tool.id, oldRun)[0].text.startsWith('old run'))
  assert.equal(manager.getLogs(tool.id, oldRun)[0].text.includes('phase3-private-value'), false)
  const { buildReceiptReport } = require('../dist-electron/shared/launch-diagnostics')
  const receipt = {
    id: oldRun,
    toolId: tool.id,
    toolName: 'Previous name',
    launchCommand: 'node previous.js',
    outcome: 'failed',
    startedAt: new Date().toISOString(),
    message: 'Previous failure',
  }
  const report = buildReceiptReport(tool, receipt, old)
  assert.ok(report.includes('node previous.js'))
  assert.ok(report.includes('Previous failure'))
  assert.equal(report.includes('touch'), false)
  assert.equal(report.includes('phase3-private-value'), false)
  assert.throws(
    () => buildReceiptReport(tool, { ...receipt, toolId: 'other-tool' }, old),
    /does not belong/,
  )

  assert.deepEqual(logs.read(tool.id, [], '../../secrets'), [])
  assert.deepEqual(logs.read('different-tool', [], oldRun), [])
  console.log(
    'OK: inspect/save consent boundaries, per-run log identity, masking, and path containment',
  )
} finally {
  fs.rmSync(root, { recursive: true, force: true })
}
