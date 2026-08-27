/**
 * Team Tools catalog (1.4) smoke — engine level, over a local git daemon.
 *
 *  1. Hostile catalog normalization: wrong shape/version refused; entries
 *     with a non-allow-listed repo dropped and counted; invisible characters
 *     stripped from names; duplicate repos collapsed; oversized lists capped.
 *  2. Entry upsert is keyed on REPO, so renaming a tool updates its row
 *     instead of adding a second one.
 *  3. Subscribe end-to-end: clone a catalog repo, read entries, and hand an
 *     entry's repo to the existing receive pipeline (stage → consent shape).
 *  4. Publish: "Share with team" commits and pushes an entry, and a second
 *     Mac subscribing to the same URL sees it.
 *  5. Refresh never destroys an unpushed local entry: a local commit plus a
 *     moved remote leaves the commit intact and flags hasUnpushedEntry.
 *  6. A catalog id can never aim git at a path outside the clones root.
 *
 * Requires: tsc -p tsconfig.electron.json.
 */
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shelf-catalog-'))
// Isolate from the developer's real git identity/config, and give commits an
// author so publish works the same on a bare CI runner.
const gitConfig = path.join(tmp, 'gitconfig')
fs.writeFileSync(
  gitConfig,
  '[user]\n\tname = Shelf Smoke\n\temail = smoke@example.invalid\n[init]\n\tdefaultBranch = main\n',
)
process.env.GIT_CONFIG_GLOBAL = gitConfig
process.env.GIT_CONFIG_NOSYSTEM = '1'

const {
  emptyCatalog,
  normalizeCatalog,
  readCatalogFile,
  readRawCatalog,
  serializeCatalog,
  upsertCatalogEntry,
  writeCatalogFile,
} = require('../dist-electron/shared/team-catalog')
const { TeamCatalogStore, nameFromUrl } = require('../dist-electron/shared/team-catalog-store')
const { addCatalog, publishToCatalog, syncCatalog } = require('../dist-electron/shared/team-catalog-sync')
const { stageSharedTool, discardStagedShare } = require('../dist-electron/shared/tool-share')
const { writeManifest, buildManifest } = require('../dist-electron/shared/tool-manifest')

const cleanup = []
const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { stdio: 'pipe' })

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => resolve(port))
    })
  })
}

function ok(label) {
  console.log(`  ok  ${label}`)
}

async function main() {
  // ---------------------------------------------------------------------
  // 1. Hostile normalization.
  // ---------------------------------------------------------------------
  assert.throws(() => normalizeCatalog('nope'), /not a JSON object/)
  assert.throws(() => normalizeCatalog([]), /not a JSON object/)
  assert.throws(() => normalizeCatalog({ shelfCatalog: 99, tools: [] }), /Unsupported catalog version/)

  const hostile = normalizeCatalog({
    shelfCatalog: 1,
    name: 'Team\u200b Tools',
    tools: [
      { name: 'Local file', repo: 'file:///etc/passwd' },
      { name: 'Ext transport', repo: 'ext::sh -c whoami' },
      { name: 'Flag', repo: '--upload-pack=touch /tmp/pwned' },
      { name: 'No repo' },
      { name: '\u200b\u200b\u200b', repo: 'https://example.com/a.git' },
      {
        name: 'Good\u200btool',
        description: 'Fine\u0007 tool',
        capabilities: ['a', 'b'],
        repo: 'https://example.com/good.git',
      },
      { name: 'Duplicate', repo: 'https://example.com/GOOD.git' },
      'not an object',
    ],
  })
  assert.equal(hostile.catalog.tools.length, 1, 'only the usable entry survives')
  const survivor = hostile.catalog.tools[0]
  assert.equal(survivor.name, 'Goodtool', 'invisible characters stripped from the name')
  assert.ok(
    !/[\u0000-\u001f\u007f-\u009f]/.test(survivor.description),
    'control characters stripped from description',
  )
  assert.equal(hostile.catalog.name, 'Team Tools', 'catalog name stripped too')
  assert.ok(hostile.warnings.some((w) => /could not be read/.test(w)), 'skipped rows are reported')
  ok('hostile catalog normalizes to bounded, display-safe entries')

  const many = normalizeCatalog({
    shelfCatalog: 1,
    tools: Array.from({ length: 600 }, (_, i) => ({
      name: `Tool ${i}`,
      repo: `https://example.com/t${i}.git`,
      capabilities: Array.from({ length: 80 }, (_, c) => `cap-${c}`),
    })),
  })
  assert.equal(many.catalog.tools.length, 500, 'entry count capped')
  assert.equal(many.catalog.tools[0].capabilities.length, 40, 'capability list capped')
  assert.ok(many.warnings.some((w) => /more than 500/.test(w)))
  ok('oversized catalogs are capped, not trusted')

  // ---------------------------------------------------------------------
  // 2. Upsert is keyed on repo.
  // ---------------------------------------------------------------------
  let cat = emptyCatalog('Team')
  cat = upsertCatalogEntry(cat, {
    name: 'Image Prepper',
    capabilities: ['resize'],
    repo: 'https://example.com/ip.git',
  }).catalog
  const renamed = upsertCatalogEntry(cat, {
    name: 'Image Prepper 2',
    capabilities: ['resize'],
    repo: 'https://example.com/ip.git',
  })
  assert.equal(renamed.action, 'updated')
  assert.equal(renamed.catalog.tools.length, 1, 'a rename updates the row, never duplicates it')
  assert.equal(renamed.catalog.tools[0].name, 'Image Prepper 2')
  assert.ok(serializeCatalog(renamed.catalog).endsWith('\n'), 'serialized catalog is commit-shaped')
  ok('entry upsert keys on repo')

  // ---------------------------------------------------------------------
  // Fixtures: a tool repo and a catalog repo, both served by git daemon.
  // ---------------------------------------------------------------------
  const daemonRoot = path.join(tmp, 'daemon')
  fs.mkdirSync(daemonRoot, { recursive: true })

  const toolBare = path.join(daemonRoot, 'image-prepper.git')
  const catalogBare = path.join(daemonRoot, 'team-catalog.git')
  for (const bare of [toolBare, catalogBare]) {
    execFileSync('git', ['init', '--bare', '-q', '--initial-branch=main', bare])
    fs.writeFileSync(path.join(bare, 'git-daemon-export-ok'), '')
  }

  // The shared tool: a project with a manifest, as "Share" would have left it.
  const toolProject = path.join(tmp, 'image-prepper')
  fs.mkdirSync(toolProject, { recursive: true })
  fs.writeFileSync(path.join(toolProject, 'package.json'), JSON.stringify({ name: 'image-prepper' }))
  const manifest = buildManifest(
    {
      id: 'tool-1',
      name: 'Image Prepper',
      description: 'Batch resize',
      launchCommand: 'npm run dev',
      projectPath: toolProject,
      tags: [],
      capabilities: ['batch-optimize images'],
      agentAccess: [],
      env: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    { appVersion: '1.4.0-smoke' },
  )
  assert.ok(manifest.ok !== false, 'manifest built')
  writeManifest(toolProject, manifest.manifest)
  git(toolProject, 'init', '-q', '--initial-branch=main')
  git(toolProject, 'add', '-A')
  git(toolProject, 'commit', '-q', '-m', 'Initial tool')
  git(toolProject, 'push', '-q', `file://${toolBare}`, 'main')
  execFileSync('git', ['-C', toolBare, 'symbolic-ref', 'HEAD', 'refs/heads/main'])

  // The catalog repo starts with one entry pointing at the tool.
  const port = await freePort()
  const toolUrl = `git://127.0.0.1:${port}/image-prepper.git`
  const catalogUrl = `git://127.0.0.1:${port}/team-catalog.git`

  const catalogSeed = path.join(tmp, 'catalog-seed')
  fs.mkdirSync(catalogSeed, { recursive: true })
  writeCatalogFile(catalogSeed, {
    shelfCatalog: 1,
    name: 'GWP Tools',
    tools: [
      {
        name: 'Image Prepper',
        description: 'Batch resize',
        capabilities: ['batch-optimize images'],
        repo: toolUrl,
      },
    ],
  })
  git(catalogSeed, 'init', '-q', '--initial-branch=main')
  git(catalogSeed, 'add', '-A')
  git(catalogSeed, 'commit', '-q', '-m', 'Start the catalog')
  git(catalogSeed, 'push', '-q', `file://${catalogBare}`, 'main')
  execFileSync('git', ['-C', catalogBare, 'symbolic-ref', 'HEAD', 'refs/heads/main'])

  const daemon = spawn(
    'git',
    [
      'daemon',
      '--reuseaddr',
      `--port=${port}`,
      '--listen=127.0.0.1',
      `--base-path=${daemonRoot}`,
      '--export-all',
      '--enable=receive-pack',
      daemonRoot,
    ],
    { stdio: 'ignore' },
  )
  cleanup.push(() => daemon.kill('SIGTERM'))
  await new Promise((resolve) => setTimeout(resolve, 600))

  // ---------------------------------------------------------------------
  // 3. Subscribe, then feed an entry to the existing receive pipeline.
  // ---------------------------------------------------------------------
  const rootA = path.join(tmp, 'mac-a')
  fs.mkdirSync(rootA, { recursive: true })
  const storeA = new TeamCatalogStore(rootA)
  const added = await addCatalog(catalogUrl, storeA)
  assert.equal(added.empty, false)
  assert.equal(added.count, 1)
  assert.equal(added.catalog.name, 'GWP Tools', 'display name comes from the catalog file')
  assert.equal(added.catalog.entries[0].repo, toolUrl)
  ok('subscribe clones the catalog and reads its entries')

  assert.equal(nameFromUrl('https://github.com/team/tools.git'), 'github.com/team/tools')
  ok('catalog display name falls back to host/path')

  const stage = await stageSharedTool({ kind: 'git', repo: added.catalog.entries[0].repo }, {
    dataRoot: rootA,
    toolsRoot: path.join(tmp, 'tools-a'),
  })
  assert.equal(stage.manifest.name, 'Image Prepper', 'install goes through the normal consent stage')
  assert.equal(stage.source.kind, 'git')
  discardStagedShare(stage, rootA)
  ok('an entry installs through the existing stage → consent path')

  // Only catalog.json is ever read out of a catalog clone.
  const cloneDir = storeA.clonePath(added.catalog.id)
  assert.ok(fs.existsSync(path.join(cloneDir, 'catalog.json')))
  ok('catalog clone lives under the data root')

  // ---------------------------------------------------------------------
  // 4. Publish from a second Mac, and see it from the first.
  // ---------------------------------------------------------------------
  const rootB = path.join(tmp, 'mac-b')
  fs.mkdirSync(rootB, { recursive: true })
  const storeB = new TeamCatalogStore(rootB)
  const subB = await addCatalog(catalogUrl, storeB)

  const published = await publishToCatalog(
    subB.catalog.id,
    {
      name: 'Doc Converter',
      description: 'One-shot pdf to text',
      capabilities: ['convert documents'],
      repo: 'https://example.com/doc-converter.git',
    },
    storeB,
  )
  assert.equal(published.action, 'added')
  assert.equal(published.pushed, true, `push should succeed: ${published.pushProblem || ''}`)
  assert.equal(published.count, 2)
  ok('share with team commits and pushes an entry')

  const refreshedA = await syncCatalog(added.catalog.id, storeA)
  assert.equal(refreshedA.count, 2, 'the other Mac sees the new entry after a refresh')
  assert.ok(refreshedA.catalog.entries.some((e) => e.name === 'Doc Converter'))
  ok('a teammate sees the published entry on refresh')

  // Re-publishing the same repo updates in place.
  const again = await publishToCatalog(
    subB.catalog.id,
    {
      name: 'Doc Converter (fast)',
      capabilities: ['convert documents'],
      repo: 'https://example.com/doc-converter.git',
    },
    storeB,
  )
  assert.equal(again.action, 'updated')
  assert.equal(again.count, 2, 'update never grows the catalog')
  ok('re-publishing updates the existing row')

  // ---------------------------------------------------------------------
  // 5. Refresh preserves an unpushed local entry.
  // ---------------------------------------------------------------------
  // Mac A commits locally (as a failed push would leave it) while the remote
  // moves on from Mac B.
  const dirA = storeA.clonePath(added.catalog.id)
  await syncCatalog(added.catalog.id, storeA)
  const localOnly = readCatalogFile(dirA)
  writeCatalogFile(
    dirA,
    upsertCatalogEntry(localOnly.catalog, {
      name: 'Local Only',
      capabilities: [],
      repo: 'https://example.com/local-only.git',
    }).catalog,
  )
  git(dirA, 'add', '-A')
  git(dirA, 'commit', '-q', '-m', 'Local entry that never got pushed')
  const localHead = git(dirA, 'rev-parse', 'HEAD').toString().trim()

  await publishToCatalog(
    subB.catalog.id,
    { name: 'Third Tool', capabilities: [], repo: 'https://example.com/third.git' },
    storeB,
  )

  const afterDiverge = await syncCatalog(added.catalog.id, storeA)
  assert.equal(
    git(dirA, 'rev-parse', 'HEAD').toString().trim(),
    localHead,
    'refresh must never reset away a local commit',
  )
  assert.equal(afterDiverge.catalog.hasUnpushedEntry, true, 'the user is told about the local entry')
  assert.ok(
    afterDiverge.catalog.entries.some((e) => e.name === 'Local Only'),
    'the unpushed entry is still listed',
  )
  ok('refresh keeps an unpushed entry and flags it')

  // The flag must survive a refresh where the remote HASN'T moved: the
  // ff-merge of an ancestor succeeds trivially, and reading "unpushed" off
  // the merge result alone would clear the warning while the entry was still
  // sitting in this clone.
  const quiet = await syncCatalog(added.catalog.id, storeA)
  assert.equal(quiet.catalog.hasUnpushedEntry, true, 'flag survives a no-op refresh')
  assert.equal(
    git(dirA, 'rev-parse', 'HEAD').toString().trim(),
    localHead,
    'a no-op refresh still leaves the local commit alone',
  )
  ok('the unpushed flag survives a refresh with an unmoved remote')

  // Concurrent refresh + publish must not put two git processes in one
  // work tree.
  const racers = await Promise.all([
    syncCatalog(subB.catalog.id, storeB),
    publishToCatalog(
      subB.catalog.id,
      { name: 'Race Tool', capabilities: [], repo: 'https://example.com/race.git' },
      storeB,
    ),
    syncCatalog(subB.catalog.id, storeB),
  ])
  assert.ok(racers[1].pushed, `concurrent publish should still push: ${racers[1].pushProblem || ''}`)
  const afterRace = await syncCatalog(subB.catalog.id, storeB)
  assert.ok(
    afterRace.catalog.entries.some((e) => e.name === 'Race Tool'),
    'the racing publish landed',
  )
  ok('refresh and publish serialize per catalog')

  // ---------------------------------------------------------------------
  // 6. Publish edits the team's file in place: rows and keys this Shelf
  //    can't use must survive someone else's publish.
  // ---------------------------------------------------------------------
  // Someone hand-adds a row with extra keys, plus a row Shelf's allow-list
  // can't fetch. Neither is Shelf's to delete.
  const handEdit = path.join(tmp, 'hand-edit')
  execFileSync('git', ['clone', '-q', `file://${catalogBare}`, handEdit])
  const handRaw = JSON.parse(fs.readFileSync(path.join(handEdit, 'catalog.json'), 'utf8'))
  handRaw.maintainer = 'ops@example.invalid'
  handRaw.tools.push({
    name: 'Deploy Bot',
    repo: 'https://git.internal/deploy.git',
    owner: 'ops',
    docs: 'https://wiki/deploy',
  })
  handRaw.tools.push({ name: 'Legacy', repo: 'file:///srv/legacy.git' })
  fs.writeFileSync(path.join(handEdit, 'catalog.json'), `${JSON.stringify(handRaw, null, 2)}\n`)
  git(handEdit, 'add', '-A')
  git(handEdit, 'commit', '-q', '-m', 'Hand-edited rows')
  git(handEdit, 'push', '-q', `file://${catalogBare}`, 'main')

  await publishToCatalog(
    subB.catalog.id,
    { name: 'After Hand Edit', capabilities: [], repo: 'https://example.com/after.git' },
    storeB,
  )
  const afterPublish = readRawCatalog(storeB.clonePath(subB.catalog.id))
  assert.equal(afterPublish.doc.maintainer, 'ops@example.invalid', 'unknown top-level keys survive')
  const deployRow = afterPublish.tools.find((t) => t.repo === 'https://git.internal/deploy.git')
  assert.ok(deployRow, 'a row Shelf did not touch survives a publish')
  assert.equal(deployRow.owner, 'ops', 'unknown entry keys survive')
  assert.equal(deployRow.docs, 'https://wiki/deploy')
  assert.ok(
    afterPublish.tools.some((t) => t.repo === 'file:///srv/legacy.git'),
    'a row this Shelf refuses to fetch is still not deleted from the team file',
  )
  ok('publish preserves rows and keys the normalizer drops')

  // ---------------------------------------------------------------------
  // 7. A clone is only reused when its origin is the record's url.
  // ---------------------------------------------------------------------
  const otherBare = path.join(daemonRoot, 'other-catalog.git')
  execFileSync('git', ['init', '--bare', '-q', '--initial-branch=main', otherBare])
  fs.writeFileSync(path.join(otherBare, 'git-daemon-export-ok'), '')
  const otherSeed = path.join(tmp, 'other-seed')
  fs.mkdirSync(otherSeed, { recursive: true })
  writeCatalogFile(otherSeed, {
    shelfCatalog: 1,
    name: 'Other Team',
    tools: [{ name: 'Only Here', capabilities: [], repo: 'https://example.com/only-here.git' }],
  })
  git(otherSeed, 'init', '-q', '--initial-branch=main')
  git(otherSeed, 'add', '-A')
  git(otherSeed, 'commit', '-q', '-m', 'Other catalog')
  git(otherSeed, 'push', '-q', `file://${otherBare}`, 'main')
  execFileSync('git', ['-C', otherBare, 'symbolic-ref', 'HEAD', 'refs/heads/main'])
  const otherUrl = `git://127.0.0.1:${port}/other-catalog.git`

  // Mac A still holds an unpushed entry, so repointing must refuse rather
  // than silently discard it.
  storeA.update(added.catalog.id, { url: otherUrl })
  await assert.rejects(
    () => syncCatalog(added.catalog.id, storeA),
    /never pushed/,
    'a repointed catalog with an unpushed entry is refused, not wiped',
  )
  ok('repointing a catalog never silently drops an unpushed entry')

  const rootC = path.join(tmp, 'mac-c')
  fs.mkdirSync(rootC, { recursive: true })
  const storeC = new TeamCatalogStore(rootC)
  const subC = await addCatalog(catalogUrl, storeC)
  storeC.update(subC.catalog.id, { url: otherUrl })
  const repointed = await syncCatalog(subC.catalog.id, storeC)
  assert.ok(
    repointed.catalog.entries.some((e) => e.name === 'Only Here'),
    'a repointed catalog fetches the NEW repo, not the old clone',
  )
  assert.ok(
    !repointed.catalog.entries.some((e) => e.name === 'Image Prepper'),
    'entries from the old repo are gone',
  )
  ok('a clone is only reused when its origin matches the url')

  // ---------------------------------------------------------------------
  // 8. A diverged push recovers instead of dead-ending.
  // ---------------------------------------------------------------------
  const rootD = path.join(tmp, 'mac-d')
  fs.mkdirSync(rootD, { recursive: true })
  const storeD = new TeamCatalogStore(rootD)
  const subD = await addCatalog(catalogUrl, storeD)
  const dirD = storeD.clonePath(subD.catalog.id)

  // D commits an entry that never reached the remote...
  const localRaw = readRawCatalog(dirD)
  localRaw.tools.push({ name: 'Stranded', capabilities: [], repo: 'https://example.com/stranded.git' })
  localRaw.doc.tools = localRaw.tools
  fs.writeFileSync(path.join(dirD, 'catalog.json'), `${JSON.stringify(localRaw.doc, null, 2)}\n`)
  git(dirD, 'add', '-A')
  git(dirD, 'commit', '-q', '-m', 'Stranded entry')
  // ...and meanwhile the remote moves.
  await publishToCatalog(
    subB.catalog.id,
    { name: 'Remote Moved', capabilities: [], repo: 'https://example.com/moved.git' },
    storeB,
  )

  const recovered = await publishToCatalog(
    subD.catalog.id,
    { name: 'After Diverge', capabilities: [], repo: 'https://example.com/after-diverge.git' },
    storeD,
  )
  assert.equal(
    recovered.pushed,
    true,
    `a diverged publish should rebuild and push: ${recovered.pushProblem || ''}`,
  )
  const finalRemote = await syncCatalog(subB.catalog.id, storeB)
  const names = finalRemote.catalog.entries.map((e) => e.name)
  assert.ok(names.includes('After Diverge'), 'the new entry landed')
  assert.ok(names.includes('Remote Moved'), "the teammate's entry survived")
  assert.ok(names.includes('Stranded'), 'the entry stranded by the earlier failure was carried over')
  ok('a diverged publish rebuilds on the remote instead of dead-ending')

  // ---------------------------------------------------------------------
  // 9. A hand-edited id can never escape the clones root.
  // ---------------------------------------------------------------------
  const clonesRoot = path.join(rootA, 'catalogs')
  for (const bad of ['../../etc', '/etc/passwd', '..']) {
    let escaped = false
    try {
      const resolved = storeA.clonePath(bad)
      escaped = !resolved.startsWith(clonesRoot + path.sep)
    } catch {
      escaped = false // throwing is the correct outcome
    }
    assert.equal(escaped, false, `clonePath must not escape for ${bad}`)
  }
  ok('clone paths stay inside the data root')

  console.log('\nsmoke-catalog: all checks passed')
}

main()
  .then(() => {
    for (const fn of cleanup) fn()
    fs.rmSync(tmp, { recursive: true, force: true })
    process.exit(0)
  })
  .catch((err) => {
    for (const fn of cleanup) fn()
    console.error('\nsmoke-catalog FAILED')
    console.error(err)
    fs.rmSync(tmp, { recursive: true, force: true })
    process.exit(1)
  })
