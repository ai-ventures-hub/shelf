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

  // --- Asset import: copy + dedupe by basename, atomic (no tmp residue) ---
  const assetSource = path.join(root, 'mark.svg')
  fs.writeFileSync(assetSource, '<svg/>')
  store.importAsset(acme.id, assetSource, 'logo')
  store.importAsset(acme.id, assetSource, 'logo')
  const withAsset = store.get(acme.id)
  assert.equal(withAsset.assets.length, 1, 're-import dedupes by basename')
  assert.ok(fs.existsSync(withAsset.assets[0].path))
  assert.equal(withAsset.assets[0].mime, 'image/svg+xml')
  assert.ok(
    !fs.readdirSync(store.getAssetsDir(acme.id)).some((name) => name.includes('.tmp-')),
    'importAsset leaves no tmp residue',
  )

  // --- removeAsset: record filtered, file unlinked only inside brand-assets ---
  const secondSource = path.join(root, 'wordmark.png')
  fs.writeFileSync(secondSource, 'png-bytes')
  store.importAsset(acme.id, secondSource, 'wordmark')
  const wordmark = store.get(acme.id).assets.find((a) => a.path.endsWith('wordmark.png'))
  store.removeAsset(acme.id, wordmark.path)
  assert.equal(store.get(acme.id).assets.length, 1, 'removeAsset filters the record')
  assert.ok(!fs.existsSync(wordmark.path), 'removeAsset unlinks the file')
  assert.ok(fs.existsSync(store.get(acme.id).assets[0].path), 'surviving asset intact')
  const outside = path.join(root, 'outside.txt')
  fs.writeFileSync(outside, 'keep me')
  store.removeAsset(acme.id, outside) // not in assets; also outside brand-assets
  assert.ok(fs.existsSync(outside), 'paths outside brand-assets are never unlinked')

  // --- save with explicit assets (kind-change path) round-trips ---
  const currentAssets = store.get(acme.id).assets
  store.save({
    id: acme.id,
    name: 'Acme',
    assets: currentAssets.map((a) => ({ ...a, kind: 'icon' })),
  })
  assert.equal(store.get(acme.id).assets[0].kind, 'icon', 'explicit assets save round-trips')

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

  // --- Ownership (origin) semantics behind the agent write path ---
  const agentOwned = store.save({
    name: 'Agent Draft',
    origin: 'agent',
    sourceNote: 'https://example.com TOKEN=supersecret',
  })
  assert.equal(agentOwned.origin, 'agent', 'agent origin stored')
  const preserved = store.save({ id: agentOwned.id, name: 'Agent Draft', direction: 'x' })
  assert.equal(preserved.origin, 'agent', 'omitted origin preserves ownership')
  const briefWithSource = buildDesignBrief(preserved)
  assert.ok(briefWithSource.includes('Source: https://example.com'), 'brief shows sourceNote')
  assert.ok(!briefWithSource.includes('supersecret'), 'sourceNote is masked in the brief')
  const transferred = store.save({ id: agentOwned.id, name: 'Agent Draft', origin: 'user' })
  assert.equal(transferred.origin, undefined, "GUI save ('user') clears agent ownership")
  // Promotion is adoption: setDefault must also strip agent ownership.
  const reAgented = store.save({ id: agentOwned.id, name: 'Agent Draft', origin: 'agent' })
  assert.equal(reAgented.origin, 'agent')
  const adopted = store.setDefault(agentOwned.id)
  assert.equal(adopted.origin, undefined, 'Make default transfers ownership to the user')
  store.delete(agentOwned.id)

  // --- Delete-the-default: store contract behind the GUI successor flow ---
  const gamma = store.save({ name: 'Gamma' })
  store.setDefault(gamma.id)
  store.delete(gamma.id)
  assert.equal(store.getDefault(), undefined, 'deleting the default leaves none')
  const promoted = store.setDefault(beta.id)
  assert.equal(promoted.isDefault, true, 'a survivor can be promoted afterwards')

  // --- upsertFromAgent: ownership policy enforced inside the store lock ---
  const draft = store.upsertFromAgent({ name: 'Extracted', direction: 'Bold.' })
  assert.equal(draft.action, 'created')
  assert.equal(draft.profile.origin, 'agent')
  assert.equal(draft.profile.isDefault, false, 'agent draft never claims the default')
  const redraft = store.upsertFromAgent({ name: 'extracted', direction: 'Bolder.' })
  assert.equal(redraft.action, 'updated', 're-extraction matches names case-insensitively')
  assert.equal(redraft.profile.id, draft.profile.id)
  assert.throws(
    () => store.upsertFromAgent({ name: 'Beta' }),
    /user-owned/,
    'agent cannot claim a user profile by name',
  )
  assert.throws(
    () => store.upsertFromAgent({ id: beta.id, name: 'Beta' }),
    /user-owned/,
    'agent cannot claim a user profile by id',
  )
  assert.throws(
    () => store.upsertFromAgent({ id: draft.profile.id, name: 'Beta' }),
    /already exists/,
    'rename-by-id onto a user profile name is refused',
  )
  store.save({ id: draft.profile.id, name: 'Extracted', origin: 'user' })
  assert.throws(
    () => store.upsertFromAgent({ id: draft.profile.id, name: 'Extracted' }),
    /user-owned/,
    'a GUI save locks the agent out of its old draft',
  )
  store.delete(draft.profile.id)

  // --- Bare vendor tokens (no KEY= assignment) are masked in briefs ---
  const bareToken = `ghp_${'a'.repeat(36)}`
  const leaky = store.save({ name: 'Leaky', direction: `CI uses ${bareToken} today.` })
  assert.ok(
    !buildDesignBrief(leaky).includes(bareToken),
    'bare vendor tokens are masked in briefs',
  )
  store.delete(leaky.id)
  // Mid-text PEM headers must mask too (a \b boundary once required a word
  // char before the dashes, so anything after a space/newline slipped by).
  const pem = store.save({
    name: 'Pem',
    direction: 'key follows:\n-----BEGIN RSA PRIVATE KEY-----\nMIIabc',
  })
  assert.ok(
    !buildDesignBrief(pem).includes('BEGIN RSA PRIVATE KEY'),
    'mid-text PEM headers are masked in briefs',
  )
  store.delete(pem.id)

  // --- Corrupt-backup-reset (last: it wipes the store) ---
  fs.writeFileSync(path.join(root, 'design-profiles.json'), '{not json')
  const recovered = new DesignProfileStore(root)
  assert.equal(recovered.list().length, 0, 'corrupt file resets to empty')
  assert.ok(
    fs.readdirSync(root).some((name) => name.startsWith('design-profiles.corrupt-backup-')),
    'corrupt file is backed up before reset',
  )

  // --- Traversal-shaped ids: healed on read, refused at the filesystem ---
  fs.writeFileSync(
    path.join(root, 'design-profiles.json'),
    JSON.stringify({
      version: 1,
      profiles: [{ id: '../../evil-escape', name: 'Traversal' }],
    }),
  )
  const traversalStore = new DesignProfileStore(root)
  const healed = traversalStore.findByName('Traversal')
  assert.ok(healed, 'traversal profile still loads')
  assert.ok(
    /^[0-9a-f-]{36}$/.test(healed.id),
    `planted traversal id is healed to a UUID (${healed.id})`,
  )
  assert.throws(
    () => traversalStore.importAsset('../../evil-escape', assetSource, 'logo'),
    /Invalid design profile id/,
    'importAsset refuses traversal ids before touching the filesystem',
  )
  assert.throws(
    () => traversalStore.importAsset(healed.id + '-nope', assetSource, 'logo'),
    /not found/,
    'importAsset checks existence before any write',
  )
  assert.throws(
    () => traversalStore.delete('../../evil-escape'),
    /Invalid design profile id/,
    'delete refuses traversal ids before deriving an rm target',
  )
  traversalStore.delete(healed.id)

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
