/**
 * Agent-access detection for Smart Import — finds MCP/HTTP interfaces a
 * project PROVIDES (never servers it merely consumes) so registration can
 * prefill `agentAccess`. Shelf records these endpoints for agents; it never
 * connects to or invokes them itself.
 */
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { normalizeAgentAccess } from './capability-intelligence'
import type { AgentAccess, McpTransport } from './types'

interface PkgLike {
  bin?: string | Record<string, string>
  scripts?: Record<string, string>
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

export interface DetectedAgentAccess {
  access: AgentAccess[]
  signals: string[]
}

const NODE_MCP_DEPS = ['@modelcontextprotocol/sdk', 'fastmcp']
const NODE_MCP_ENTRY_CANDIDATES = [
  'mcp/server.js',
  'mcp/server.mjs',
  'dist-mcp/mcp/server.js',
  'build/mcp/server.js',
  'mcp-server.js',
  'mcp-server.mjs',
]
const NODE_MCP_TS_CANDIDATES = ['mcp/server.ts', 'src/mcp/server.ts', 'mcp-server.ts']
const PYTHON_MCP_ENTRY_CANDIDATES = ['mcp_server.py', 'server.py']
const MCP_CONFIG_FILES = ['.mcp.json', 'mcp.json', path.join('.cursor', 'mcp.json')]

export function detectAgentAccess(
  root: string,
  entrySet: Set<string>,
  pkg: PkgLike | null,
  opts: { packageManager?: string; venvPython?: string } = {},
): DetectedAgentAccess {
  const signals: string[] = []
  const candidates: Array<{ access: Omit<AgentAccess, 'id'>; signal: string }> = []

  detectNodeMcp(root, entrySet, pkg, opts.packageManager || 'npm', candidates)
  detectPythonMcp(root, entrySet, opts.venvPython || 'python3', candidates)
  detectMcpConfigFiles(root, candidates)

  const accepted: AgentAccess[] = []
  const seen = new Set<string>()
  for (const { access, signal } of candidates) {
    const key = `${access.kind}:${access.transport || ''}:${access.entrypoint.toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    try {
      const [normalized] = normalizeAgentAccess([{ ...access, id: randomUUID() }])
      accepted.push(normalized)
      signals.push(signal)
    } catch {
      // Invalid or unsafe candidate (secrets, bad URL) — drop silently.
    }
  }
  return { access: accepted, signals }
}

function detectNodeMcp(
  root: string,
  entrySet: Set<string>,
  pkg: PkgLike | null,
  packageManager: string,
  out: Array<{ access: Omit<AgentAccess, 'id'>; signal: string }>,
): void {
  if (!pkg) return
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) }
  const mcpDep = NODE_MCP_DEPS.find((d) => deps[d])
  if (!mcpDep) return

  // Built JS entry beats everything: runnable as-is over stdio.
  const builtEntry = NODE_MCP_ENTRY_CANDIDATES.find((rel) =>
    fs.existsSync(path.join(root, rel)),
  )
  if (builtEntry) {
    out.push({
      access: stdio(`node ${builtEntry}`, false),
      signal: `MCP server signal: ${mcpDep} dependency + ${builtEntry}`,
    })
    return
  }

  // A script whose name mentions mcp (e.g. "mcp", "mcp:serve").
  const scripts = pkg.scripts || {}
  const mcpScript = Object.keys(scripts).find(
    (s) => /(^|[:_-])mcp([:_-]|$)/.test(s) && !/build|compile|bundle/.test(s),
  )
  if (mcpScript) {
    out.push({
      access: stdio(`${packageManager} run ${mcpScript}`, false),
      signal: `MCP server signal: ${mcpDep} dependency + script "${mcpScript}"`,
    })
    return
  }

  // TS source only — declare it, but flag that a build step is required.
  const tsEntry = NODE_MCP_TS_CANDIDATES.find((rel) => fs.existsSync(path.join(root, rel)))
  if (tsEntry) {
    out.push({
      access: {
        ...stdio(`node ${tsEntry.replace(/\.ts$/, '.js')}`, true),
        notes: `Detected TypeScript MCP source at ${tsEntry} — build it, then confirm the entrypoint.`,
      },
      signal: `MCP server signal: ${mcpDep} dependency + ${tsEntry} (build required)`,
    })
  }
  void entrySet
}

function detectPythonMcp(
  root: string,
  entrySet: Set<string>,
  venvPython: string,
  out: Array<{ access: Omit<AgentAccess, 'id'>; signal: string }>,
): void {
  const manifests = ['requirements.txt', 'pyproject.toml', 'Pipfile'].filter((f) =>
    entrySet.has(f),
  )
  if (manifests.length === 0) return
  const hasMcpDep = manifests.some((f) =>
    /^\s*(fastmcp|mcp)\b/im.test(readHead(path.join(root, f))),
  )
  if (!hasMcpDep) return

  for (const rel of PYTHON_MCP_ENTRY_CANDIDATES) {
    if (!entrySet.has(rel) || !fs.existsSync(path.join(root, rel))) continue
    // server.py is generic — require an MCP marker in its head before claiming it.
    if (rel === 'server.py' && !/fastmcp|mcp\.server|from\s+mcp\b/i.test(readHead(path.join(root, rel)))) {
      continue
    }
    out.push({
      access: stdio(`${venvPython} ${rel}`, false),
      signal: `MCP server signal: Python mcp dependency + ${rel}`,
    })
    return
  }
}

function detectMcpConfigFiles(
  root: string,
  out: Array<{ access: Omit<AgentAccess, 'id'>; signal: string }>,
): void {
  for (const rel of MCP_CONFIG_FILES) {
    const abs = path.join(root, rel)
    if (!fs.existsSync(abs)) continue
    let parsed: { mcpServers?: Record<string, { command?: string; args?: string[]; url?: string }> } | null
    try {
      parsed = JSON.parse(fs.readFileSync(abs, 'utf8'))
    } catch {
      continue
    }
    for (const [serverName, entry] of Object.entries(parsed?.mcpServers || {})) {
      if (entry?.command) {
        // Only servers this project PROVIDES: command/args must resolve inside it.
        const pieces = [entry.command, ...(entry.args || [])]
        const insideProject = pieces.some((p) => resolvesInsideProject(root, p))
        if (!insideProject) continue
        out.push({
          access: stdio(pieces.join(' ').trim(), false),
          signal: `MCP server signal: ${rel} entry "${serverName}"`,
        })
      } else if (entry?.url && isLocalUrl(entry.url)) {
        out.push({
          access: {
            kind: 'mcp',
            transport: 'streamable-http' as McpTransport,
            entrypoint: entry.url,
            setupRequired: true,
          },
          signal: `MCP server signal: ${rel} entry "${serverName}" (local URL)`,
        })
      }
    }
  }
}

function stdio(entrypoint: string, setupRequired: boolean): Omit<AgentAccess, 'id'> {
  return { kind: 'mcp', transport: 'stdio' as McpTransport, entrypoint, setupRequired }
}

function resolvesInsideProject(root: string, piece: string): boolean {
  if (!piece || piece.startsWith('-')) return false
  const abs = path.isAbsolute(piece) ? piece : path.join(root, piece)
  const normalized = path.resolve(abs)
  if (!normalized.startsWith(path.resolve(root) + path.sep)) return false
  return fs.existsSync(normalized)
}

function isLocalUrl(value: string): boolean {
  try {
    const parsed = new URL(value)
    return parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1'
  } catch {
    return false
  }
}

function readHead(filePath: string, bytes = 4096): string {
  try {
    const fd = fs.openSync(filePath, 'r')
    try {
      const buffer = Buffer.alloc(bytes)
      const read = fs.readSync(fd, buffer, 0, bytes, 0)
      return buffer.toString('utf8', 0, read)
    } finally {
      fs.closeSync(fd)
    }
  } catch {
    return ''
  }
}
