/**
 * Pre-product gate: run process, path, electron, and MCP smokes in sequence.
 * Exit non-zero on first failure.
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const smokeDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'shelf-smoke-all-'))

function run(label, command, args) {
  return new Promise((resolve, reject) => {
    console.log(`\n==> ${label}`)
    const env = { ...process.env }
    delete env.ELECTRON_RUN_AS_NODE
    env.SHELF_DATA_ROOT = smokeDataRoot
    const child = spawn(command, args, {
      cwd: root,
      stdio: 'inherit',
      env,
    })
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${label} failed with exit code ${code}`))
    })
  })
}

async function main() {
  console.log(`OK: isolated smoke data root ${smokeDataRoot}`)
  await run('process smoke', 'node', ['scripts/smoke-process.mjs'])
  await run('quick-open ranking', 'node', ['scripts/smoke-quick-open.mjs'])
  await run('electron compile', 'npx', ['tsc', '-p', 'tsconfig.electron.json'])
  await run('library safety', 'node', ['scripts/smoke-library-safety.mjs'])
  await run('smart import', 'node', ['scripts/smoke-import.mjs'])
  await run('receipts', 'node', ['scripts/smoke-receipts.mjs'])
  await run('receipt export', 'node', ['scripts/smoke-receipt-export.mjs'])
  await run('shelf url', 'node', ['scripts/smoke-shelf-url.mjs'])
  await run('adopt-by-port', 'node', ['scripts/smoke-adopt.mjs'])
  await run('electron smoke', 'npx', ['electron', 'scripts/smoke-electron.cjs'])
  await run('mcp build', 'npm', ['run', 'mcp:build'])
  await run('claude connect', 'node', ['scripts/smoke-claude-connect.mjs'])
  await run('cursor connect', 'node', ['scripts/smoke-cursor-connect.mjs'])
  await run('codex connect', 'node', ['scripts/smoke-codex-connect.mjs'])
  await run('mcp path preference', 'node', ['scripts/smoke-mcp-path.mjs'])
  await run('mcp smoke', 'node', ['scripts/smoke-mcp.mjs'])
  console.log('\nOK: smoke:all passed')
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => {
    fs.rmSync(smokeDataRoot, { recursive: true, force: true })
  })
