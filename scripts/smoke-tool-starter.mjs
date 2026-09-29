/**
 * Start a new tool: Shelf writes a launchable, on-brand starter with a build
 * brief, registers it, and the scaffold actually runs. Refusals and rollback
 * leave nothing behind.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { LibraryStore } = require('../dist-electron/shared/library-store')
const { ProcessManager } = require('../dist-electron/shared/process-manager')
const { ReceiptStore } = require('../dist-electron/shared/receipt-store')
const { DesignProfileStore } = require('../dist-electron/shared/design-profile-store')
const { createToolProject, agentsBrief, STARTER_KICKOFF_PROMPT, starterLaunchCommand } = require('../dist-electron/shared/tool-starter')

const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'shelf-starter-data-'))
const parentDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'shelf-starter-tools-')))
const store = new LibraryStore(dataRoot)
const designProfiles = new DesignProfileStore(dataRoot)
const processes = new ProcessManager(store, { receipts: new ReceiptStore(dataRoot) })
const deps = { store, designProfiles, nodeCommand: { command: process.execPath } }

const read = (folder, file) => fs.readFileSync(path.join(folder, file), 'utf8')

try {
  const profile = designProfiles.save({
    name: 'Acme',
    isDefault: true,
    tokens: {
      color: {
        ink: { $value: '#101418', $type: 'color' },
        surface: { $value: '#f5f3ee', $type: 'color' },
        brand: { $value: '#c2410c', $type: 'color' },
        sneaky: { $value: 'red; } body { display: none', $type: 'color' },
      },
      typography: { 'font-family': { app: { $value: 'Inter, system-ui, sans-serif', $type: 'fontFamily' } } },
    },
    modes: { light: {}, dark: { color: { surface: { $value: '#12100d', $type: 'color' } } } },
    direction: 'Warm, direct, no exclamation marks.',
  })

  const result = await createToolProject({
    name: 'Photo Prepper',
    idea: 'Resize and compress client photos for websites.\nKeep EXIF off. <script>alert(1)</script>',
    parentDir,
  }, deps)
  const { tool, folder } = result
  assert.equal(folder, path.join(parentDir, 'Photo Prepper'))
  assert.equal(result.prompt, STARTER_KICKOFF_PROMPT)
  assert.equal(result.profileName, 'Acme')
  for (const file of ['AGENTS.md', 'CLAUDE.md', 'README.md', 'DESIGN.md', 'package.json', 'server.mjs', 'public/index.html', 'public/styles.css', 'public/tokens.css', '.gitignore'])
    assert.ok(fs.existsSync(path.join(folder, file)), `${file} is written`)
  assert.equal(store.get(tool.id).projectPath, folder)
  assert.ok(tool.port >= 4400 && tool.port <= 4999, 'port comes from the starter range')
  assert.equal(tool.url, `http://127.0.0.1:${tool.port}/`)
  assert.equal(tool.description, 'Resize and compress client photos for websites.')
  assert.match(tool.notes, /Design source: Shelf Acme profile/)
  assert.equal(read(folder, 'CLAUDE.md'), '@AGENTS.md\n')
  const brief = read(folder, 'AGENTS.md')
  assert.ok(brief.includes(`Shelf tool id: ${tool.id}`) && brief.includes('shelf_upsert_tool'), 'the brief tells the agent how to finish in Shelf')
  assert.ok(brief.includes(`falling back to ${tool.port}`) && brief.includes('127.0.0.1 only'))
  assert.ok(read(folder, 'DESIGN.md').includes('Warm, direct'), 'DESIGN.md carries the profile direction')
  const tokens = read(folder, 'public/tokens.css')
  assert.ok(tokens.includes('--color-brand: #c2410c;'))
  assert.ok(tokens.includes('--color-surface: #12100d;'), 'dark-mode overrides are kept')
  assert.ok(!tokens.includes('display: none'), 'a token value cannot break out of its declaration')
  const html = read(folder, 'public/index.html')
  assert.ok(!html.includes('<script>alert(1)</script>') && html.includes('&lt;script&gt;'), 'the idea is escaped in HTML')
  console.log('OK: the starter writes a registered, on-brand project with a build brief')

  // The scaffold runs as written and serves only public/.
  const state = await processes.start(tool.id, { openUrlWhenReady: false })
  assert.equal(state.status, 'running', state.message)
  const health = await (await fetch(`http://127.0.0.1:${tool.port}/api/health`)).json()
  assert.deepEqual(health, { ok: true, name: 'Photo Prepper' })
  const page = await (await fetch(`http://127.0.0.1:${tool.port}/`)).text()
  assert.ok(page.includes('<h1>Photo Prepper</h1>'))
  const escape = await new Promise((resolve) => {
    const socket = net.connect(tool.port, '127.0.0.1', () => socket.write('GET /../server.mjs HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n'))
    let body = ''
    socket.on('data', (chunk) => { body += chunk })
    socket.on('end', () => resolve(body))
  })
  assert.match(escape, /^HTTP\/1\.1 404/, 'path traversal stays inside public/')
  assert.equal((await fetch(`http://127.0.0.1:${tool.port}/%E0%A4%A`)).status, 400)
  await processes.stop(tool.id)
  console.log('OK: the scaffold launches through Shelf and answers on its port')

  const injected = designProfiles.save({ name: 'Evil **// html{background:url(https://evil.example/px.png)} /*', tokens: { color: { a: { $value: 'image-set("https://evil.example/a.png" 1x)', $type: 'color' }, b: { $value: '"unterminated', $type: 'color' }, ok: { $value: '#123456', $type: 'color' } } } })
  const styled = await createToolProject({ name: 'Styled', idea: 'Check CSS safety.', parentDir, designProfileId: injected.id }, deps)
  const styledCss = read(styled.folder, 'public/tokens.css')
  assert.ok(!/evil|url\(|image-set|unterminated|html\{/.test(styledCss), 'profile text cannot reach live CSS')
  assert.ok(styledCss.includes('--color-ok: #123456;'))
  console.log('OK: profile names and unsafe token values never reach tokens.css')

  // Refusals leave nothing behind.
  const before = store.list().length
  await assert.rejects(createToolProject({ name: 'Photo Prepper', idea: 'again', parentDir }, deps), /already exists|already uses/)
  await assert.rejects(createToolProject({ name: 'Leaky', idea: 'uses ghp_a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8', parentDir }, deps), /credential/)
  await assert.rejects(createToolProject({ name: '', idea: 'x', parentDir }, deps), /name/)
  await assert.rejects(createToolProject({ name: 'Gone', idea: 'x', parentDir: path.join(parentDir, 'missing') }, deps), /no longer exists/)
  const busy = net.createServer().listen(0, '127.0.0.1')
  await new Promise((resolve) => busy.once('listening', resolve))
  await assert.rejects(createToolProject({ name: 'Busy', idea: 'x', parentDir, port: busy.address().port }, deps), /in use/)
  busy.close()
  assert.equal(store.list().length, before)
  console.log('OK: duplicate folders, credentials, missing folders, and busy ports are refused')

  // A name cannot choose the destination's parent.
  const sneaky = await createToolProject({ name: '../../escape', idea: 'Stay put.', parentDir, designProfileId: null }, deps)
  assert.equal(path.dirname(sneaky.folder), parentDir)
  assert.ok(!fs.existsSync(path.join(sneaky.folder, 'DESIGN.md')), 'no profile, no DESIGN.md')
  assert.match(read(sneaky.folder, 'public/tokens.css'), /neutral defaults/)
  console.log('OK: names stay inside the chosen folder; no profile means neutral styling')

  // A write failure rolls back the folder and the library entry.
  const realWrite = fs.writeFileSync
  fs.writeFileSync = (target, ...rest) => {
    if (String(target).endsWith('server.mjs')) throw new Error('disk full')
    return realWrite(target, ...rest)
  }
  try {
    await assert.rejects(createToolProject({ name: 'Half Made', idea: 'x', parentDir }, deps), /could not create the project/)
  } finally {
    fs.writeFileSync = realWrite
  }
  assert.ok(!fs.existsSync(path.join(parentDir, 'Half Made')), 'the partial folder is removed')
  assert.ok(!store.list().some((entry) => entry.name === 'Half Made'), 'the library entry is removed')
  console.log('OK: a failed write rolls back the folder and the library entry')

  // Launch command shapes, and the brief an MCP prompt hands an agent.
  assert.equal(starterLaunchCommand({ command: '/opt/homebrew/bin/node' }), 'node server.mjs')
  assert.equal(starterLaunchCommand({ command: '/Users/a b/.nvm/versions/node/v22/bin/node' }), "'/Users/a b/.nvm/versions/node/v22/bin/node' server.mjs")
  assert.equal(starterLaunchCommand({ command: '/Applications/Shelf.app/Contents/MacOS/Shelf', env: { ELECTRON_RUN_AS_NODE: '1' } }), 'ELECTRON_RUN_AS_NODE=1 /Applications/Shelf.app/Contents/MacOS/Shelf server.mjs')
  const unregistered = agentsBrief({ name: 'X', idea: 'Y', port: 4410, launchCommand: 'node server.mjs', profile })
  assert.ok(unregistered.includes('shelf_register_project') && !unregistered.includes('Shelf tool id'))
  console.log('OK: launch commands and the unregistered brief are correct')

  console.log('OK: tool starter smoke passed')
} finally {
  await processes.stopAll('smoke cleanup')
  fs.rmSync(dataRoot, { recursive: true, force: true })
  fs.rmSync(parentDir, { recursive: true, force: true })
}
