/**
 * One-click Claude Code MCP install (user scope: every project).
 * ~/.claude.json is Claude Code's live state file — it holds much more than
 * mcpServers and Claude Code rewrites it itself, so the merge here must
 * preserve every unknown key and only ever touch mcpServers.shelf.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { mcpPathMigrationHint } from './mcp-server-path'
import { resolveNodeCommand } from './node-resolve'

export const CLAUDE_CODE_MCP_SERVER_KEY = 'shelf'

export interface ClaudeCodeMcpServerEntry {
  command: string
  args: string[]
  env?: Record<string, string>
}

export interface ClaudeCodeConfigFile {
  mcpServers?: Record<string, ClaudeCodeMcpServerEntry | unknown>
  [key: string]: unknown
}

export interface ClaudeCodeMcpStatus {
  /** Shelf entry present in ~/.claude.json. */
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

export interface ClaudeCodeConnectResult {
  status: ClaudeCodeMcpStatus
  /** Written only when we overwrite an existing config file. */
  backupPath?: string
}

export function resolveClaudeCodeConfigPath(home = os.homedir()): string {
  return path.join(home, '.claude.json')
}

/** True when Claude Code has run on this Mac (config or state dir present). */
export function detectClaudeCodeInstalled(home = os.homedir()): boolean {
  return (
    fs.existsSync(path.join(home, '.claude.json')) ||
    fs.existsSync(path.join(home, '.claude'))
  )
}

export function readClaudeCodeConfig(configPath: string): ClaudeCodeConfigFile {
  if (!fs.existsSync(configPath)) return { mcpServers: {} }
  try {
    const raw = JSON.parse(
      fs.readFileSync(configPath, 'utf8'),
    ) as ClaudeCodeConfigFile
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error('Config root must be a JSON object.')
    }
    if (!raw.mcpServers || typeof raw.mcpServers !== 'object') {
      raw.mcpServers = {}
    }
    return raw
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(`Could not read Claude Code config: ${message}`)
  }
}

function writeAtomic(configPath: string, data: ClaudeCodeConfigFile): void {
  fs.mkdirSync(path.dirname(configPath), { recursive: true })
  const tmp = `${configPath}.tmp`
  fs.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
  fs.renameSync(tmp, configPath)
}

function shelfEntry(
  nodeCommand: string,
  serverPath: string,
  env?: Record<string, string>,
): ClaudeCodeMcpServerEntry {
  return {
    command: nodeCommand,
    args: [serverPath],
    ...(env ? { env } : {}),
  }
}

function entryMatches(
  entry: unknown,
  serverPath: string,
): entry is ClaudeCodeMcpServerEntry {
  if (!entry || typeof entry !== 'object') return false
  const rec = entry as ClaudeCodeMcpServerEntry
  if (!Array.isArray(rec.args) || rec.args.length === 0) return false
  return path.resolve(String(rec.args[0])) === path.resolve(serverPath)
}

export async function getClaudeCodeMcpStatus(opts: {
  serverPath: string
  configPath?: string
  nodeCommand?: string
}): Promise<ClaudeCodeMcpStatus> {
  const configPath = opts.configPath || resolveClaudeCodeConfigPath()
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
  let message = 'Claude Code is not connected yet.'

  if (configExists) {
    try {
      const config = readClaudeCodeConfig(configPath)
      const entry = config.mcpServers?.[CLAUDE_CODE_MCP_SERVER_KEY]
      if (entry) {
        connected = true
        matches = entryMatches(entry, opts.serverPath)
        if (!matches) {
          const configured =
            entry &&
            typeof entry === 'object' &&
            Array.isArray((entry as ClaudeCodeMcpServerEntry).args)
              ? String((entry as ClaudeCodeMcpServerEntry).args[0] || '')
              : undefined
          message =
            mcpPathMigrationHint(opts.serverPath, configured) ||
            'A Shelf entry exists but points at a different MCP path. Connect again to update it.'
        } else {
          message =
            'Installed for Claude Code (all projects). Start a new Claude Code session, then ask: “List my Shelf tools.”'
        }
      }
    } catch (err) {
      message = err instanceof Error ? err.message : String(err)
    }
  }

  if (!serverOk) {
    message =
      'Shelf MCP server file is missing. Rebuild with npm run mcp:build or reinstall Shelf.'
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
 * Merge mcpServers.shelf into ~/.claude.json (create file if needed).
 * Backs up an existing file once per connect when content would change.
 */
export async function connectClaudeCodeMcp(opts: {
  serverPath: string
  configPath?: string
}): Promise<ClaudeCodeConnectResult> {
  const configPath = opts.configPath || resolveClaudeCodeConfigPath()
  if (!opts.serverPath || !fs.existsSync(opts.serverPath)) {
    throw new Error(
      'Shelf MCP server file not found. Rebuild or reinstall Shelf first.',
    )
  }

  const node = await resolveNodeCommand()
  if (!node.ok) {
    throw new Error(
      'Node.js was not found on this Mac. Install Node 20+ from nodejs.org, then try again.',
    )
  }

  const existed = fs.existsSync(configPath)
  const previousText = existed ? fs.readFileSync(configPath, 'utf8') : ''
  const config = existed ? readClaudeCodeConfig(configPath) : { mcpServers: {} }
  const nextEntry = shelfEntry(node.command, opts.serverPath, node.env)
  const mcpServers = {
    ...(config.mcpServers || {}),
    [CLAUDE_CODE_MCP_SERVER_KEY]: nextEntry,
  }
  const next: ClaudeCodeConfigFile = { ...config, mcpServers }
  const nextText = `${JSON.stringify(next, null, 2)}\n`

  let backupPath: string | undefined
  if (existed && previousText.trim() !== nextText.trim()) {
    backupPath = `${configPath}.shelf-backup`
    fs.writeFileSync(backupPath, previousText, 'utf8')
  }

  writeAtomic(configPath, next)

  const status = await getClaudeCodeMcpStatus({
    serverPath: opts.serverPath,
    configPath,
    nodeCommand: node.command,
  })
  status.message =
    'Installed for Claude Code (all projects). Start a new Claude Code session, then ask: “List my Shelf tools.”'
  return { status, backupPath }
}

/** Remove only mcpServers.shelf; leave the rest of ~/.claude.json alone. */
export async function disconnectClaudeCodeMcp(opts: {
  serverPath: string
  configPath?: string
}): Promise<ClaudeCodeConnectResult> {
  const configPath = opts.configPath || resolveClaudeCodeConfigPath()
  if (!fs.existsSync(configPath)) {
    const status = await getClaudeCodeMcpStatus({
      serverPath: opts.serverPath,
      configPath,
    })
    status.message = 'Claude Code was not connected.'
    return { status }
  }

  const config = readClaudeCodeConfig(configPath)
  if (config.mcpServers && CLAUDE_CODE_MCP_SERVER_KEY in config.mcpServers) {
    delete config.mcpServers[CLAUDE_CODE_MCP_SERVER_KEY]
    writeAtomic(configPath, config)
  }

  const status = await getClaudeCodeMcpStatus({
    serverPath: opts.serverPath,
    configPath,
  })
  status.message =
    'Shelf removed from Claude Code. Start a new session to apply.'
  return { status }
}

export const CLAUDE_CODE_TEST_PROMPT =
  'List my Shelf tools and tell me which ones are running.'
