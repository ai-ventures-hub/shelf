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

function run(label, command, args) {
  return new Promise((resolve, reject) => {
    console.log(`\n==> ${label}`)
    const env = { ...process.env }
    delete env.ELECTRON_RUN_AS_NODE
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

function assertLibraryPath() {
  const canonical = path.join(
    os.homedir(),
    'Library',
    'Application Support',
    'Shelf',
    'library.json',
  )
  if (!fs.existsSync(canonical)) {
    throw new Error(`Canonical library missing: ${canonical}`)
  }
  const parsed = JSON.parse(fs.readFileSync(canonical, 'utf8'))
  if (!Array.isArray(parsed.tools)) {
    throw new Error('Canonical library.json has invalid tools array')
  }
  console.log(`OK: library path ${canonical} (${parsed.tools.length} tools)`)
}

async function main() {
  assertLibraryPath()
  await run('process smoke', 'node', ['scripts/smoke-process.mjs'])
  await run('quick-open ranking', 'node', ['scripts/smoke-quick-open.mjs'])
  await run('electron compile', 'npx', ['tsc', '-p', 'tsconfig.electron.json'])
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

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
