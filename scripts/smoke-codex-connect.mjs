/**
 * Smoke: one-click Codex config.toml upsert / status / disconnect.
 * Uses a temp TOML file — never touches the real ~/.codex/config.toml.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const require = createRequire(import.meta.url)

const {
  connectCodexMcp,
  disconnectCodexMcp,
  getCodexMcpStatus,
} = require('../dist-electron/shared/codex-mcp')

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shelf-codex-'))
const configPath = path.join(tmp, 'config.toml')
const serverPath = path.join(root, 'dist-mcp', 'mcp', 'server.js')

if (!fs.existsSync(serverPath)) {
  throw new Error(`Missing MCP bundle at ${serverPath}. Run npm run mcp:build first.`)
}

// Seed a realistic Codex config with another MCP server + nested env table.
fs.writeFileSync(
  configPath,
  [
    'model = "gpt-test"',
    'approval_policy = "on-request"',
    '',
    '[mcp_servers.other]',
    'command = "echo"',
    'args = ["hi"]',
    '',
    '[mcp_servers.other.env]',
    'SECRET = "do-not-touch"',
    '',
  ].join('\n'),
)

const before = await getCodexMcpStatus({ serverPath, configPath })
if (before.connected) throw new Error('Expected disconnected before connect')

const connected = await connectCodexMcp({ serverPath, configPath })
if (!connected.status.connected || !connected.status.matches) {
  throw new Error(`Connect failed: ${connected.status.message}`)
}
if (!connected.status.nodeOk) {
  throw new Error('Node resolution failed in smoke environment')
}

const midText = fs.readFileSync(configPath, 'utf8')
if (!midText.includes('model = "gpt-test"')) {
  throw new Error('Connect wiped top-level Codex settings')
}
if (!midText.includes('[mcp_servers.other]')) {
  throw new Error('Connect wiped unrelated mcp_servers.other')
}
if (!midText.includes('SECRET = "do-not-touch"')) {
  throw new Error('Connect wiped nested env table')
}
if (!midText.includes('[mcp_servers.shelf]')) {
  throw new Error('Missing mcp_servers.shelf table')
}
if (!midText.includes(serverPath)) {
  throw new Error('Shelf args do not point at MCP server')
}
console.log('OK: connected + preserved other servers / secrets formatting')

// Re-connect should update path without duplicating the shelf table.
const altServer = path.join(tmp, 'alt-server.js')
fs.writeFileSync(altServer, '// stub\n')
const updated = await connectCodexMcp({ serverPath: altServer, configPath })
if (!updated.status.matches) throw new Error('Update should match new server path')
const updatedText = fs.readFileSync(configPath, 'utf8')
const shelfHeaders = updatedText.match(/\[mcp_servers\.shelf\]/g) || []
if (shelfHeaders.length !== 1) {
  throw new Error(`Expected one shelf table, found ${shelfHeaders.length}`)
}
console.log('OK: update replaces shelf table without duplicates')

const disconnected = await disconnectCodexMcp({ serverPath: altServer, configPath })
if (disconnected.status.connected) throw new Error('Still connected after disconnect')
const after = fs.readFileSync(configPath, 'utf8')
if (after.includes('[mcp_servers.shelf]')) throw new Error('shelf table still present')
if (!after.includes('[mcp_servers.other]')) throw new Error('other server missing after disconnect')
if (!after.includes('SECRET = "do-not-touch"')) {
  throw new Error('env secrets missing after disconnect')
}
console.log('OK: disconnected without harming other servers')

fs.rmSync(tmp, { recursive: true, force: true })
console.log('OK: codex connect smoke passed')
