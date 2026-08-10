/** Design Engine smoke: store durability, binding round-trip, resolution precedence, briefs. */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { DesignProfileStore } = require('../dist-electron/shared/design-profile-store.js')
const { LibraryStore } = require('../dist-electron/shared/library-store.js')
const {
  resolveDesignProfile,
  resolveProfileForGap,
} = require('../dist-electron/shared/design-resolve.js')
const {
  buildDesignBrief,
  summarizeDesignProfile,
} = require('../dist-electron/shared/design-brief.js')
const { buildGapBrief } = require('../dist-electron/shared/gap-brief.js')

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shelf-design-'))
const libRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'shelf-design-lib-'))

try {
  // --- Store creation, defaults, single-default invariant ---
  const store = new DesignProfileStore(root)
  const created = JSON.parse(fs.readFileSync(path.join(root, 'design-profiles.json'), 'utf8'))
  assert.deepEqual(created, { version: 1, profiles: [] })

  const acme = store.save({
    name: 'Acme',
    tokens: { color: { brand: { $value: '#4f6ef2', $type: 'color' } } },
    modes: { light: { color: { brand: { $value: '#3d5ce0', $type: 'color' } } } },
    direction: 'Calm and precise. SOME_TOKEN=supersecret must never leak.',
  })
  assert.equal(acme.isDefault, true, 'first profile auto-defaults')
  const beta = store.save({ name: 'Beta', direction: 'Playful.' })
  assert.equal(beta.isDefault, false)
  store.setDefault(beta.id)
  assert.equal(store.get(acme.id).isDefault, false, 'setDefault clears others')
  store.setDefault(acme.id)
  assert.equal(store.list()[0].id, acme.id, 'list() puts the default first')
  assert.ok(summarizeDesignProfile(store.get(acme.id)).includes('1 color'), 'summary counts tokens')

  // --- Asset import: copy + dedupe by basename ---
  const assetSource = path.join(root, 'mark.svg')
  fs.writeFileSync(assetSource, '<svg/>')
  store.importAsset(acme.id, assetSource, 'logo')
  store.importAsset(acme.id, assetSource, 'logo')
  const withAsset = store.get(acme.id)
  assert.equal(withAsset.assets.length, 1, 're-import dedupes by basename')
  assert.ok(fs.existsSync(withAsset.assets[0].path))
  assert.equal(withAsset.assets[0].mime, 'image/svg+xml')

  // --- Collection binding round-trip through LibraryStore normalization ---
  const library = new LibraryStore(libRoot)
  const now = new Date().toISOString()
  library.save({
    id: 'tool-a',
    name: 'Tool A',
    tags: [],
    capabilities: [],
    agentAccess: [],
    favorite: false,
    launchCommand: 'npm run dev',
    createdAt: now,
    updatedAt: now,
  })
  const boundCollection = library.saveCollection({
    id: '',
    name: 'Client work',
    toolIds: ['tool-a'],
    designProfileId: beta.id,
  })
  assert.equal(
    library.getCollection(boundCollection.id).designProfileId,
    beta.id,
    'designProfileId survives saveCollection',
  )
  // A later write cycle must not drop the binding via normalizeCollection.
  library.saveCollection({ id: '', name: 'Other', toolIds: [] })
  assert.equal(
    library.getCollection(boundCollection.id).designProfileId,
    beta.id,
    'designProfileId survives re-normalization on later writes',
  )

  // --- Resolution precedence ---
  const profiles = store.list()
  const collections = [
    library.getCollection(boundCollection.id),
    { id: 'c2', name: 'Zeta', toolIds: [], designProfileId: acme.id, createdAt: now, updatedAt: now },
  ]
  assert.equal(
    resolveDesignProfile(profiles, collections, { id: acme.id }).via,
    'id',
    'explicit id wins',
  )
  assert.equal(resolveDesignProfile(profiles, collections, { id: 'nope' }).via, 'none')
  const viaTool = resolveDesignProfile(profiles, collections, { toolId: 'tool-a' })
  assert.equal(viaTool.via, 'tool-collection')
  assert.equal(viaTool.profile.id, beta.id, "tool's collection binding beats default")
  const viaCollection = resolveDesignProfile(profiles, collections, { collectionId: 'c2' })
  assert.equal(viaCollection.via, 'collection')
  assert.equal(viaCollection.profile.id, acme.id)
  const viaDefault = resolveDesignProfile(profiles, collections, {})
  assert.equal(viaDefault.via, 'default')
  assert.equal(viaDefault.profile.id, acme.id)
  assert.equal(
    resolveDesignProfile([], [], {}).via,
    'none',
    'no profiles → none, never a phantom default',
  )

  // --- Gap resolution: related tool's collection first, else default ---
  const gap = {
    id: 'gap-1',
    capabilities: ['generate brand reports'],
    task: 'Generate brand reports',
    reason: 'No tool covers it',
    relatedToolIds: ['tool-a'],
    status: 'open',
    occurrenceCount: 1,
    examples: [{ task: 'Generate brand reports', at: now }],
    createdAt: now,
    updatedAt: now,
    lastRequestedAt: now,
  }
  assert.equal(resolveProfileForGap(gap, collections, profiles).profile.id, beta.id)
  assert.equal(
    resolveProfileForGap({ ...gap, relatedToolIds: [] }, collections, profiles).profile.id,
    acme.id,
    'gap with no related tools falls back to default',
  )

  // --- Brief rendering + masking ---
  const brief = buildDesignBrief(store.get(acme.id))
  assert.ok(brief.includes('## Design profile: Acme'))
  assert.ok(brief.includes('#4f6ef2'), 'brief carries base hex values')
  assert.ok(brief.includes('light: #3d5ce0'), 'brief carries mode overrides')
  assert.ok(brief.includes('Calm and precise'), 'brief carries direction prose')
  assert.ok(!brief.includes('supersecret'), 'direction is masked in the brief')
  assert.ok(brief.includes('SOME_TOKEN=***'))

  const composed = buildDesignBrief(store.get(acme.id), {
    designMd: { found: true, path: '/proj/DESIGN.md', content: 'Project rounded corners rule.' },
  })
  assert.ok(composed.includes('wins on conflict'), 'composed brief states precedence')
  assert.ok(composed.includes('Project rounded corners rule.'))

  // --- Gap brief Brand section ---
  const withBrand = buildGapBrief(gap, [], { profile: store.get(acme.id) })
  assert.ok(withBrand.includes('### Brand (Shelf Design Engine)'))
  assert.ok(withBrand.includes('shelf_get_design_profile'))
  assert.ok(!withBrand.includes('supersecret'), 'brand section masks direction')
  assert.ok(
    withBrand.indexOf('### Brand') < withBrand.indexOf('register it back to Shelf'),
    'register-back stays the closing section',
  )
  const withoutBrand = buildGapBrief(gap, [])
  assert.ok(!withoutBrand.includes('### Brand'), 'no profile → no Brand section')
  assert.ok(withoutBrand.includes('shelf_register_project'), 'existing sections intact')

  // --- delete(): removes profile + assets dir, never touches library.json ---
  const libraryBytes = fs.readFileSync(path.join(libRoot, 'library.json'))
  const assetDir = store.getAssetsDir(acme.id)
  assert.ok(fs.existsSync(assetDir))
  store.delete(acme.id)
  assert.equal(store.get(acme.id), undefined)
  assert.ok(!fs.existsSync(assetDir), 'delete removes the brand-assets dir')
  assert.ok(
    libraryBytes.equals(fs.readFileSync(path.join(libRoot, 'library.json'))),
    'deleting a profile never touches library.json',
  )

  // --- Corrupt-backup-reset (last: it wipes the store) ---
  fs.writeFileSync(path.join(root, 'design-profiles.json'), '{not json')
  const recovered = new DesignProfileStore(root)
  assert.equal(recovered.list().length, 0, 'corrupt file resets to empty')
  assert.ok(
    fs.readdirSync(root).some((name) => name.startsWith('design-profiles.corrupt-backup-')),
    'corrupt file is backed up before reset',
  )

  // --- Hand-edited profile with missing fields must degrade, not crash ---
  fs.writeFileSync(
    path.join(root, 'design-profiles.json'),
    JSON.stringify({
      version: 1,
      profiles: [{ id: 'hand-edited', name: 'Sparse', isDefault: true }],
    }),
  )
  const sparseStore = new DesignProfileStore(root)
  const sparse = sparseStore.get('hand-edited')
  assert.deepEqual(sparse.modes, { light: {}, dark: {} }, 'missing modes normalize to empty')
  assert.equal(sparse.direction, '', 'missing direction normalizes to empty string')
  assert.ok(buildDesignBrief(sparse).includes('Sparse'), 'sparse profile still renders a brief')
  assert.ok(
    buildGapBrief(gap, [], { profile: sparse }).includes('### Brand'),
    'sparse profile still renders a gap-brief Brand section',
  )

  console.log('OK: design engine store, binding, resolution, briefs')
} finally {
  fs.rmSync(root, { recursive: true, force: true })
  fs.rmSync(libRoot, { recursive: true, force: true })
}
