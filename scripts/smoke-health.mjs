/** Tool health (launchability) smoke — triage E: batched lsof, readiness ≠ launchability. */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { deriveToolHealth, deriveLibraryHealth } = require('../dist-electron/shared/tool-health.js')
const { listListeningPorts } = require('../dist-electron/shared/ports.js')

const now = new Date().toISOString()
const baseTool = {
  tags: [],
  capabilities: [],
  agentAccess: [],
  favorite: false,
  createdAt: now,
  updatedAt: now,
}

const realDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shelf-health-'))

// Hold a real listening socket so the batched scan has something to find.
const server = net.createServer()
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const busyPort = server.address().port

try {
  const listening = await listListeningPorts()
  assert.ok(listening.has(busyPort), 'batched scan sees a real LISTEN socket')

  // Healthy: folder exists, command set, port free.
  const healthy = deriveToolHealth(
    { ...baseTool, id: 'ok', name: 'OK', projectPath: realDir, launchCommand: 'true', port: 65_001 },
    { listening },
  )
  assert.equal(healthy.launchable, true)
  assert.deepEqual(healthy.problems, [])

  // Missing folder.
  const gone = deriveToolHealth(
    { ...baseTool, id: 'gone', name: 'Gone', projectPath: path.join(realDir, 'nope'), launchCommand: 'true' },
    { listening },
  )
  assert.equal(gone.launchable, false)
  assert.ok(gone.problems[0].includes('folder'), 'missing folder reported')

  // Empty command.
  const mute = deriveToolHealth(
    { ...baseTool, id: 'mute', name: 'Mute', launchCommand: '   ' },
    { listening },
  )
  assert.ok(mute.problems.some((p) => p.includes('launch command')), 'empty command reported')

  // Port squatted by another process while the tool is stopped.
  const squatted = deriveToolHealth(
    { ...baseTool, id: 'squat', name: 'Squat', launchCommand: 'true', port: busyPort },
    { listening },
  )
  assert.equal(squatted.launchable, false)
  assert.ok(squatted.problems[0].includes(String(busyPort)), 'busy port reported with number')

  // The SAME port is fine when the tool itself is running there.
  const running = deriveToolHealth(
    { ...baseTool, id: 'live', name: 'Live', launchCommand: 'true', port: busyPort },
    { listening, state: { toolId: 'live', status: 'running' } },
  )
  assert.equal(running.launchable, true, 'a live tool is not its own port conflict')

  // Library-level: one scan covers every tool.
  const all = await deriveLibraryHealth(
    [
      { ...baseTool, id: 'a', name: 'A', launchCommand: 'true', port: busyPort },
      { ...baseTool, id: 'b', name: 'B', launchCommand: 'true' },
    ],
    [{ toolId: 'b', status: 'stopped' }],
  )
  assert.equal(all.length, 2)
  assert.equal(all.find((h) => h.toolId === 'a').launchable, false)
  assert.equal(all.find((h) => h.toolId === 'b').launchable, true)

  console.log('OK: tool health — batched port scan, folder/command/port checks')
} finally {
  server.close()
  fs.rmSync(realDir, { recursive: true, force: true })
}
