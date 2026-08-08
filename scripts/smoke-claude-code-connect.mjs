/**
 * Smoke: one-click Claude Code MCP merge / status / disconnect against a temp
 * ~/.claude.json. The file is Claude Code's live state file — foreign keys
 * (projects, numStartups, other servers) must survive every write.
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
  connectClaudeCodeMcp,
  disconnectClaudeCodeMcp,
  getClaudeCodeMcpStatus,
} = require('../dist-electron/shared/claude-code-mcp')

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shelf-claude-code-'))
const configPath = path.join(tmp, '.claude.json')
const serverPath = path.join(root, 'dist-mcp', 'mcp', 'server.js')

if (!fs.existsSync(serverPath)) {
  throw new Error(`Missing MCP bundle at ${serverPath}. Run npm run mcp:build first.`)
}

// Seed a realistic live state file: foreign top-level keys + another server.
fs.writeFileSync(
  configPath,
  JSON.stringify(
    {
      numStartups: 42,
      installMethod: 'brew',
      projects: { '/Users/x/proj': { allowedTools: [] } },
      mcpServers: {
        other: { command: 'echo', args: ['hi'] },
      },
    },
    null,
    2,
  ),
)

const before = await getClaudeCodeMcpStatus({ serverPath, configPath })
if (before.connected) throw new Error('Expected disconnected before connect')

const connected = await connectClaudeCodeMcp({ serverPath, configPath })
if (!connected.status.connected || !connected.status.matches) {
  throw new Error(`Connect failed: ${connected.status.message}`)
}
if (!connected.status.nodeOk) {
  throw new Error('Node resolution failed in smoke environment')
}
if (!connected.backupPath || !fs.existsSync(connected.backupPath)) {
  throw new Error('Expected a .shelf-backup when changing an existing file')
}

const raw = JSON.parse(fs.readFileSync(configPath, 'utf8'))
if (raw.numStartups !== 42 || raw.installMethod !== 'brew') {
  throw new Error('Foreign top-level keys were lost')
}
if (!raw.projects?.['/Users/x/proj']) throw new Error('projects key was lost')
if (!raw.mcpServers?.other) throw new Error('Merge wiped unrelated mcpServers.other')
if (!raw.mcpServers?.shelf?.args?.[0]) throw new Error('Missing shelf args')
if (path.resolve(raw.mcpServers.shelf.args[0]) !== path.resolve(serverPath)) {
  throw new Error('Shelf args do not point at MCP server')
}
console.log('OK: connected + preserved live state file keys')

const mid = await getClaudeCodeMcpStatus({ serverPath, configPath })
if (!mid.matches) throw new Error('Status should match after connect')

const disconnected = await disconnectClaudeCodeMcp({ serverPath, configPath })
if (disconnected.status.connected) throw new Error('Still connected after disconnect')
const after = JSON.parse(fs.readFileSync(configPath, 'utf8'))
if (after.mcpServers?.shelf) throw new Error('shelf key still present')
if (!after.mcpServers?.other) throw new Error('other server missing after disconnect')
if (after.numStartups !== 42) throw new Error('Foreign keys lost on disconnect')
console.log('OK: disconnected without harming the rest of the file')

fs.rmSync(tmp, { recursive: true, force: true })
console.log('OK: claude code connect smoke passed')
