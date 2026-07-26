/** Verify corrupt library recovery is backed up and later corruption is never overwritten. */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { LibraryStore } = require('../dist-electron/shared/library-store.js')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shelf-library-safety-'))
const libraryPath = path.join(root, 'library.json')

try {
  const corrupt = '{ definitely-not-json'
  fs.writeFileSync(libraryPath, corrupt, 'utf8')
  const store = new LibraryStore(root)
  assert.deepEqual(store.list(), [])

  const backups = fs
    .readdirSync(root)
    .filter((name) => name.startsWith('library.corrupt-backup-'))
  assert.equal(backups.length, 1)
  assert.equal(fs.readFileSync(path.join(root, backups[0]), 'utf8'), corrupt)

  // If corruption happens while Shelf is running, reads fail closed rather than
  // returning an empty library that a later save could persist over user data.
  fs.writeFileSync(libraryPath, '{ damaged-later', 'utf8')
  assert.throws(() => store.list(), /could not read library\.json/)
  assert.equal(fs.readFileSync(libraryPath, 'utf8'), '{ damaged-later')

  console.log('OK: corrupt library is backed up and never silently overwritten')
} finally {
  fs.rmSync(root, { recursive: true, force: true })
}
