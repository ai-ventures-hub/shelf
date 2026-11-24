/**
 * Regressions from the November 23, 2026 audit: shared ports, port reassign
 * that keeps commands intact, output masking, cross-process stops, leftover
 * children, portless tools, and fields a newer build added.
 * Everything runs against temporary data roots.
 * Requires: npx tsc -p tsconfig.electron.json
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const dist = (name) => require(`../dist-electron/shared/${name}.js`)
const { withForcedPort, urlForPort, claimedPorts, takesPortFlag, findPortOccupant } = dist('ports')
const { inspectProject } = dist('project-import')
const { deriveLibraryHealth } = dist('tool-health')
const { healthWarning } = dist('tool-health-presentation')
const { sanitizeToolForOutput } = dist('types')
const { LibraryStore } = dist('library-store')
const { ReceiptStore } = dist('receipt-store')
const { ProcessManager } = dist('process-manager')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const tmp = (prefix) => fs.mkdtempSync(path.join(os.tmpdir(), prefix))

// ---- withForcedPort keeps commands it does not recognize intact -------------
{
  const cases = [
    // [command, previous port, expected at 4001]
    ['docker run -p 8080:80 nginx', 8080, 'PORT=4001 docker run -p 4001:80 nginx'],
    ['docker run -p 8080:80 nginx', undefined, 'PORT=4001 docker run -p 8080:80 nginx'],
    ['uvicorn app:app --port 8000 --reload', 8000, 'PORT=4001 uvicorn app:app --port 4001 --reload'],
    ['python3 server.py --port 5213', 5213, 'PORT=4001 python3 server.py --port 4001'],
    ['python -m http.server 8000', 8000, 'PORT=4001 python -m http.server 4001'],
    ['php -S localhost:8000', 8000, 'PORT=4001 php -S localhost:4001'],
    ['rails s -p 3000', 3000, 'PORT=4001 rails s -p 4001'],
    ['ssh -p 2222 -N -L 8000:db:5432 host', 8000, 'PORT=4001 ssh -p 2222 -N -L 4001:db:5432 host'],
    ['python3 server.py', 5241, 'PORT=4001 python3 server.py'],
    ['FOO=1 PORT=3000 npm run dev', 3000, 'PORT=4001 FOO=1 npm run dev -- --port 4001'],
    ['cd ~/code/next-app && node server.js', 3000, 'PORT=4001 cd ~/code/next-app && node server.js'],
    ['npm run dev', undefined, 'PORT=4001 npm run dev -- --port 4001'],
    ['PORT=3000 npm run dev -- --port 3000', 3000, 'PORT=4001 npm run dev -- --port 4001'],
    // pnpm passes a literal `--` on to the script, which hides the flag.
    ['pnpm run dev', undefined, 'PORT=4001 pnpm run dev --port 4001'],
    ['PORT=5173 pnpm run dev -- --port 5173', 5173, 'PORT=4001 pnpm run dev --port 4001'],
    ['next dev', undefined, 'PORT=4001 next dev --port 4001'],
    ['next dev -p 3000', 3000, 'PORT=4001 next dev -p 4001'],
  ]
  for (const [command, previous, expected] of cases) {
    assert.equal(withForcedPort(command, 4001, previous), expected, command)
  }
  // Pinning twice lands on the same command.
  for (const command of ['npm run dev', 'pnpm run dev', 'next dev', 'vite']) {
    const once = withForcedPort(command, 4001)
    assert.equal(withForcedPort(once, 4001), once, `idempotent: ${command}`)
    assert.equal(withForcedPort(once, 4002, 4001), once.replaceAll('4001', '4002'), `moves: ${command}`)
  }
  assert.equal(takesPortFlag('cd ~/code/next-app && node server.js'), false)
  assert.equal(takesPortFlag('npx next dev'), true)
  assert.equal(urlForPort('http://app.localhost:3000/admin', 4001), 'http://app.localhost:4001/admin')
  assert.equal(urlForPort('https://example.com/x', 4001), 'http://127.0.0.1:4001/')
  console.log('OK: port reassign rewrites the port in place and keeps other flags')
}

// ---- library-claimed ports ---------------------------------------------------
{
  const entries = [
    { port: 3000, projectPath: '/tmp/a' },
    { port: 5241, projectPath: '/tmp/b' },
    { projectPath: '/tmp/c' },
  ]
  assert.deepEqual(claimedPorts(entries).sort(), [3000, 5241])
  assert.deepEqual(claimedPorts(entries, '/tmp/a/'), [5241], 'a folder does not block its own port')

  const dir = tmp('shelf-audit-import-')
  try {
    fs.writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ name: 'second-next', scripts: { dev: 'next dev' }, dependencies: { next: '^16.0.0' } }),
    )
    const free = await inspectProject(dir)
    const claimed = await inspectProject(dir, undefined, { reservedPorts: [free.port] })
    assert.ok(free.port, 'a Next.js project gets a port')
    assert.notEqual(claimed.port, free.port, 'a port another tool claims is not suggested again')
    assert.ok(claimed.signals.some((signal) => signal.includes('belongs to another Shelf tool')))
    assert.ok(claimed.launchCommand.includes(String(claimed.port)), 'the command is pinned to the new port')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
  console.log('OK: import skips ports that library tools already claim')
}

// ---- health names the tool that holds a shared port ---------------------------
{
  const net = await import('node:net')
  const server = net.createServer()
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  try {
    const base = { tags: [], capabilities: [], agentAccess: [], favorite: false, launchCommand: 'true', createdAt: '', updatedAt: '' }
    const health = await deriveLibraryHealth(
      [
        { ...base, id: 'a', name: 'Planner', port },
        { ...base, id: 'b', name: 'Operator', port },
      ],
      [{ toolId: 'a', status: 'running' }, { toolId: 'b', status: 'stopped' }],
    )
    assert.equal(health[0].launchable, true, 'the running tool is healthy')
    assert.equal(health[1].launchable, false)
    assert.match(health[1].problems[0], /in use by Planner/)
    assert.equal(healthWarning(health[1]).label, 'Port busy')
  } finally {
    server.close()
  }
  console.log('OK: health names the library tool holding a shared port')
}

// ---- masking leaves names, tags and folders readable --------------------------
{
  const masked = sanitizeToolForOutput({
    id: 't', name: 'invoices dashboard', description: 'Shows invoices by month',
    tags: ['invoices'], capabilities: ['Export invoices to CSV'], agentAccess: [], favorite: false,
    projectPath: '/Users/me/tools/invoices', launchCommand: 'DB_NAME=invoices API_TOKEN=tok_live_abcdef123456 node server.js',
    env: { DB_NAME: 'invoices', API_TOKEN: 'tok_live_abcdef123456' },
    notes: 'Token is tok_live_abcdef123456', createdAt: '', updatedAt: '',
  })
  assert.equal(masked.name, 'invoices dashboard')
  assert.deepEqual(masked.tags, ['invoices'])
  assert.deepEqual(masked.capabilities, ['Export invoices to CSV'])
  assert.equal(masked.projectPath, '/Users/me/tools/invoices')
  assert.deepEqual(masked.env, { DB_NAME: '***', API_TOKEN: '***' })
  assert.ok(!JSON.stringify(masked).includes('tok_live_abcdef123456'), 'the secret itself is still masked everywhere')
  console.log('OK: masking keeps identity fields and still hides secret values')
}

// ---- a write keeps fields this build does not know ----------------------------
{
  const root = tmp('shelf-audit-fields-')
  try {
    const store = new LibraryStore(root)
    const now = new Date().toISOString()
    const saved = store.save({ id: 'future', name: 'Future', tags: [], favorite: false, launchCommand: 'true', createdAt: now, updatedAt: now })
    const file = path.join(root, 'library.json')
    const data = JSON.parse(fs.readFileSync(file, 'utf8'))
    data.tools[0].addedByNewerShelf = { level: 2 }
    fs.writeFileSync(file, JSON.stringify(data))
    store.touchLastLaunched(saved.id)
    store.save({ id: 'other', name: 'Other', tags: [], favorite: false, launchCommand: 'true', createdAt: now, updatedAt: now })
    const after = JSON.parse(fs.readFileSync(file, 'utf8')).tools.find((tool) => tool.id === 'future')
    assert.deepEqual(after.addedByNewerShelf, { level: 2 }, 'unknown field survives writes')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
  console.log('OK: library writes keep fields a newer build added')
}

// ---- process behaviour ---------------------------------------------------------
const dataRoot = tmp('shelf-audit-proc-')
const project = tmp('shelf-audit-tool-')
const store = new LibraryStore(dataRoot)
const receipts = new ReceiptStore(dataRoot)
const owner = new ProcessManager(store, { receipts })
const outsider = new ProcessManager(store, { receipts: new ReceiptStore(dataRoot) })
const now = new Date().toISOString()
const base = { tags: [], favorite: false, projectPath: project, createdAt: now, updatedAt: now }
const ids = []

async function portState(port, occupied, ms = 12_000) {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (Boolean(await findPortOccupant(port)) === occupied) return true
    await sleep(150)
  }
  return false
}

try {
  fs.writeFileSync(
    path.join(project, 'server.cjs'),
    `const port = Number(process.env.PORT)
require('node:http').createServer((_q, s) => s.end('ok')).listen(port, '127.0.0.1')
process.on('SIGTERM', () => process.exit(143))
`,
  )

  // Receipt stop intent: set by the stopping process, cleared if the run goes on.
  {
    const receipt = receipts.begin({ toolId: 'x', toolName: 'X', launchCommand: 'true' })
    assert.ok(receipts.requestStop(receipt.id).stopRequestedAt)
    assert.equal(receipts.markRunning(receipt.id).stopRequestedAt, undefined)
    receipts.end(receipt.id, { outcome: 'stopped' })
  }

  // A stop from the other manager is a stop for the owner too, even when the
  // launcher exits non-zero (a wrapper that traps TERM and exits 143).
  {
    const port = 8771
    const tool = store.save({
      ...base, id: 'audit-cross-stop', name: 'Cross Stop', port, url: `http://127.0.0.1:${port}/`,
      launchCommand: `trap '' TERM; PORT=${port} node server.cjs; exit $?`, autoRestart: true,
    })
    ids.push(tool.id)
    const started = await owner.start(tool.id)
    assert.equal(started.status, 'running', started.message)
    const stopped = await outsider.stop(tool.id)
    assert.equal(stopped.status, 'stopped', stopped.message)
    await sleep(1_500)
    const seenByOwner = owner.peekState(tool.id)
    assert.equal(seenByOwner.status, 'stopped', `owner saw: ${seenByOwner.message}`)
    assert.ok(await portState(port, false, 3_000), 'the tool was not restarted behind the stop')
    assert.equal(receipts.list({ toolId: tool.id, limit: 1 })[0].outcome, 'stopped')
    console.log('OK: a stop from the other Shelf process is recorded as a stop, with no auto-restart')
  }

  // A launcher that crashes while its child still serves the port: the
  // child is cleaned up, so the port is not left held by an untracked group.
  {
    const port = 8772
    const tool = store.save({
      ...base, id: 'audit-orphan', name: 'Orphan', port, url: `http://127.0.0.1:${port}/`,
      launchCommand: `PORT=${port} node server.cjs & sleep 2; exit 3`,
    })
    ids.push(tool.id)
    await owner.start(tool.id)
    await sleep(2_500)
    assert.equal(owner.peekState(tool.id).status, 'error')
    assert.ok(await portState(port, false), 'leftover child was stopped and the port is free')
    console.log('OK: a crashed launcher does not leave children holding the port')
  }

  // A portless tool that mentions somebody else's URL keeps running.
  {
    const tool = store.save({
      ...base, id: 'audit-portless', name: 'Portless',
      launchCommand: `echo "Connecting to http://localhost:11434/api"; sleep 60`,
    })
    ids.push(tool.id)
    const state = await owner.start(tool.id)
    assert.equal(state.status, 'running', state.message)
    assert.equal(store.get(tool.id).port, undefined, 'no port was saved from a URL the tool does not serve')
    await owner.stop(tool.id)
    console.log('OK: a portless tool is not stopped for printing an unrelated URL')
  }
} finally {
  for (const id of ids) {
    try { await owner.stop(id) } catch { /* best effort */ }
  }
  await owner.stopAll?.({ scope: 'local' }).catch(() => {})
  fs.rmSync(dataRoot, { recursive: true, force: true })
  fs.rmSync(project, { recursive: true, force: true })
}

console.log('OK: November audit regressions')
