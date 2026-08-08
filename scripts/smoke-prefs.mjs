/**
 * Smoke PrefsStore uiMode: defaults, round-trip, and legacy prefs.json
 * (no uiMode key) resolving to 'developer' so existing users see no change.
 * Requires: tsc -p tsconfig.electron.json (smoke:all compile step).
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { PrefsStore } = require('../dist-electron/shared/prefs-store.js')

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shelf-prefs-'))

try {
  // Fresh install defaults to developer.
  const store = new PrefsStore(root)
  assert.equal(store.get().uiMode, 'developer')

  // Round-trip: update persists and re-reads.
  const updated = store.update({ uiMode: 'simple' })
  assert.equal(updated.uiMode, 'simple')
  assert.equal(new PrefsStore(root).get().uiMode, 'simple')

  // Legacy prefs.json without the key (pre-0.7 file) reads back developer.
  const legacyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'shelf-prefs-legacy-'))
  fs.mkdirSync(legacyRoot, { recursive: true })
  fs.writeFileSync(
    path.join(legacyRoot, 'prefs.json'),
    JSON.stringify({ appearance: 'dark', viewMode: 'list' }),
  )
  const legacy = new PrefsStore(legacyRoot)
  const legacyPrefs = legacy.get()
  assert.equal(legacyPrefs.uiMode, 'developer')
  // Untouched legacy values survive the defaults spread.
  assert.equal(legacyPrefs.appearance, 'dark')
  assert.equal(legacyPrefs.viewMode, 'list')
  fs.rmSync(legacyRoot, { recursive: true, force: true })

  console.log('OK: prefs uiMode smoke passed')
} finally {
  fs.rmSync(root, { recursive: true, force: true })
}
