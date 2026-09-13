export type { DetectableMcpClient, McpClientDetection } from './contracts'
import type { DetectableMcpClient, McpClientDetection } from './contracts'
/**
 * Which MCP clients are installed on this Mac? Pure filesystem probes — no
 * process spawns, no network. Simple mode uses this to show only the AI apps
 * the user actually has ("connect what you use").
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const PROBES: Record<DetectableMcpClient, (home: string) => string[]> = {
  claude: () => ['/Applications/Claude.app'],
  'claude-code': (home) => [
    path.join(home, '.claude.json'),
    path.join(home, '.claude'),
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude',
    path.join(home, '.local', 'bin', 'claude'),
  ],
  cursor: (home) => ['/Applications/Cursor.app', path.join(home, '.cursor')],
  codex: (home) => [path.join(home, '.codex'), '/Applications/ChatGPT.app'],
}

export function detectInstalledClients(
  home = os.homedir(),
): McpClientDetection[] {
  return (Object.keys(PROBES) as DetectableMcpClient[]).map((kind) => {
    const evidence = PROBES[kind](home).find((p) => fs.existsSync(p))
    return { kind, installed: Boolean(evidence), evidence }
  })
}
