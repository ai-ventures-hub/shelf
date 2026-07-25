/**
 * Smoke: one-click Claude Desktop config merge / status / disconnect.
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
  connectClaudeDesktop,
  disconnectClaudeDesktop,
  getClaudeDesktopStatus,
} = require('../dist-electron/shared/claude-desktop')

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shelf-claude-'))
const configPath = path.join(tmp, 'claude_desktop_config.json')
const serverPath = path.join(root, 'dist-mcp', 'mcp', 'server.js')

if (!fs.existsSync(serverPath)) {
  throw new Error(`Missing MCP bundle at ${serverPath}. Run npm run mcp:build first.`)
}

// Pre-seed another MCP server so merge must preserve it.
fs.writeFileSync(
  configPath,
  JSON.stringify(
    {
      mcpServers: {
        other: { command: 'echo', args: ['hi'] },
      },
    },
    null,
    2,
  ),
)

const before = await getClaudeDesktopStatus({ serverPath, configPath })
if (before.connected) throw new Error('Expected disconnected before connect')

const connected = await connectClaudeDesktop({ serverPath, configPath })
if (!connected.status.connected || !connected.status.matches) {
  throw new Error(`Connect failed: ${connected.status.message}`)
}
if (!connected.status.nodeOk) {
  throw new Error('Node resolution failed in smoke environment')
}

const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'))
if (!raw.mcpServers?.other) throw new Error('Merge wiped unrelated mcpServers.other')
if (!raw.mcpServers?.shelf?.args?.[0]) throw new Error('Missing shelf args')
if (path.resolve(raw.mcpServers.shelf.args[0]) !== path.resolve(serverPath)) {
  throw new Error('Shelf args do not point at MCP server')
}
console.log('OK: connected + preserved other server')

const mid = await getClaudeDesktopStatus({ serverPath, configPath })
if (!mid.matches) throw new Error('Status should match after connect')

const disconnected = await disconnectClaudeDesktop({ serverPath, configPath })
if (disconnected.status.connected) throw new Error('Still connected after disconnect')
const after = JSON.parse(fs.readFileSync(configPath, 'utf8'))
if (after.mcpServers?.shelf) throw new Error('shelf key still present')
if (!after.mcpServers?.other) throw new Error('other server missing after disconnect')
console.log('OK: disconnected without harming other servers')

fs.rmSync(tmp, { recursive: true, force: true })
console.log('OK: claude connect smoke passed')
