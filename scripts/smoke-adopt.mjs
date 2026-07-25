/**
 * Smoke: ProcessManager A launches; ProcessManager B adopts-by-port and stops.
 * Mirrors Electron vs MCP split-brain without requiring both hosts.
 */
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const require = createRequire(import.meta.url)

// Compile shared+electron units before loading (same pattern as other smokes).
const { LibraryStore } = require('../dist-electron/shared/library-store')
const { ProcessManager } = require('../dist-electron/shared/process-manager')
const { findPortOccupant } = require('../dist-electron/shared/ports')

const fixture = path.join(root, 'fixtures/sample-tool')
const port = 8767
const now = new Date().toISOString()

const store = new LibraryStore()
const owner = new ProcessManager(store)
const outsider = new ProcessManager(store)

const tool = store.save({
  id: `smoke-adopt-${Date.now()}`,
  name: 'Adopt Smoke',
  description: 'External launch adopt-by-port smoke',
  tags: ['Fixtures'],
  favorite: false,
  projectPath: fixture,
  launchCommand: `PORT=${port} node server.mjs`,
  url: `http://127.0.0.1:${port}`,
  port,
  createdAt: now,
  updatedAt: now,
})

let orphan = null
try {
  // Simulate MCP: spawn outside the "Electron" ProcessManager.
  orphan = spawn('/bin/zsh', ['-lc', tool.launchCommand], {
    cwd: fixture,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    const pid = await findPortOccupant(port)
    if (pid) break
    await new Promise((r) => setTimeout(r, 200))
  }
  if (!(await findPortOccupant(port))) {
    throw new Error(`Orphan never listened on ${port}`)
  }

  const adopted = await outsider.getState(tool.id)
  if (adopted.status !== 'running' || !(adopted.message || '').includes('external')) {
    throw new Error(`Expected external running, got ${adopted.status}: ${adopted.message}`)
  }
  console.log('OK: adopted external listener', adopted.pid)

  const startAdopt = await outsider.start(tool.id)
  if (startAdopt.status !== 'running') {
    throw new Error(`Expected start() to adopt, got ${startAdopt.status}: ${startAdopt.message}`)
  }
  console.log('OK: start() adopts busy port')

  const stopped = await outsider.stop(tool.id)
  if (stopped.status !== 'stopped') {
    throw new Error(`Expected stopped, got ${stopped.status}: ${stopped.message}`)
  }
  if (await findPortOccupant(port)) {
    throw new Error(`Port ${port} still occupied after stop`)
  }
  console.log('OK: stop freed external port')

  // Owner manager still works for a normal launch/stop cycle.
  const started = await owner.start(tool.id)
  if (started.status !== 'running') {
    throw new Error(`Expected owner running, got ${started.status}: ${started.message}`)
  }
  await owner.stop(tool.id)
  console.log('OK: adopt smoke passed')
} finally {
  store.delete(tool.id)
  if (orphan?.pid) {
    try {
      process.kill(-orphan.pid, 'SIGKILL')
    } catch {
      try {
        orphan.kill('SIGKILL')
      } catch {
        // ignore
      }
    }
  }
  const leftover = await findPortOccupant(port)
  if (leftover) {
    try {
      process.kill(leftover, 'SIGKILL')
    } catch {
      // ignore
    }
  }
}
