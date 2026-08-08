/**
 * Smoke project-bootstrap: need detection by lockfile, dependency-less skip,
 * streamed run success, and the hard timeout.
 * Requires: tsc -p tsconfig.electron.json (smoke:all compile step).
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const {
  detectBootstrapNeeds,
  runBootstrap,
} = require('../dist-electron/shared/project-bootstrap')

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shelf-bootstrap-'))

function project(name, files) {
  const dir = path.join(tmp, name)
  fs.mkdirSync(dir, { recursive: true })
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true })
    fs.writeFileSync(path.join(dir, rel), content)
  }
  return dir
}

try {
  // Lockfile → matching package manager.
  const pnpmDir = project('pnpm-proj', {
    'package.json': JSON.stringify({ dependencies: { react: '^19' } }),
    'pnpm-lock.yaml': '',
  })
  assert.equal(detectBootstrapNeeds(pnpmDir)[0]?.command, 'pnpm install')

  const npmDir = project('npm-proj', {
    'package.json': JSON.stringify({ devDependencies: { vite: '^6' } }),
  })
  assert.equal(detectBootstrapNeeds(npmDir)[0]?.command, 'npm install')

  // Dependency-less package.json → no install step.
  const bareDir = project('bare-proj', {
    'package.json': JSON.stringify({ name: 'bare', scripts: { start: 'node x' } }),
  })
  assert.equal(detectBootstrapNeeds(bareDir).length, 0)

  // node_modules present → nothing to do.
  const installedDir = project('installed-proj', {
    'package.json': JSON.stringify({ dependencies: { react: '^19' } }),
    'node_modules/.keep': '',
  })
  assert.equal(detectBootstrapNeeds(installedDir).length, 0)

  // Python requirements without venv → venv + pip step.
  const pyDir = project('py-proj', { 'requirements.txt': 'flask\n' })
  const pySteps = detectBootstrapNeeds(pyDir)
  assert.ok(pySteps[0]?.command.includes('python3 -m venv .venv'))
  console.log('OK: bootstrap need detection')

  // runBootstrap streams output and reports success.
  const logs = []
  const okRun = await runBootstrap(
    { command: 'echo installing && echo done > marker.txt', label: 'stub install' },
    { cwd: npmDir, onLog: (stream, text) => logs.push(`${stream}:${text.trim()}`) },
  )
  assert.equal(okRun.ok, true)
  assert.equal(okRun.exitCode, 0)
  assert.ok(fs.existsSync(path.join(npmDir, 'marker.txt')))
  assert.ok(logs.some((l) => l.includes('installing')))
  console.log('OK: bootstrap run streams and succeeds')

  // Failure exit code propagates.
  const failRun = await runBootstrap(
    { command: 'exit 7', label: 'stub failure' },
    { cwd: npmDir },
  )
  assert.equal(failRun.ok, false)
  assert.equal(failRun.exitCode, 7)

  // Hard timeout kills the process group.
  const started = Date.now()
  const timedOut = await runBootstrap(
    { command: 'sleep 30', label: 'stub hang' },
    { cwd: npmDir, timeoutMs: 500 },
  )
  assert.equal(timedOut.ok, false)
  assert.equal(timedOut.endedBy, 'timeout')
  assert.ok(Date.now() - started < 10_000, 'timeout must not wait for sleep')
  console.log('OK: bootstrap timeout kill')

  console.log('OK: bootstrap smoke passed')
} finally {
  fs.rmSync(tmp, { recursive: true, force: true })
}
