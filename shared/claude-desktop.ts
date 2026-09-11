/**
 * One-click Claude Desktop MCP install.
 * Safely merges mcpServers.shelf into claude_desktop_config.json without wiping other servers.
 */
import fs from 'node:fs'
import { configuredCommandExists } from './client-observation'
import { replaceClientConfig } from './client-config-file'
import os from 'node:os'
import path from 'node:path'
import { mcpPathMigrationHint } from './mcp-server-path'
import { resolveNodeCommand } from './node-resolve'

export const CLAUDE_MCP_SERVER_KEY = 'shelf'
export { resolveNodeCommand } from './node-resolve'

export interface ClaudeMcpServerEntry {
  command: string
  args: string[]
  env?: Record<string, string>
}

export interface ClaudeDesktopConfigFile {
  mcpServers?: Record<string, ClaudeMcpServerEntry | unknown>
  [key: string]: unknown
}

export interface ClaudeDesktopStatus {
  /** Shelf entry present in claude_desktop_config.json. */
  connected: boolean
  /** True when shelf entry exists and points at this Shelf MCP bundle. */
  matches: boolean
  /**
   * True when Claude’s MCP logs show it actually spawned Shelf.
   * Config can be installed while Claude still needs a full Quit/relaunch.
   */
  claudeLoaded: boolean
  configPath: string
  configExists: boolean
  serverPath: string
  serverOk: boolean
  nodeCommand: string
  nodeOk: boolean
  nodePath?: string
  message: string
}

export interface ClaudeConnectResult {
  status: ClaudeDesktopStatus
  /** Written only when we overwrite an existing config file. */
  backupPath?: string
}

export function resolveClaudeDesktopConfigPath(home = os.homedir()): string {
  return path.join(
    home,
    'Library',
    'Application Support',
    'Claude',
    'claude_desktop_config.json',
  )
}

export function readClaudeDesktopConfig(configPath: string): ClaudeDesktopConfigFile {
  if (!fs.existsSync(configPath)) return { mcpServers: {} }
  try {
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf8')) as ClaudeDesktopConfigFile
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error('Config root must be a JSON object.')
    }
    if (!raw.mcpServers || typeof raw.mcpServers !== 'object') {
      raw.mcpServers = {}
    }
    return raw
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(`Could not read Claude Desktop config: ${message}`)
  }
}

function writeAtomic(configPath: string, data: ClaudeDesktopConfigFile, previousText: string): void {
  fs.mkdirSync(path.dirname(configPath), { recursive: true })
  replaceClientConfig(configPath, `${JSON.stringify(data, null, 2)}\n`, previousText)
}

function shelfEntry(
  nodeCommand: string,
  serverPath: string,
  env?: Record<string, string>,
): ClaudeMcpServerEntry {
  return {
    command: nodeCommand,
    args: [serverPath],
    ...(env ? { env } : {}),
  }
}

function entryMatches(
  entry: unknown,
  serverPath: string,
): entry is ClaudeMcpServerEntry {
  if (!entry || typeof entry !== 'object') return false
  const rec = entry as ClaudeMcpServerEntry
  if (!Array.isArray(rec.args) || rec.args.length === 0) return false
  return path.resolve(String(rec.args[0])) === path.resolve(serverPath)
}

/** Claude writes per-server logs once it actually spawns an MCP process. */
export function detectClaudeLoadedShelf(): boolean {
  const logDir = path.join(os.homedir(), 'Library', 'Logs', 'Claude')
  const dedicated = path.join(logDir, 'mcp-server-shelf.log')
  if (fs.existsSync(dedicated) && fs.statSync(dedicated).size > 0) return true
  const mcpLog = path.join(logDir, 'mcp.log')
  if (!fs.existsSync(mcpLog)) return false
  try {
    const stat = fs.statSync(mcpLog)
    const fd = fs.openSync(mcpLog, 'r')
    const max = 256_000
    const start = Math.max(0, stat.size - max)
    const buf = Buffer.alloc(stat.size - start)
    fs.readSync(fd, buf, 0, buf.length, start)
    fs.closeSync(fd)
    return /\[shelf\]/i.test(buf.toString('utf8'))
  } catch {
    return false
  }
}

export async function getClaudeDesktopStatus(opts: {
  serverPath: string
  configPath?: string
  nodeCommand?: string
}): Promise<ClaudeDesktopStatus> {
  const configPath = opts.configPath || resolveClaudeDesktopConfigPath()
  const serverOk = Boolean(opts.serverPath && fs.existsSync(opts.serverPath))
  const node = opts.nodeCommand
    ? {
        command: opts.nodeCommand,
        ok: opts.nodeCommand === 'node' ? true : fs.existsSync(opts.nodeCommand),
        path: opts.nodeCommand === 'node' ? undefined : opts.nodeCommand,
      }
    : await resolveNodeCommand()

  const configExists = fs.existsSync(configPath)
  let connected = false
  let matches = false
  let message = 'Claude Desktop is not connected yet.'
  const claudeLoaded = detectClaudeLoadedShelf()

  if (configExists) {
    try {
      const previousText = fs.readFileSync(configPath, 'utf8')
  const config = readClaudeDesktopConfig(configPath)
      const entry = config.mcpServers?.[CLAUDE_MCP_SERVER_KEY]
      if (entry) {
        connected = true
        matches = entryMatches(entry, opts.serverPath) && configuredCommandExists((entry as { command?: unknown }).command) && (entry as { disabled?: boolean; enabled?: boolean }).disabled !== true && (entry as { enabled?: boolean }).enabled !== false
        if (!matches) {
          const configured =
            entry && typeof entry === 'object' && Array.isArray((entry as ClaudeMcpServerEntry).args)
              ? String((entry as ClaudeMcpServerEntry).args[0] || '')
              : undefined
          message =
            mcpPathMigrationHint(opts.serverPath, configured) ||
            'A Shelf entry exists but points at a different MCP path. Connect again to update it.'
        } else if (claudeLoaded) {
          message =
            'Live in Claude. Ask: “List my Shelf tools.” Look under chat + → Connectors (Desktop), not only the Settings → Connectors web list.'
        } else {
          message =
            'Installed in Claude’s config. Fully Quit Claude (Claude menu → Quit), reopen it, then ask: “List my Shelf tools.” Closing the window is not enough.'
        }
      }
    } catch (err) {
      message = err instanceof Error ? err.message : String(err)
    }
  }

  if (!serverOk) {
    message = 'Shelf MCP server file is missing. Rebuild with npm run mcp:build or reinstall Shelf.'
  } else if (!node.ok) {
    message =
      'Node.js was not found. Install Node 20+ (nodejs.org), then Connect again.'
  }

  return {
    connected,
    matches,
    claudeLoaded,
    configPath,
    configExists,
    serverPath: opts.serverPath,
    serverOk,
    nodeCommand: node.command,
    nodeOk: node.ok,
    nodePath: node.path,
    message,
  }
}

/**
 * Merge mcpServers.shelf into Claude Desktop config (create file if needed).
 * Backs up an existing file once per connect when content would change.
 */
export async function connectClaudeDesktop(opts: {
  serverPath: string
  configPath?: string
}): Promise<ClaudeConnectResult> {
  const configPath = opts.configPath || resolveClaudeDesktopConfigPath()
  if (!opts.serverPath || !fs.existsSync(opts.serverPath)) {
    throw new Error('Shelf MCP server file not found. Rebuild or reinstall Shelf first.')
  }

  const node = await resolveNodeCommand()
  if (!node.ok) {
    throw new Error(
      'Node.js was not found on this Mac. Install Node 20+ from nodejs.org, then try again.',
    )
  }

  const existed = fs.existsSync(configPath)
  const previousText = existed ? fs.readFileSync(configPath, 'utf8') : ''
  const config = existed ? readClaudeDesktopConfig(configPath) : { mcpServers: {} }
  const nextEntry = shelfEntry(node.command, opts.serverPath, node.env)
  const mcpServers = {
    ...(config.mcpServers || {}),
    [CLAUDE_MCP_SERVER_KEY]: nextEntry,
  }
  const next: ClaudeDesktopConfigFile = { ...config, mcpServers }
  const nextText = `${JSON.stringify(next, null, 2)}\n`

  const backupPath = replaceClientConfig(configPath, nextText, previousText)

  const status = await getClaudeDesktopStatus({
    serverPath: opts.serverPath,
    configPath,
    nodeCommand: node.command,
  })
  status.message =
    'Installed in Claude’s config. Fully Quit Claude (menu → Quit), reopen, then ask: “List my Shelf tools.”'
  return { status, backupPath }
}

/** Remove only mcpServers.shelf; leave every other Claude setting alone. */
export async function disconnectClaudeDesktop(opts: {
  serverPath: string
  configPath?: string
}): Promise<ClaudeConnectResult> {
  const configPath = opts.configPath || resolveClaudeDesktopConfigPath()
  if (!fs.existsSync(configPath)) {
    const status = await getClaudeDesktopStatus({
      serverPath: opts.serverPath,
      configPath,
    })
    status.message = 'Claude Desktop was not connected.'
    return { status }
  }

  const previousText = fs.readFileSync(configPath, 'utf8')
  const config = readClaudeDesktopConfig(configPath)
  if (config.mcpServers && CLAUDE_MCP_SERVER_KEY in config.mcpServers) {
    delete config.mcpServers[CLAUDE_MCP_SERVER_KEY]
    writeAtomic(configPath, config, previousText)
  }

  const status = await getClaudeDesktopStatus({
    serverPath: opts.serverPath,
    configPath,
  })
  status.message = 'Shelf removed from Claude Desktop. Restart Claude to apply.'
  return { status }
}

export const CLAUDE_TEST_PROMPT = 'List my Shelf tools and tell me which ones are running.'
