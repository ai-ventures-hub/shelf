/** Capability intelligence smoke: migration, normalization, ranking, readiness, and gaps. */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { LibraryStore } = require('../dist-electron/shared/library-store.js')
const {
  deriveToolReadiness,
  findCapabilityMatches,
} = require('../dist-electron/shared/capability-intelligence.js')
const { CapabilityGapStore } = require('../dist-electron/shared/capability-gap-store.js')

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shelf-capabilities-'))
const existingPath = path.join(root, 'existing-tool')
fs.mkdirSync(existingPath)

const now = new Date().toISOString()
const legacyTool = {
  id: 'legacy-tool',
  name: 'Legacy Image Tool',
  description: 'Compress and resize image collections',
  tags: ['Images'],
  favorite: false,
  projectPath: existingPath,
  launchCommand: 'npm run dev',
  createdAt: now,
  updatedAt: now,
}

try {
  fs.writeFileSync(
    path.join(root, 'library.json'),
    JSON.stringify({ version: 2, tools: [legacyTool], collections: [] }, null, 2),
  )
  const library = new LibraryStore(root)
  const migrated = JSON.parse(fs.readFileSync(path.join(root, 'library.json'), 'utf8'))
  assert.equal(migrated.version, 3)
  assert.deepEqual(migrated.tools[0].capabilities, [])
  assert.deepEqual(migrated.tools[0].agentAccess, [])
  assert.ok(
    fs.readdirSync(root).some((name) => name.startsWith('library.v2-backup-')),
    'v2 migration should create a backup',
  )

  const ready = library.save({
    ...library.get('legacy-tool'),
    capabilities: [' batch optimize images ', 'Batch Optimize Images', 'convert images to WebP'],
    agentAccess: [
      {
        id: 'image-cli',
        kind: 'cli',
        entrypoint: 'npm run optimize',
        setupRequired: false,
      },
    ],
  })
  assert.deepEqual(ready.capabilities, ['batch optimize images', 'convert images to WebP'])
  assert.equal(deriveToolReadiness(ready).state, 'ready')

  const needsSetup = library.save({
    ...ready,
    id: 'needs-setup',
    name: 'Image MCP',
    capabilities: ['inspect image metadata'],
    agentAccess: [
      {
        id: 'image-mcp',
        kind: 'mcp',
        transport: 'stdio',
        entrypoint: 'node ./mcp/server.js',
        setupRequired: true,
      },
    ],
    createdAt: now,
    updatedAt: now,
  })
  assert.equal(deriveToolReadiness(needsSetup).state, 'needs_setup')

  const manual = library.save({
    ...ready,
    id: 'manual-tool',
    name: 'Manual Image Viewer',
    capabilities: ['view image contact sheets'],
    agentAccess: [],
    createdAt: now,
    updatedAt: now,
  })
  assert.equal(deriveToolReadiness(manual).state, 'manual_only')

  const unavailable = library.save({
    ...manual,
    id: 'missing-tool',
    name: 'Missing Project Tool',
    projectPath: path.join(root, 'does-not-exist'),
    createdAt: now,
    updatedAt: now,
  })
  assert.equal(deriveToolReadiness(unavailable).state, 'unavailable')

  const exact = findCapabilityMatches(library.list(), 'batch optimize images')
  assert.equal(exact[0].toolId, ready.id)
  assert.match(exact[0].reasons.join(' '), /Exact capability/)
  const natural = findCapabilityMatches(library.list(), 'I need to convert images to WebP')
  assert.equal(natural[0].toolId, ready.id)
  const filtered = findCapabilityMatches(library.list(), 'inspect image metadata', {
    accessKind: 'mcp',
  })
  assert.equal(filtered[0].toolId, needsSetup.id)
  assert.equal(findCapabilityMatches(library.list(), 'transcribe a podcast').length, 0)

  const tied = findCapabilityMatches(
    [
      { ...manual, id: 'z', name: 'Zulu', capabilities: ['render report'] },
      { ...manual, id: 'a', name: 'Alpha', capabilities: ['render report'] },
    ],
    'render report',
  )
  assert.deepEqual(tied.map((match) => match.name), ['Alpha', 'Zulu'])

  assert.throws(
    () => library.save({
      ...ready,
      agentAccess: [{
        id: 'unsafe',
        kind: 'http-api',
        entrypoint: 'https://user:password@example.com/api',
        setupRequired: false,
      }],
    }),
    /credentials|secret/i,
  )

  const gaps = new CapabilityGapStore(root)
  const first = gaps.record({
    task: 'Fill a PDF form',
    capabilities: ['fill PDF forms', 'write PDF fields'],
    reason: 'No installed tool exposes structured form editing.',
    relatedToolIds: [ready.id],
    suggestedAccess: 'mcp',
  })
  assert.equal(first.action, 'created')
  for (let index = 0; index < 6; index += 1) {
    gaps.record({
      task: `Fill PDF form request ${index}`,
      capabilities: ['write PDF fields', 'fill PDF forms'],
      reason: 'Still no structured form editor.',
    })
  }
  const deduped = gaps.list()
  assert.equal(deduped.length, 1)
  assert.equal(deduped[0].occurrenceCount, 7)
  assert.equal(deduped[0].examples.length, 5)
  gaps.updateStatus(deduped[0].id, 'resolved')
  assert.equal(gaps.list({ status: 'resolved' }).length, 1)
  gaps.record({
    task: 'The PDF form need returned',
    capabilities: ['fill PDF forms', 'write PDF fields'],
    reason: 'The capability is unavailable again.',
  })
  assert.equal(gaps.list()[0].status, 'open')
  gaps.delete(deduped[0].id)
  assert.equal(gaps.list().length, 0)

  console.log('OK: capability intelligence smoke passed')
} finally {
  fs.rmSync(root, { recursive: true, force: true })
}
