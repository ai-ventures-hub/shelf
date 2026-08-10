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
  const manualReadiness = deriveToolReadiness(manual)
  assert.equal(manualReadiness.state, 'manual_only')
  // manual_only must never read as "cannot launch" to an agent.
  assert.equal(manualReadiness.launchable, true)
  assert.ok(manualReadiness.shelfActions.includes('shelf_launch_tool'))
  assert.match(manualReadiness.summary, /shelf_launch_tool/)
  assert.equal(manualReadiness.childInterface, 'none')

  const unavailable = library.save({
    ...manual,
    id: 'missing-tool',
    name: 'Missing Project Tool',
    projectPath: path.join(root, 'does-not-exist'),
    createdAt: now,
    updatedAt: now,
  })
  const unavailableReadiness = deriveToolReadiness(unavailable)
  assert.equal(unavailableReadiness.state, 'unavailable')
  assert.equal(unavailableReadiness.launchable, false)

  const exact = findCapabilityMatches(library.list(), 'batch optimize images')
  assert.equal(exact[0].toolId, ready.id)
  assert.match(exact[0].reasons.join(' '), /Exact capability/)
  assert.equal(exact[0].suggestedAction, 'launch')
  assert.equal(exact[0].interaction, 'agent_direct')
  assert.ok(Array.isArray(exact[0].access) && exact[0].access.length > 0)

  const manualMatch = findCapabilityMatches(library.list(), 'view image contact sheets')
  assert.equal(manualMatch[0].toolId, manual.id)
  // Deprecated 'manual_use' is never emitted; GUI nuance moves to `interaction`.
  assert.equal(manualMatch[0].suggestedAction, 'launch')
  assert.equal(manualMatch[0].interaction, 'human_ui')
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

  // v0.9: brief generator (composable sections) + suggest-only matching.
  const { buildGapBrief, buildGapBriefSections } = require('../dist-electron/shared/gap-brief.js')
  const { suggestGapResolutions } = require('../dist-electron/shared/gap-suggest.js')

  const briefGap = gaps.record({
    task: 'Fill a PDF form',
    capabilities: ['fill PDF forms', 'write PDF fields'],
    reason: 'No installed tool exposes structured form editing.',
    relatedToolIds: [ready.id],
    suggestedAccess: 'mcp',
  }).gap
  const sections = buildGapBriefSections(briefGap, [ready])
  assert.deepEqual(
    sections.map((section) => section.id),
    ['task', 'capabilities', 'related-tools', 'register-back'],
  )
  const brief = buildGapBrief(briefGap, [ready])
  assert.match(brief, /fill PDF forms/)
  assert.match(brief, /shelf_register_project/)
  assert.ok(brief.includes(briefGap.id), 'brief must carry the gap id for update calls')
  assert.match(brief, /Legacy Image Tool/)
  assert.match(brief, /Do NOT mark the gap resolved/)

  // Only tools created/edited at-or-after the gap suggest; matching is
  // case-insensitive; dismissal and non-open statuses suppress.
  const olderStamp = new Date(Date.parse(briefGap.createdAt) - 60_000).toISOString()
  const newerStamp = new Date(Date.parse(briefGap.createdAt) + 60_000).toISOString()
  const newTool = {
    ...ready,
    id: 'new-cap-tool',
    name: 'PDF Filler',
    capabilities: ['Fill PDF Forms'],
    updatedAt: newerStamp,
  }
  const oldTool = {
    ...ready,
    id: 'old-cap-tool',
    name: 'Old PDF Tool',
    capabilities: ['fill PDF forms'],
    updatedAt: olderStamp,
  }
  const matched = suggestGapResolutions([briefGap], [newTool, oldTool])
  assert.equal(matched.length, 1)
  assert.equal(matched[0].toolId, 'new-cap-tool')
  assert.deepEqual(matched[0].matched, ['fill PDF forms'])
  assert.equal(matched[0].total, 2)

  const afterDismiss = gaps.dismissSuggestion(briefGap.id, 'new-cap-tool')
  assert.equal(suggestGapResolutions([afterDismiss], [newTool]).length, 0)

  const planned = gaps.update(briefGap.id, {
    status: 'planned',
    relatedToolIds: ['another-tool'],
  })
  assert.equal(planned.status, 'planned')
  assert.ok(
    planned.relatedToolIds.includes(ready.id) &&
      planned.relatedToolIds.includes('another-tool'),
    'update must merge relatedToolIds, never replace',
  )
  assert.equal(
    suggestGapResolutions([{ ...planned, status: 'resolved' }], [newTool]).length,
    0,
  )

  console.log('OK: capability intelligence smoke passed')
} finally {
  fs.rmSync(root, { recursive: true, force: true })
}
