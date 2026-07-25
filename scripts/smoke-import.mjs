/**
 * Smoke smart project import against temp fixtures + sample-tool.
 * Requires: npx tsc -p tsconfig.electron.json (or smoke:all compile step).
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const require = createRequire(import.meta.url)

const { inspectProject } = require('../dist-electron/shared/project-import.js')

async function withTempDir(prefix, files, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  try {
    for (const [rel, body] of Object.entries(files)) {
      const abs = path.join(dir, rel)
      fs.mkdirSync(path.dirname(abs), { recursive: true })
      fs.writeFileSync(abs, body)
    }
    await fn(dir)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

await withTempDir(
  'shelf-import-vite-',
  {
    'package.json': JSON.stringify(
      {
        name: 'demo-vite-app',
        description: 'A tiny Vite demo',
        scripts: { dev: 'vite', build: 'vite build' },
        devDependencies: { vite: '^6.0.0', react: '^19.0.0' },
      },
      null,
      2,
    ),
    'vite.config.ts': 'export default {}\n',
    'pnpm-lock.yaml': 'lockfileVersion: 9.0\n',
    'DESIGN.md': '# Design\n',
  },
  async (dir) => {
    const result = await inspectProject(dir)
    assert.equal(result.name, 'Demo Vite App')
    // May be prefixed with PORT=… when the preferred port is busy.
    assert.match(result.launchCommand || '', /pnpm run dev/)
    assert.equal(result.portPreferred, 5173)
    assert.ok(typeof result.port === 'number')
    assert.ok(result.tags.includes('Vite'))
    assert.equal(result.designMd.found, true)
    assert.ok(['high', 'medium'].includes(result.confidence))
    console.log('OK: vite fixture', result.launchCommand, `port ${result.port}`)
  },
)

await withTempDir(
  'shelf-import-py-',
  {
    'requirements.txt': 'flask\n',
    'app.py': 'print("hi")\n',
  },
  async (dir) => {
    // Fake a venv binary path without a real interpreter.
    fs.mkdirSync(path.join(dir, '.venv', 'bin'), { recursive: true })
    fs.writeFileSync(path.join(dir, '.venv', 'bin', 'python'), '#!/bin/sh\n')
    fs.chmodSync(path.join(dir, '.venv', 'bin', 'python'), 0o755)

    const result = await inspectProject(dir)
    assert.match(result.launchCommand || '', /\.venv\/bin\/python app\.py/)
    assert.ok(result.tags.includes('Python'))
    console.log('OK: python fixture', result.launchCommand)
  },
)

const sample = path.join(root, 'fixtures', 'sample-tool')
const sampleResult = await inspectProject(sample)
assert.match(sampleResult.launchCommand || '', /npm run start/)
assert.equal(sampleResult.portPreferred, 8765)
assert.ok(sampleResult.port === 8765 || sampleResult.portPreferred === 8765)
console.log('OK: sample-tool', sampleResult.launchCommand, `port ${sampleResult.port}`)

console.log('OK: smart import smoke passed')
