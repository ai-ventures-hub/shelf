/**
 * One-click Codex MCP install.
 * Upserts [mcp_servers.shelf] in ~/.codex/config.toml without rewriting other tables.
 * Shared by Codex CLI, IDE extension, and ChatGPT desktop Codex.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { mcpPathMigrationHint } from './mcp-server-path'
import { resolveNodeCommand } from './node-resolve'
import {
  readTomlStringArrayKey,
  readTomlStringKey,
  readTomlTableLines,
  removeTomlTables,
  tomlBasicString,
  tomlStringArray,
  upsertTomlTable,
} from './toml-section'

export const CODEX_MCP_SERVER_KEY = 'shelf'
export const CODEX_MCP_TABLE = `mcp_servers.${CODEX_MCP_SERVER_KEY}`

export interface CodexMcpStatus {
  /** Shelf table present in config.toml. */
  connected: boolean
  /** True when shelf points at this Shelf MCP bundle. */
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

export interface CodexConnectResult {
  status: CodexMcpStatus
  backupPath?: string
}

export function resolveCodexConfigPath(home = os.homedir()): string {
  return path.join(home, '.codex', 'config.toml')
}

function writeAtomicText(configPath: string, text: string): void {
  fs.mkdirSync(path.dirname(configPath), { recursive: true })
  const tmp = `${configPath}.tmp`
  fs.writeFileSync(tmp, text.endsWith('\n') ? text : `${text}\n`, 'utf8')
  fs.renameSync(tmp, configPath)
}

function shelfBody(
  nodeCommand: string,
  serverPath: string,
  env?: Record<string, string>,
): string[] {
  const lines = [
    `command = ${tomlBasicString(nodeCommand)}`,
    `args = ${tomlStringArray([serverPath])}`,
  ]
  // Inline env table keeps it inside [mcp_servers.shelf], so
  // removeTomlTables on update/disconnect cleans it up with the entry.
  if (env && Object.keys(env).length > 0) {
    const pairs = Object.entries(env)
      .map(([k, v]) => `${k} = ${tomlBasicString(v)}`)
      .join(', ')
    lines.push(`env = { ${pairs} }`)
  }
  return lines
}

function readShelfEntry(toml: string): { command?: string; args?: string[] } | null {
  const lines = readTomlTableLines(toml, CODEX_MCP_TABLE)
  if (!lines) return null
  return {
    command: readTomlStringKey(lines, 'command'),
    args: readTomlStringArrayKey(lines, 'args'),
  }
}

function entryMatches(
  entry: { command?: string; args?: string[] } | null,
  serverPath: string,
): boolean {
  if (!entry?.args?.length) return false
  return path.resolve(String(entry.args[0])) === path.resolve(serverPath)
}

export async function getCodexMcpStatus(opts: {
  serverPath: string
  configPath?: string
  nodeCommand?: string
}): Promise<CodexMcpStatus> {
  const configPath = opts.configPath || resolveCodexConfigPath()
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
  let message = 'Codex is not connected yet.'

  if (configExists) {
    try {
      const toml = fs.readFileSync(configPath, 'utf8')
      const entry = readShelfEntry(toml)
      if (entry && (entry.command || entry.args?.length)) {
        connected = true
        matches = entryMatches(entry, opts.serverPath)
        if (!matches) {
          const configured = entry.args?.[0]
          message =
            mcpPathMigrationHint(opts.serverPath, configured) ||
            'A Shelf entry exists but points at a different MCP path. Connect again to update it.'
        } else {
          message =
            'Installed in ~/.codex/config.toml. Restart Codex / ChatGPT Codex (or start a new CLI session), then ask: “List my Shelf tools.”'
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
 * Upsert [mcp_servers.shelf] only — never rewrites unrelated Codex settings or other MCP servers.
 */
export async function connectCodexMcp(opts: {
  serverPath: string
  configPath?: string
}): Promise<CodexConnectResult> {
  const configPath = opts.configPath || resolveCodexConfigPath()
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
  const nextText = upsertTomlTable(
    previousText,
    CODEX_MCP_TABLE,
    shelfBody(node.command, opts.serverPath, node.env),
  )

  let backupPath: string | undefined
  if (existed && previousText.trim() !== nextText.trim()) {
    backupPath = `${configPath}.shelf-backup`
    fs.writeFileSync(backupPath, previousText, 'utf8')
  }

  writeAtomicText(configPath, nextText)

  const status = await getCodexMcpStatus({
    serverPath: opts.serverPath,
    configPath,
    nodeCommand: node.command,
  })
  status.message =
    'Installed in ~/.codex/config.toml. Restart Codex / ChatGPT Codex (or start a new CLI session), then ask: “List my Shelf tools.”'
  return { status, backupPath }
}

/** Remove [mcp_servers.shelf] and child tables only. */
export async function disconnectCodexMcp(opts: {
  serverPath: string
  configPath?: string
}): Promise<CodexConnectResult> {
  const configPath = opts.configPath || resolveCodexConfigPath()
  if (!fs.existsSync(configPath)) {
    const status = await getCodexMcpStatus({
      serverPath: opts.serverPath,
      configPath,
    })
    status.message = 'Codex was not connected.'
    return { status }
  }

  const previousText = fs.readFileSync(configPath, 'utf8')
  const nextText = removeTomlTables(previousText, CODEX_MCP_TABLE)
  if (nextText.trim() !== previousText.trim()) {
    writeAtomicText(configPath, nextText || '')
  }

  const status = await getCodexMcpStatus({
    serverPath: opts.serverPath,
    configPath,
  })
  status.message =
    'Shelf removed from Codex config. Restart Codex / ChatGPT Codex to apply.'
  return { status }
}

export const CODEX_TEST_PROMPT = 'List my Shelf tools and tell me which ones are running.'
