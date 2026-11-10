/** Cross-process lock recovery must preserve every update and every live owner. */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const modulePath = require.resolve('../dist-electron/shared/atomic-file.js')
const { withFileLockSync } = require(modulePath)
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shelf-smoke-lock-'))
const target = path.join(root, 'counter.json')
const lock = `${target}.lock`
const worker = (code) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, ['-e', code, modulePath, target], { stdio: ['ignore', 'ignore', 'pipe'] })
  let errors = ''
  child.stderr.on('data', (chunk) => { errors += chunk })
  child.once('error', reject)
  child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(errors || `worker exited ${code}`)))
})
const old = new Date(Date.now() - 60_000)
try {
  fs.writeFileSync(target, '0')
  // Leave the actual lock of a process that died while holding it.
  await worker(`const {withFileLockSync}=require(process.argv[1]);withFileLockSync(process.argv[2],()=>process.exit(0))`)
  fs.utimesSync(lock, old, old)
  await Promise.all(Array.from({ length: 4 }, () => worker(`
    const fs=require('node:fs');const {withFileLockSync}=require(process.argv[1]);
    for(let i=0;i<40;i++)withFileLockSync(process.argv[2],()=>{
      const n=Number(fs.readFileSync(process.argv[2],'utf8'));
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,1);
      fs.writeFileSync(process.argv[2],String(n+1));
    });
  `)))
  assert.equal(fs.readFileSync(target, 'utf8'), '160', 'contending crash recovery loses no updates')
  assert.equal(fs.existsSync(lock), false)

  // An old timestamp is insufficient to steal from a live writer.
  fs.mkdirSync(lock)
  const marker = path.join(lock, `${process.pid}.aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.owner`)
  fs.writeFileSync(marker, '')
  fs.utimesSync(lock, old, old)
  let entered = false
  assert.throws(() => withFileLockSync(target, () => { entered = true }), /Timed out/)
  assert.equal(entered, false)
  assert.equal(fs.existsSync(marker), true, 'the live owner marker stays intact')
  fs.unlinkSync(marker)
  fs.rmdirSync(lock)

  // Model a second reaper acting on an old empty directory after replacement.
  fs.mkdirSync(lock)
  fs.utimesSync(lock, old, old)
  const originalRmdir = fs.rmdirSync
  let replaced = false
  fs.rmdirSync = function (dir, ...args) {
    if (dir === lock && !replaced) {
      replaced = true
      originalRmdir(dir)
      fs.mkdirSync(dir)
      fs.writeFileSync(marker, '')
    }
    return originalRmdir(dir, ...args)
  }
  try {
    assert.throws(() => withFileLockSync(target, () => { entered = true }), /Timed out/)
    assert.equal(entered, false, 'a late reaper cannot remove a fresh owner')
    assert.equal(fs.existsSync(marker), true)
  } finally {
    fs.rmdirSync = originalRmdir
  }
  fs.unlinkSync(marker)
  fs.rmdirSync(lock)

  // Old app file locks remain compatible while held, and are never stolen.
  fs.writeFileSync(lock, `${process.pid}\n`)
  fs.utimesSync(lock, old, old)
  assert.throws(() => withFileLockSync(target, () => { entered = true }), /Timed out/)
  assert.equal(fs.readFileSync(lock, 'utf8'), `${process.pid}\n`)
  fs.unlinkSync(lock)
  assert.throws(() => withFileLockSync(target, () => { throw new Error('fixture action failed') }), /fixture action failed/)
  assert.equal(fs.existsSync(lock), false, 'failed actions release their own lock')
  console.log('OK: crash recovery, concurrent writers, old live owners, replacement races, legacy locks, and error cleanup')
} finally {
  fs.rmSync(root, { recursive: true, force: true })
}
