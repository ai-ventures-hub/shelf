/**
 * Main-process error log: an uncaught exception and an unhandled rejection
 * both land in main-errors.log with a stack, the dialog shows once per
 * distinct message, never before ready, and a failing logger stays silent.
 * Run after `tsc -p tsconfig.electron.json`.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { EventEmitter } from 'node:events'

const require = createRequire(import.meta.url)
const Module = require('node:module')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shelf-main-errors-'))

const dialogs = []
let ready = true
const fakeElectron = {
  app: {
    getPath: (name) => path.join(root, name),
    getVersion: () => '0.0.0-smoke',
    isReady: () => ready,
  },
  dialog: { showErrorBox: (title, content) => dialogs.push({ title, content }) },
}
const originalLoad = Module._load
Module._load = function (id, ...args) {
  if (id === 'electron') return fakeElectron
  return originalLoad.call(this, id, ...args)
}
let mod
try {
  mod = require('../dist-electron/electron/main-errors')
} finally {
  Module._load = originalLoad
}

// Install against a stand-in process so the smoke's own process keeps Node's defaults.
const realOn = process.on
const fakeProcess = new EventEmitter()
process.on = fakeProcess.on.bind(fakeProcess)
try {
  mod.installMainErrorLog()
} finally {
  process.on = realOn
}
const file = path.join(root, 'logs', 'main-errors.log')

const boom = new Error("ENOENT: no such file or directory, open '/var/folders/x/T/.org.cjm.shelf.abc123'")
fakeProcess.emit('uncaughtException', boom, 'uncaughtException')
assert.ok(fs.existsSync(file), 'log file created under the logs dir')
let text = fs.readFileSync(file, 'utf8')
assert.match(text, /uncaughtException \(uncaughtException\)/)
assert.match(text, /org\.cjm\.shelf\.abc123/)
assert.match(text, /smoke-main-errors\.mjs/, 'the stack names the caller')
assert.equal(dialogs.length, 1)
assert.match(dialogs[0].content, /main-errors\.log/, 'the dialog names the log')
assert.equal(fs.statSync(file).mode & 0o777, 0o600, 'log is private to the user')

// Same message within a minute: logged again, no second dialog.
fakeProcess.emit('uncaughtException', new Error(boom.message), 'uncaughtException')
assert.equal((fs.readFileSync(file, 'utf8').match(/^--- /gm) || []).length, 2)
assert.equal(dialogs.length, 1, 'repeat dialogs are suppressed')

// A different message gets its own dialog.
fakeProcess.emit('uncaughtException', new Error('something else'), 'uncaughtException')
assert.equal(dialogs.length, 2)

// Unhandled rejections are recorded without a dialog.
fakeProcess.emit('unhandledRejection', new Error('rejected quietly'))
text = fs.readFileSync(file, 'utf8')
assert.match(text, /unhandledRejection\nError: rejected quietly/)
assert.equal(dialogs.length, 2, 'rejections never open a dialog')

// Before ready there is no dialog (one would abort startup), only the record.
ready = false
fakeProcess.emit('uncaughtException', new Error('early failure'), 'uncaughtException')
assert.equal(dialogs.length, 2)
assert.match(fs.readFileSync(file, 'utf8'), /early failure/)

// Non-Error values are still recorded.
fakeProcess.emit('unhandledRejection', 'plain string reason')
assert.match(fs.readFileSync(file, 'utf8'), /plain string reason/)

fs.rmSync(root, { recursive: true, force: true })
console.log('OK: main-process errors are logged with stacks; dialogs are deduplicated and never shown before ready')
