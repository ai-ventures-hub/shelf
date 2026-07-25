/**
 * Smoke receipt filter + JSON/CSV export helpers.
 */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const {
  filterReceipts,
  receiptsToCsv,
  receiptsToJson,
} = require('../dist-electron/shared/receipt-export.js')

const sample = [
  {
    id: '1',
    toolId: 'a',
    toolName: 'Alpha',
    launchCommand: 'npm run dev',
    startedAt: '2026-07-25T10:00:00.000Z',
    endedAt: '2026-07-25T10:05:00.000Z',
    durationMs: 300_000,
    outcome: 'stopped',
    port: 5173,
    message: 'Stopped',
  },
  {
    id: '2',
    toolId: 'b',
    toolName: 'Beta',
    launchCommand: 'python app.py',
    startedAt: '2026-07-25T11:00:00.000Z',
    outcome: 'failed',
    message: 'Port busy',
  },
  {
    id: '3',
    toolId: 'a',
    toolName: 'Alpha',
    launchCommand: 'npm run dev',
    startedAt: '2026-07-25T12:00:00.000Z',
    outcome: 'running',
    port: 5173,
    message: 'Running · port 5173',
  },
]

const problems = filterReceipts(sample, { outcomes: ['failed', 'error', 'interrupted'] })
assert.equal(problems.length, 1)
assert.equal(problems[0].id, '2')

const alpha = filterReceipts(sample, { toolId: 'a', query: 'running' })
assert.equal(alpha.length, 1)
assert.equal(alpha[0].outcome, 'running')

const json = receiptsToJson(sample)
assert.match(json, /"version": 1/)
assert.match(json, /"exportedAt"/)
assert.match(json, /Alpha/)

const csv = receiptsToCsv(sample)
assert.ok(csv.startsWith('id,toolId,toolName,'))
assert.match(csv, /Port busy/)
assert.equal(csv.trim().split('\n').length, 4) // header + 3 rows

console.log('OK: receipt export smoke passed')
