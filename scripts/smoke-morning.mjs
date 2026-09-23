/**
 * Morning board is a sort over existing records. It must not copy launch
 * commands, and it must drop events that are not still actionable.
 */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { buildMorningBoard } = require('../dist-electron/shared/morning-board')

const events = buildMorningBoard({
  receipts: [
    {
      id: 'r1',
      toolId: 'tool-1',
      toolName: 'Photo Prepper',
      launchCommand: 'SECRET=hunter2 npm start',
      startedAt: '2026-09-23T12:00:00.000Z',
      outcome: 'running',
      startedBy: { kind: 'mcp', client: 'Cursor' },
    },
    {
      id: 'r0',
      toolId: 'tool-1',
      toolName: 'Photo Prepper',
      launchCommand: 'npm start',
      startedAt: '2026-09-23T11:00:00.000Z',
      outcome: 'stopped',
      startedBy: { kind: 'gui' },
    },
  ],
  gaps: [
    {
      id: 'g1',
      capabilities: ['pdf'],
      task: 'Fill a PDF',
      reason: 'none',
      relatedToolIds: [],
      status: 'open',
      occurrenceCount: 2,
      examples: [],
      createdAt: '2026-09-23T10:00:00.000Z',
      updatedAt: '2026-09-23T13:00:00.000Z',
      lastRequestedAt: '2026-09-23T13:00:00.000Z',
    },
    {
      id: 'g2',
      capabilities: ['old'],
      task: 'Dismissed ask',
      reason: 'none',
      relatedToolIds: [],
      status: 'dismissed',
      occurrenceCount: 1,
      examples: [],
      createdAt: '2026-09-23T09:00:00.000Z',
      updatedAt: '2026-09-23T09:00:00.000Z',
      lastRequestedAt: '2026-09-23T14:00:00.000Z',
    },
  ],
  profiles: [
    {
      id: 'p1',
      name: 'Client brand',
      isDefault: false,
      tokens: {},
      modes: { light: {}, dark: {} },
      direction: '',
      assets: [],
      origin: 'agent',
      createdAt: '2026-09-23T08:00:00.000Z',
      updatedAt: '2026-09-23T12:30:00.000Z',
    },
    {
      id: 'p2',
      name: 'Mine',
      isDefault: true,
      tokens: {},
      modes: { light: {}, dark: {} },
      direction: '',
      assets: [],
      createdAt: '2026-09-23T08:00:00.000Z',
      updatedAt: '2026-09-23T15:00:00.000Z',
    },
  ],
  verifications: [
    {
      toolId: 'tool-1',
      toolName: 'Photo Prepper',
      status: 'failed',
      at: '2026-09-23T12:45:00.000Z',
      message: 'lint failed',
    },
    {
      toolId: 'tool-1',
      toolName: 'Photo Prepper',
      status: 'passed',
      at: '2026-09-23T16:00:00.000Z',
    },
  ],
  clients: [{ kind: 'cursor', lastSeenAt: '2026-09-23T12:05:00.000Z' }],
  drafts: [
    {
      id: 'd1',
      name: 'New tool',
      at: '2026-09-23T12:10:00.000Z',
      client: 'claude-code',
    },
  ],
})

const serialized = JSON.stringify(events)
assert.equal(serialized.includes('hunter2'), false)
assert.equal(serialized.includes('npm start'), false)
assert.equal(events.some((event) => event.title === 'Dismissed ask'), false)
assert.equal(events.some((event) => event.title === 'Mine'), false)
assert.equal(events.some((event) => event.detail === 'passed'), false)
assert.equal(events[0].title, 'Fill a PDF')
assert.equal(events.find((event) => event.kind === 'launch' && event.client === 'cursor')?.href, '/tools/tool-1/runs')
assert.equal(events.find((event) => event.kind === 'draft')?.client, 'claude-code')
assert.ok(events.length <= 80)
console.log('OK: morning board', events.map((event) => event.kind).join(','))
