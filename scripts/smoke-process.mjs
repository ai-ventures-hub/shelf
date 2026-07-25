/**
 * Smoke-tests the same launch pattern Shelf uses:
 * login zsh shell, cwd, port readiness, process-group stop.
 */
import { spawn } from 'node:child_process'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const cwd = path.join(root, 'fixtures/sample-tool')
const port = 8765
const command = `PORT=${port} node server.mjs`

function waitForPort(targetPort, timeoutMs = 15_000) {
  const started = Date.now()
  return new Promise((resolve, reject) => {
    const tick = () => {
      const socket = net.connect({ host: '127.0.0.1', port: targetPort }, () => {
        socket.end()
        resolve(true)
      })
      socket.on('error', () => {
        socket.destroy()
        if (Date.now() - started >= timeoutMs) {
          reject(new Error(`Port ${targetPort} not ready in time`))
          return
        }
        setTimeout(tick, 200)
      })
    }
    tick()
  })
}

const child = spawn('/bin/zsh', ['-lc', command], {
  cwd,
  detached: true,
  stdio: ['ignore', 'pipe', 'pipe'],
})

let output = ''
child.stdout.on('data', (buf) => {
  output += buf.toString()
  process.stdout.write(buf)
})
child.stderr.on('data', (buf) => {
  output += buf.toString()
  process.stderr.write(buf)
})

try {
  await waitForPort(port)
  console.log('OK: port ready')
  if (!output.includes('Sample tool listening')) {
    throw new Error('Expected ready log line missing')
  }
  console.log('OK: launch log observed')
} finally {
  if (child.pid) {
    try {
      process.kill(-child.pid, 'SIGTERM')
    } catch {
      child.kill('SIGTERM')
    }
  }
}

await new Promise((resolve) => setTimeout(resolve, 500))
console.log('OK: process stopped')
