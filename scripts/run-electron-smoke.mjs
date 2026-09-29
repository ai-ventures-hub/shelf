/**
 * Run one real-renderer Electron check with a bounded lifetime.
 *
 * Each check prints `SMOKE_RESULT pass` or `SMOKE_RESULT fail` right before
 * app.exit(), and that line is the verdict. Electron has hung in native
 * shutdown on a CI runner after a check had already passed (PR #12: 27
 * minutes, until the job timeout), so a process still alive 10 s after its
 * verdict is killed, and a check with no verdict within the limit fails.
 *
 * Usage: node scripts/run-electron-smoke.mjs scripts/smoke-compact-ui.cjs
 */
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const script = process.argv[2]
if (!script) {
  console.error('Usage: node scripts/run-electron-smoke.mjs <check.cjs>')
  process.exit(2)
}

const EXIT_GRACE_MS = 10_000
const LIMIT_MS = Number(process.env.SHELF_ELECTRON_SMOKE_LIMIT_MS) || 180_000
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

// Required from Node, the electron package resolves to its binary's path.
const child = spawn(require('electron'), [script], {
  env,
  stdio: ['ignore', 'pipe', 'inherit'],
  // Own process group, so the renderer and GPU helpers go with it.
  detached: true,
})

let verdict = null
let tail = ''
let finished = false

child.stdout.on('data', (chunk) => {
  process.stdout.write(chunk)
  tail = (tail + chunk.toString()).slice(-4096)
  const match = !verdict && tail.match(/^SMOKE_RESULT (pass|fail)\s*$/m)
  if (match) {
    verdict = match[1]
    setTimeout(() => stop(`did not exit within ${EXIT_GRACE_MS / 1000}s of its "${verdict}" result`), EXIT_GRACE_MS).unref()
  }
})

const limit = setTimeout(() => stop(`printed no result within ${LIMIT_MS / 1000}s`), LIMIT_MS)

function killGroup() {
  try {
    process.kill(-child.pid, 'SIGKILL')
  } catch {
    // Already gone.
  }
}

function stop(reason) {
  if (finished) return
  console.error(`run-electron-smoke: ${script} ${reason}; stopping Electron.`)
  killGroup()
  finish(null)
}

function finish(code) {
  if (finished) return
  finished = true
  clearTimeout(limit)
  killGroup()
  const passed = verdict ? verdict === 'pass' : code === 0
  if (!verdict) console.error(`run-electron-smoke: ${script} exited ${code ?? 'after being stopped'} without a result line.`)
  process.exit(passed ? 0 : 1)
}

child.on('exit', (code) => finish(code))
child.on('error', (error) => {
  console.error(`run-electron-smoke: could not start Electron: ${error.message}`)
  finish(1)
})
