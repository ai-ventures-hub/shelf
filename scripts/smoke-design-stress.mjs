/**
 * Design Engine stress smoke — the pre-release gauntlet.
 *
 * A: cross-process lock contention (4 workers hammer one design-profiles.json)
 * B: scale (300 colors, deep nesting, 200KB direction, 30 assets)
 * C: fuzz (hostile hand-edited profiles must degrade, never throw)
 * D: mutation churn (400 mixed ops with invariant checks; library.json untouched)
 * E: concurrent MCP resolution through the real stdio server
 *
 * Needs dist-electron (tsc -p tsconfig.electron.json) AND dist-mcp (mcp:build).
 * Run: npm run smoke:design-stress
 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const requireCjs = createRequire(import.meta.url)
const __filename = fileURLToPath(import.meta.url)
const root = path.resolve(path.dirname(__filename), '..')

const { DesignProfileStore } = requireCjs('../dist-electron/shared/design-profile-store.js')
const { LibraryStore } = requireCjs('../dist-electron/shared/library-store.js')
const { resolveDesignProfile } = requireCjs('../dist-electron/shared/design-resolve.js')
const {
  buildDesignBrief,
  summarizeDesignProfile,
} = requireCjs('../dist-electron/shared/design-brief.js')
const { buildGapBrief } = requireCjs('../dist-electron/shared/gap-brief.js')

const WORKERS = 4
const WORKER_OPS = 20

// ---------------------------------------------------------------------------
// Worker mode: one process's share of the contention test (section A).
if (process.argv[2] === 'worker') {
  const dataRoot = process.argv[3]
  const wid = process.argv[4]
  const store = new DesignProfileStore(dataRoot)
  const profile = store.save({ name: `Worker ${wid}` })
  const imported = []
  for (let i = 0; i < WORKER_OPS; i++) {
    store.save({
      id: profile.id,
      name: `Worker ${wid}`,
      tokens: {
        color: { brand: { $value: `#00000${i % 10}`, $type: 'color' } },
      },
      direction: `iteration ${i}`,
    })
    if (i % 5 === 0) {
      const src = path.join(dataRoot, `w${wid}-asset-${i}.svg`)
      fs.writeFileSync(src, `<svg><!-- ${wid}-${i} --></svg>`)
      imported.push(store.importAsset(profile.id, src, 'icon'))
    }
    if (i % 7 === 3) store.setDefault(profile.id)
    if (i % 9 === 8 && imported.length > 1) {
      store.removeAsset(profile.id, imported.shift().path)
    }
  }
  store.save({ id: profile.id, name: `Worker ${wid}`, direction: `final-${wid}` })
  process.exit(0)
}

// ---------------------------------------------------------------------------
function runWorker(dataRoot, wid) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [__filename, 'worker', dataRoot, String(wid)], {
      cwd: root,
      stdio: ['ignore', 'inherit', 'inherit'],
    })
    child.on('error', reject)
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`worker ${wid} exited ${code}`)),
    )
  })
}

function makeGap(now) {
  return {
    id: 'stress-gap',
    capabilities: ['stress the design engine'],
    task: 'Stress the design engine',
    reason: 'Release gate',
    relatedToolIds: [],
    status: 'open',
    occurrenceCount: 1,
    examples: [{ task: 'Stress the design engine', at: now }],
    createdAt: now,
    updatedAt: now,
    lastRequestedAt: now,
  }
}

async function main() {
  const now = new Date().toISOString()

  // --- A: cross-process lock contention ---
  const contentionRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'shelf-stress-lock-'))
  try {
    await Promise.all(
      Array.from({ length: WORKERS }, (_, i) => runWorker(contentionRoot, i)),
    )
    const raw = fs.readFileSync(path.join(contentionRoot, 'design-profiles.json'), 'utf8')
    const parsed = JSON.parse(raw) // corruption under contention would throw here
    assert.equal(parsed.version, 1)
    const store = new DesignProfileStore(contentionRoot)
    const all = store.list()
    assert.equal(all.length, WORKERS, 'every worker profile survived')
    assert.equal(
      all.filter((p) => p.isDefault).length,
      1,
      'single-default invariant held under concurrent setDefault',
    )
    for (let i = 0; i < WORKERS; i++) {
      const profile = store.findByName(`Worker ${i}`)
      assert.ok(profile, `Worker ${i} profile exists`)
      assert.equal(profile.direction, `final-${i}`, `Worker ${i} final write landed`)
      for (const asset of profile.assets) {
        assert.ok(fs.existsSync(asset.path), 'recorded asset files exist on disk')
      }
    }
    const residue = fs
      .readdirSync(contentionRoot)
      .filter((name) => name.endsWith('.lock') || name.includes('.tmp'))
    assert.deepEqual(residue, [], 'no lock/tmp residue after contention')
    const backups = fs
      .readdirSync(contentionRoot)
      .filter((name) => name.includes('corrupt-backup'))
    assert.deepEqual(backups, [], 'no corrupt-backup was ever triggered')
    console.log(`OK: contention — ${WORKERS} processes × ${WORKER_OPS} ops, no corruption`)
  } finally {
    fs.rmSync(contentionRoot, { recursive: true, force: true })
  }

  // --- B: scale ---
  const scaleRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'shelf-stress-scale-'))
  try {
    const store = new DesignProfileStore(scaleRoot)
    const color = {}
    for (let i = 0; i < 300; i++) {
      color[`shade-${i}`] = { $value: `#${(i * 4111).toString(16).padStart(6, '0').slice(0, 6)}`, $type: 'color' }
    }
    // 10-level-deep nested group with a sentinel leaf at the bottom.
    let deep = { bottom: { $value: 'deep-sentinel', $type: 'other' } }
    for (let i = 0; i < 10; i++) deep = { [`level-${i}`]: deep }
    const direction = `# Giant direction\n${'lorem ipsum operator voice '.repeat(8000)}\nEND-SENTINEL`
    const big = store.save({
      name: 'Giant',
      tokens: { color, nested: deep, typography: { 'font-family': { app: { $value: 'Inter', $type: 'fontFamily' } } } },
      modes: { light: { color: { 'shade-0': { $value: '#ffffff', $type: 'color' } } } },
      direction,
    })
    for (let i = 0; i < 30; i++) {
      const src = path.join(scaleRoot, `big-asset-${i}.png`)
      fs.writeFileSync(src, `png-${i}`)
      store.importAsset(big.id, src, 'other')
    }
    const reread = store.get(big.id)
    assert.equal(Object.keys(reread.tokens.color).length, 300, '300 colors round-trip')
    assert.equal(reread.assets.length, 30, '30 assets round-trip')

    const started = Date.now()
    const brief = buildDesignBrief(reread)
    const elapsed = Date.now() - started
    assert.ok(brief.includes('shade-299'), 'brief includes the last color')
    assert.ok(brief.includes('deep-sentinel'), 'brief includes the deep-nested leaf')
    assert.ok(brief.includes('END-SENTINEL'), 'brief includes the full direction')
    assert.ok(brief.includes('(light: #ffffff)'), 'brief includes the mode override')
    assert.ok(elapsed < 5000, `brief render bounded (${elapsed}ms)`)
    assert.ok(summarizeDesignProfile(reread).includes('300 colors'), 'summary scales')
    console.log(`OK: scale — 300 colors, 10-deep nesting, ${Math.round(direction.length / 1024)}KB direction, brief in ${elapsed}ms`)
  } finally {
    fs.rmSync(scaleRoot, { recursive: true, force: true })
  }

  // --- C: fuzz — hostile hand-edited profiles never throw ---
  const fuzzRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'shelf-stress-fuzz-'))
  try {
    const hostiles = [
      {},
      { id: 42, name: 9000, isDefault: 'yes', tokens: [], modes: null, direction: 123, assets: 'nope' },
      { id: 'weird', name: 'Weird', tokens: { color: { bad: null, alsoBad: 'string', empty: {}, arr: [1, 2] } }, modes: { light: [], dark: 'x' } },
      { id: 'objval', name: 'ObjVal', tokens: { color: { comp: { $value: { nested: true } } } }, modes: {}, direction: 'ok', assets: [null, { kind: 'logo' }, { path: '/nope.svg', kind: 'logo', mime: 'image/svg+xml' }] },
      { id: 'dollar', name: 'Dollar', tokens: { color: { $value: { trick: { $value: '#123456', $type: 'color' } } } }, modes: { light: {}, dark: {} } },
    ]
    fs.mkdirSync(fuzzRoot, { recursive: true })
    fs.writeFileSync(
      path.join(fuzzRoot, 'design-profiles.json'),
      JSON.stringify({ version: 1, profiles: hostiles }),
    )
    const store = new DesignProfileStore(fuzzRoot)
    const profiles = store.list()
    assert.equal(profiles.length, hostiles.length, 'every hostile profile normalized, none dropped')
    const gap = makeGap(now)
    for (const profile of profiles) {
      // None of these may throw — agents and the GUI both read this data.
      summarizeDesignProfile(profile)
      const brief = buildDesignBrief(profile)
      assert.ok(brief.includes('## Design profile:'), 'hostile profile renders a brief')
      buildGapBrief(gap, [], { profile })
      store.save({ id: profile.id, name: profile.name }) // re-save normalized form
    }
    const junkCollections = [
      { id: 'c1', name: 'C1', toolIds: ['t1'], designProfileId: 'does-not-exist', createdAt: now, updatedAt: now },
      { id: 'c2', name: 'C2', toolIds: [], designProfileId: profiles[0].id, createdAt: now, updatedAt: now },
    ]
    assert.equal(
      resolveDesignProfile(profiles, junkCollections, { toolId: 't1' }).via,
      profiles.some((p) => p.isDefault) ? 'default' : 'none',
      'dangling binding falls through cleanly',
    )
    console.log(`OK: fuzz — ${hostiles.length} hostile profiles normalized, briefed, resolved`)
  } finally {
    fs.rmSync(fuzzRoot, { recursive: true, force: true })
  }

  // --- D: mutation churn with invariants ---
  const churnRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'shelf-stress-churn-'))
  try {
    const store = new DesignProfileStore(churnRoot)
    const library = new LibraryStore(churnRoot)
    const libraryBytes = fs.readFileSync(path.join(churnRoot, 'library.json'))
    const ids = []
    const srcFile = path.join(churnRoot, 'churn.svg')
    fs.writeFileSync(srcFile, '<svg/>')
    for (let i = 0; i < 400; i++) {
      const op = i % 8
      if (op === 0 || ids.length === 0) {
        ids.push(store.save({ name: `Churn ${i}` }).id)
      } else if (op === 1) {
        const id = ids[i % ids.length]
        store.save({ id, name: `Churn renamed ${i}`, direction: `d${i}` })
      } else if (op === 2) {
        store.setDefault(ids[i % ids.length])
      } else if (op === 3) {
        store.importAsset(ids[i % ids.length], srcFile, 'icon')
      } else if (op === 4) {
        const target = store.get(ids[i % ids.length])
        if (target.assets.length > 0) store.removeAsset(target.id, target.assets[0].path)
      } else if (op === 5 && ids.length > 3) {
        store.delete(ids.shift())
      } else {
        store.save({
          id: ids[i % ids.length],
          name: `Churn ${i}`,
          tokens: { color: { brand: { $value: '#123456', $type: 'color' } } },
        })
      }
      if (i % 50 === 49) {
        const defaults = store.list().filter((p) => p.isDefault).length
        assert.ok(defaults <= 1, `at most one default (op ${i}: ${defaults})`)
      }
    }
    assert.ok(store.list().length > 0)
    assert.ok(
      libraryBytes.equals(fs.readFileSync(path.join(churnRoot, 'library.json'))),
      '400 profile ops never touched library.json',
    )
    console.log(`OK: churn — 400 mixed ops, invariants held, library.json untouched`)
  } finally {
    fs.rmSync(churnRoot, { recursive: true, force: true })
  }

  // --- E: concurrent MCP resolution through the real stdio server ---
  const mcpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'shelf-stress-mcp-'))
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
  const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js')
  try {
    const store = new DesignProfileStore(mcpRoot)
    const library = new LibraryStore(mcpRoot)
    const profileIds = []
    for (let i = 0; i < 20; i++) {
      profileIds.push(
        store.save({
          name: `Brand ${i}`,
          tokens: { color: { brand: { $value: `#0000${(10 + i).toString(16)}`, $type: 'color' } } },
          direction: `Brand ${i} direction`,
        }).id,
      )
    }
    store.setDefault(profileIds[0])
    library.save({
      id: 'stress-tool',
      name: 'Stress Tool',
      tags: [],
      capabilities: [],
      agentAccess: [],
      favorite: false,
      launchCommand: 'true',
      createdAt: now,
      updatedAt: now,
    })
    const collectionIds = []
    for (let i = 0; i < 20; i++) {
      collectionIds.push(
        library.saveCollection({
          id: '',
          name: `Coll ${i}`,
          toolIds: i === 7 ? ['stress-tool'] : [],
          designProfileId: profileIds[i],
        }).id,
      )
    }

    const transport = new StdioClientTransport({
      command: 'node',
      args: [path.join(root, 'dist-mcp/mcp/server.js')],
      env: { ...process.env, SHELF_DATA_ROOT: mcpRoot },
      stderr: 'pipe',
    })
    const client = new Client({ name: 'shelf-stress', version: '0.1.0' })
    await client.connect(transport)
    try {
      const call = async (args) => {
        const result = await client.callTool({
          name: 'shelf_get_design_profile',
          arguments: args,
        })
        const text = result.content?.find((c) => c.type === 'text')?.text
        if (result.isError) throw new Error(text)
        return JSON.parse(text)
      }
      // 46 concurrent requests with mixed resolution paths.
      const tasks = [
        ...profileIds.map((id) => () => call({ id })),
        ...collectionIds.slice(0, 20).map((collectionId) => () => call({ collectionId })),
        () => call({}),
        () => call({}),
        () => call({ toolId: 'stress-tool' }),
        () => client.readResource({ uri: `shelf://design/profiles/${profileIds[3]}` }),
        () =>
          client.callTool({ name: 'shelf_list_design_profiles', arguments: {} }).then((r) => {
            const parsed = JSON.parse(r.content.find((c) => c.type === 'text').text)
            assert.equal(parsed.count, 20, 'list sees all 20 profiles')
            return parsed
          }),
      ]
      const results = await Promise.all(tasks.map((task) => task()))
      profileIds.forEach((id, i) => {
        assert.equal(results[i].profile.id, id, `explicit id ${i} resolved`)
        assert.equal(results[i].resolvedVia, 'id')
      })
      collectionIds.forEach((collectionId, i) => {
        const result = results[20 + i]
        assert.equal(result.resolvedVia, 'collection', `collection ${i} resolved via binding`)
        assert.equal(result.profile.id, profileIds[i])
      })
      assert.equal(results[40].resolvedVia, 'default')
      assert.equal(results[40].profile.id, profileIds[0])
      assert.equal(results[42].resolvedVia, 'tool-collection')
      assert.equal(results[42].profile.id, profileIds[7], 'tool resolves through Coll 7')
      const resourceText = results[43].contents[0].text
      assert.ok(resourceText.includes('Brand 3'), 'resource brief under load')
      console.log('OK: mcp — 46 concurrent resolutions, all correct')
    } finally {
      await client.close()
    }
  } finally {
    fs.rmSync(mcpRoot, { recursive: true, force: true })
  }

  console.log('OK: design engine stress passed')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
