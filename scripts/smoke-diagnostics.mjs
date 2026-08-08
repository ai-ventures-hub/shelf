/**
 * Smoke launch-diagnostics: log classifier codes, remedy mapping, and the
 * paste-ready error report.
 * Requires: tsc -p tsconfig.electron.json (smoke:all compile step).
 */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const {
  classifyLaunchFailure,
  buildErrorReport,
  remedyFor,
} = require('../dist-electron/shared/launch-diagnostics')

const at = new Date().toISOString()
const line = (text, stream = 'stderr') => ({ toolId: 't', stream, text, at })

const cases = [
  [[line("Error: Cannot find module 'express'")], 'deps_missing'],
  [[line('node:internal/modules/esm: ERR_MODULE_NOT_FOUND')], 'deps_missing'],
  [[line("ModuleNotFoundError: No module named 'flask'")], 'deps_missing'],
  [[line('zsh: command not found: pnpm')], 'runtime_missing'],
  [[line('npm ERR! Missing script: "dev"')], 'bad_launch_command'],
  [[line('Error: listen EADDRINUSE: address already in use :::3000')], 'port_in_use'],
  [
    [line('Cannot connect to the Docker daemon at unix:///var/run/docker.sock')],
    'docker_not_running',
  ],
  [[line('Segmentation fault')], 'app_crashed'],
  [[], 'app_crashed'],
]

for (const [logs, expected] of cases) {
  const { code } = classifyLaunchFailure(logs)
  assert.equal(code, expected, `expected ${expected} for ${logs[0]?.text || '(empty)'}`)
}
console.log(`OK: ${cases.length} classifier cases`)

// Newest line wins over older noise; system lines are ignored.
const mixed = classifyLaunchFailure([
  line('starting dev server…', 'stdout'),
  line("Cannot find module 'react'"),
  line('Launch: npm run dev', 'system'),
])
assert.equal(mixed.code, 'deps_missing')
assert.equal(mixed.detail, 'react')
console.log('OK: newest-first scan + detail extraction')

// Fallback override (port timeout path).
assert.equal(classifyLaunchFailure([], 'port_timeout').code, 'port_timeout')

// Remedy map spot checks.
assert.equal(remedyFor('deps_missing'), 'install_deps')
assert.equal(remedyFor('port_in_use'), 'reassign_port')
assert.equal(remedyFor('app_crashed'), 'copy_ai_report')
assert.equal(remedyFor('stop_refused_not_owner'), undefined)
console.log('OK: remedy mapping')

// Error report: leads with facts, includes tail, skips system lines.
const report = buildErrorReport(
  {
    name: 'Demo',
    projectPath: '/tmp/demo',
    launchCommand: 'npm run dev',
    port: 3000,
    url: 'http://localhost:3000',
  },
  { status: 'error', message: 'Process exited', exitCode: 1, code: 'deps_missing' },
  [line('Launch: npm run dev', 'system'), line("Cannot find module 'react'")],
)
assert.ok(report.includes('## Shelf launch report'))
assert.ok(report.includes('Launch command: npm run dev'))
assert.ok(report.includes('(deps_missing)'))
assert.ok(report.includes("Cannot find module 'react'"))
assert.ok(!report.includes('Launch: npm run dev\n'), 'system lines excluded from tail')
console.log('OK: error report content')

console.log('OK: diagnostics smoke passed')
