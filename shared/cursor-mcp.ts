/**
 * One-click Cursor MCP install.
 * Safely merges mcpServers.shelf into ~/.cursor/mcp.json without wiping other servers.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { mcpPathMigrationHint } from './mcp-server-path'
import { resolveNodeCommand } from './node-resolve'

export const CURSOR_MCP_SERVER_KEY = 'shelf'

export interface CursorMcpServerEntry {
  command: string
  args: string[]
  env?: Record<string, string>
}

export interface CursorMcpConfigFile {
  mcpServers?: Record<string, CursorMcpServerEntry | unknown>
  [key: string]: unknown
}

export interface CursorMcpStatus {
  /** Shelf entry present in ~/.cursor/mcp.json. */
  connected: boolean
  /** True when shelf entry exists and points at this Shelf MCP bundle. */
  matches: boolean
  configPath: string
  configExists: boolean
  serverPath: string
  serverOk: boolean
  nodeCommand: string
  nodeOk: boolean
  nodePath?: string
  message: string
}

export interface CursorConnectResult {
  status: CursorMcpStatus
  /** Written only when we overwrite an existing config file. */
  backupPath?: string
}

export function resolveCursorMcpConfigPath(home = os.homedir()): string {
  return path.join(home, '.cursor', 'mcp.json')
}

export function readCursorMcpConfig(configPath: string): CursorMcpConfigFile {
  if (!fs.existsSync(configPath)) return { mcpServers: {} }
  try {
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf8')) as CursorMcpConfigFile
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error('Config root must be a JSON object.')
    }
    if (!raw.mcpServers || typeof raw.mcpServers !== 'object') {
      raw.mcpServers = {}
    }
    return raw
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(`Could not read Cursor MCP config: ${message}`)
  }
}

function writeAtomic(configPath: string, data: CursorMcpConfigFile): void {
  fs.mkdirSync(path.dirname(configPath), { recursive: true })
  const tmp = `${configPath}.tmp`
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
  fs.renameSync(tmp, configPath)
}

function shelfEntry(
  nodeCommand: string,
  serverPath: string,
  env?: Record<string, string>,
): CursorMcpServerEntry {
  return {
    command: nodeCommand,
    args: [serverPath],
    ...(env ? { env } : {}),
  }
}

function entryMatches(
  entry: unknown,
  serverPath: string,
): entry is CursorMcpServerEntry {
  if (!entry || typeof entry !== 'object') return false
  const rec = entry as CursorMcpServerEntry
  if (!Array.isArray(rec.args) || rec.args.length === 0) return false
  return path.resolve(String(rec.args[0])) === path.resolve(serverPath)
}

export async function getCursorMcpStatus(opts: {
  serverPath: string
  configPath?: string
  nodeCommand?: string
}): Promise<CursorMcpStatus> {
  const configPath = opts.configPath || resolveCursorMcpConfigPath()
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
  let message = 'Cursor is not connected yet.'

  if (configExists) {
    try {
      const config = readCursorMcpConfig(configPath)
      const entry = config.mcpServers?.[CURSOR_MCP_SERVER_KEY]
      if (entry) {
        connected = true
        matches = entryMatches(entry, opts.serverPath)
        if (!matches) {
          const configured =
            entry && typeof entry === 'object' && Array.isArray((entry as CursorMcpServerEntry).args)
              ? String((entry as CursorMcpServerEntry).args[0] || '')
              : undefined
          message =
            mcpPathMigrationHint(opts.serverPath, configured) ||
            'A Shelf entry exists but points at a different MCP path. Connect again to update it.'
        } else {
          message =
            'Installed in Cursor’s MCP config. Reload MCP in Cursor Settings (or restart Cursor), then ask: “List my Shelf tools.”'
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
 * Merge mcpServers.shelf into ~/.cursor/mcp.json (create file if needed).
 * Backs up an existing file once per connect when content would change.
 */
export async function connectCursorMcp(opts: {
  serverPath: string
  configPath?: string
}): Promise<CursorConnectResult> {
  const configPath = opts.configPath || resolveCursorMcpConfigPath()
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
  const config = existed ? readCursorMcpConfig(configPath) : { mcpServers: {} }
  const nextEntry = shelfEntry(node.command, opts.serverPath, node.env)
  const mcpServers = {
    ...(config.mcpServers || {}),
    [CURSOR_MCP_SERVER_KEY]: nextEntry,
  }
  const next: CursorMcpConfigFile = { ...config, mcpServers }
  const nextText = `${JSON.stringify(next, null, 2)}\n`

  let backupPath: string | undefined
  if (existed && previousText.trim() !== nextText.trim()) {
    backupPath = `${configPath}.shelf-backup`
    fs.writeFileSync(backupPath, previousText, 'utf8')
  }

  writeAtomic(configPath, next)

  const status = await getCursorMcpStatus({
    serverPath: opts.serverPath,
    configPath,
    nodeCommand: node.command,
  })
  status.message =
    'Installed in Cursor’s MCP config. Reload MCP (Settings → MCP) or restart Cursor, then ask: “List my Shelf tools.”'
  return { status, backupPath }
}

/** Remove only mcpServers.shelf; leave every other Cursor MCP server alone. */
export async function disconnectCursorMcp(opts: {
  serverPath: string
  configPath?: string
}): Promise<CursorConnectResult> {
  const configPath = opts.configPath || resolveCursorMcpConfigPath()
  if (!fs.existsSync(configPath)) {
    const status = await getCursorMcpStatus({
      serverPath: opts.serverPath,
      configPath,
    })
    status.message = 'Cursor was not connected.'
    return { status }
  }

  const config = readCursorMcpConfig(configPath)
  if (config.mcpServers && CURSOR_MCP_SERVER_KEY in config.mcpServers) {
    delete config.mcpServers[CURSOR_MCP_SERVER_KEY]
    writeAtomic(configPath, config)
  }

  const status = await getCursorMcpStatus({
    serverPath: opts.serverPath,
    configPath,
  })
  status.message = 'Shelf removed from Cursor MCP. Reload MCP or restart Cursor to apply.'
  return { status }
}

export const CURSOR_TEST_PROMPT = 'List my Shelf tools and tell me which ones are running.'
