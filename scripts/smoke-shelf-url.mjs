/**
 * Smoke shelf:// URL parsing (shared, no Electron required after compile).
 */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { parseShelfUrl } = require('../dist-electron/shared/shelf-url.js')

assert.equal(parseShelfUrl('shelf://open').action, 'open')
assert.equal(parseShelfUrl('shelf://quick-open').action, 'quick-open')
assert.equal(parseShelfUrl('shelf://settings').route, '/settings')

const tool = parseShelfUrl('shelf://tools/abc-123')
assert.equal(tool.action, 'navigate')
assert.equal(tool.toolId, 'abc-123')
assert.equal(tool.route, '/tools/abc-123')

const launch = parseShelfUrl('shelf://tools/abc-123/launch')
assert.equal(launch.action, 'launch')
assert.equal(launch.toolId, 'abc-123')

const stop = parseShelfUrl('shelf://tools/abc-123/stop')
assert.equal(stop.action, 'stop')

const byName = parseShelfUrl('shelf://launch?name=Photo%20Prepper')
assert.equal(byName.action, 'launch')
assert.equal(byName.toolName, 'Photo Prepper')

const pathLed = parseShelfUrl('shelf:///tools/xyz/restart')
assert.equal(pathLed.action, 'restart')
assert.equal(pathLed.toolId, 'xyz')

assert.equal(parseShelfUrl('https://example.com').action, 'unknown')

console.log('OK: shelf:// URL parse smoke passed')
