/**
 * Electron main-process smoke: save a tool, launch, wait for running, stop, delete.
 * Run: npm run smoke:electron
 */
const { app } = require('electron')
const path = require('node:path')

const { LibraryStore } = require('../dist-electron/shared/library-store')
const { ProcessManager } = require('../dist-electron/shared/process-manager')

async function run() {
  const store = new LibraryStore()
  const pm = new ProcessManager(store)
  const fixture = path.resolve(__dirname, '../fixtures/sample-tool')
  const now = new Date().toISOString()

  const tool = store.save({
    id: `smoke-${Date.now()}`,
    name: 'Sample Tool',
    description: 'Fixture HTTP server for Shelf smoke tests',
    tags: ['Fixtures', 'Development Servers'],
    favorite: true,
    projectPath: fixture,
    launchCommand: 'PORT=8765 node server.mjs',
    url: 'http://127.0.0.1:8765',
    port: 8765,
    notes: 'Automated smoke fixture. Safe to remove.',
    createdAt: now,
    updatedAt: now,
  })

  console.log('Saved tool', tool.id)

  const started = await pm.start(tool.id)
  console.log('Start state', started.status, started.message)
  if (started.status !== 'running') {
    throw new Error(`Expected running, got ${started.status}: ${started.message}`)
  }

  const logs = pm.getLogs(tool.id)
  if (!logs.some((l) => l.text.includes('Sample tool listening'))) {
    throw new Error('Expected launch log missing')
  }
  console.log('OK: logs contain ready line')

  const stopped = await pm.stop(tool.id)
  console.log('Stop state', stopped.status)
  if (stopped.status !== 'stopped') {
    throw new Error(`Expected stopped, got ${stopped.status}`)
  }

  store.delete(tool.id)
  console.log('OK: electron process manager smoke passed')
}

app.whenReady().then(() => {
  run()
    .then(() => app.exit(0))
    .catch((err) => {
      console.error(err)
      app.exit(1)
    })
})
