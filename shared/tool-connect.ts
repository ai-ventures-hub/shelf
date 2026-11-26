/**
 * Connections from Shelf to a tool's OWN declared interface: its MCP server
 * (stdio or streamable HTTP), its local HTTP API, or a check that its CLI
 * exists. Used by the gateway (an agent asks Shelf to call the tool) and by
 * readiness checks (the user or an agent asks whether the interface answers).
 *
 * Two rules hold everywhere here:
 * - Network interfaces must be on this Mac. A declared URL on any other host
 *   is refused, so Shelf can never be pointed at the wider network.
 * - A CLI is never run. Shelf only checks that its command resolves.
 */
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import path from 'node:path'
import { promisify } from 'node:util'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { isLoopbackHost } from './companion-preview-policy'
import type { AccessCheck, AgentAccess, Tool } from './contracts'
import { sanitizeEnv } from './process-lifecycle'

const execFileAsync = promisify(execFile)

const MCP_CONNECT_TIMEOUT_MS = 20_000
const HTTP_TIMEOUT_MS = 30_000
const PROBE_HTTP_TIMEOUT_MS = 5_000
export const MAX_HTTP_RESPONSE_BYTES = 1024 * 1024
const MAX_HTTP_REQUEST_BYTES = 1024 * 1024

export class ToolConnectError extends Error {}

type ConnectableTool = Pick<Tool, 'id' | 'name' | 'projectPath' | 'env'>

/** The declared URL, when it is http(s) on this Mac; otherwise a refusal. */
export function loopbackUrl(raw: string): URL {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    throw new ToolConnectError('The declared entrypoint is not a URL.')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ToolConnectError('The declared entrypoint is not an http(s) URL.')
  }
  if (!isLoopbackHost(url.hostname)) {
    throw new ToolConnectError(
      `The declared entrypoint is on ${url.hostname}, not this Mac. Shelf only connects to local interfaces.`,
    )
  }
  return url
}

/** True when reaching this interface needs the tool's own server to be up. */
export function accessNeedsRunningTool(access: AgentAccess): boolean {
  return access.kind === 'http-api' || (access.kind === 'mcp' && access.transport === 'streamable-http')
}

function withTimeout<T>(work: Promise<T>, ms: number, onTimeout: () => void, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      onTimeout()
      reject(new ToolConnectError(message))
    }, ms)
    work.then(
      (value) => { clearTimeout(timer); resolve(value) },
      (err) => { clearTimeout(timer); reject(err) },
    )
  })
}

function stringEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(env)) if (typeof value === 'string') out[key] = value
  return out
}

export interface ToolMcpSession {
  client: Client
  close: () => Promise<void>
}

/**
 * Open an MCP session with the tool's declared server. stdio entrypoints are
 * one command string, run through the login shell in the project folder with
 * the tool's env, the same way Shelf launches the tool itself.
 */
export async function connectToolMcp(tool: ConnectableTool, access: AgentAccess): Promise<ToolMcpSession> {
  if (access.kind !== 'mcp') throw new ToolConnectError('That interface is not an MCP server.')
  const client = new Client({ name: 'shelf-gateway', version: '1' })
  const transport =
    access.transport === 'streamable-http'
      ? new StreamableHTTPClientTransport(loopbackUrl(access.entrypoint))
      : new StdioClientTransport({
          command: '/bin/zsh',
          args: ['-lc', access.entrypoint],
          cwd: tool.projectPath && fs.existsSync(tool.projectPath) ? tool.projectPath : undefined,
          env: { ...stringEnv(process.env), ...sanitizeEnv(tool.env), FORCE_COLOR: '0', NO_COLOR: '1' },
          stderr: 'ignore',
        })
  const close = async () => {
    try { await client.close() } catch { /* already gone */ }
  }
  try {
    await withTimeout(
      client.connect(transport),
      MCP_CONNECT_TIMEOUT_MS,
      () => void close(),
      `The tool's MCP server did not answer within ${MCP_CONNECT_TIMEOUT_MS / 1000}s.`,
    )
  } catch (err) {
    await close()
    if (err instanceof ToolConnectError) throw err
    throw new ToolConnectError(`Could not connect to the tool's MCP server: ${messageOf(err)}`)
  }
  return { client, close }
}

export interface ToolHttpRequest {
  method?: string
  /** Absolute path on the declared origin; the entrypoint's own path when omitted. */
  path?: string
  query?: Record<string, string | number | boolean>
  headers?: Record<string, string>
  body?: unknown
  timeoutMs?: number
}

export interface ToolHttpResponse {
  status: number
  contentType?: string
  body: string
  /** True when the body was longer than Shelf returns. */
  truncated: boolean
  url: string
}

const FORBIDDEN_REQUEST_HEADERS = new Set(['host', 'content-length', 'connection', 'transfer-encoding', 'upgrade'])
const ALLOWED_METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'])

/** One HTTP request to the tool's declared local API. Redirects are returned, not followed. */
export function requestToolHttp(access: AgentAccess, request: ToolHttpRequest = {}): Promise<ToolHttpResponse> {
  const base = loopbackUrl(access.entrypoint)
  const method = (request.method || 'GET').toUpperCase()
  if (!ALLOWED_METHODS.has(method)) throw new ToolConnectError(`Method ${method} is not supported.`)
  const target = new URL(base.toString())
  if (request.path !== undefined) {
    if (!request.path.startsWith('/') || request.path.startsWith('//')) {
      throw new ToolConnectError('path must start with a single "/".')
    }
    const parsed = new URL(request.path, base.origin)
    // A path can never move the request off the declared origin.
    if (parsed.origin !== base.origin) throw new ToolConnectError('path must stay on the tool\'s own address.')
    target.pathname = parsed.pathname
    target.search = parsed.search
  }
  for (const [key, value] of Object.entries(request.query || {})) target.searchParams.set(key, String(value))

  const headers: Record<string, string> = {}
  for (const [key, value] of Object.entries(request.headers || {})) {
    if (!FORBIDDEN_REQUEST_HEADERS.has(key.toLowerCase())) headers[key] = String(value)
  }
  let payload: Buffer | undefined
  if (request.body !== undefined && request.body !== null && method !== 'GET' && method !== 'HEAD') {
    if (typeof request.body === 'string') payload = Buffer.from(request.body)
    else {
      payload = Buffer.from(JSON.stringify(request.body))
      if (!Object.keys(headers).some((key) => key.toLowerCase() === 'content-type')) {
        headers['content-type'] = 'application/json'
      }
    }
    if (payload.length > MAX_HTTP_REQUEST_BYTES) throw new ToolConnectError('The request body is larger than 1 MB.')
    headers['content-length'] = String(payload.length)
  }

  const transport = target.protocol === 'https:' ? https : http
  return new Promise<ToolHttpResponse>((resolve, reject) => {
    const req = transport.request(
      target,
      { method, headers, timeout: request.timeoutMs ?? HTTP_TIMEOUT_MS, rejectUnauthorized: false },
      (res) => {
        const chunks: Buffer[] = []
        let size = 0
        let truncated = false
        res.on('data', (chunk: Buffer) => {
          if (truncated) return
          const room = MAX_HTTP_RESPONSE_BYTES - size
          if (chunk.length > room) {
            if (room > 0) chunks.push(chunk.subarray(0, room))
            size = MAX_HTTP_RESPONSE_BYTES
            truncated = true
            res.destroy()
            finish()
            return
          }
          chunks.push(chunk)
          size += chunk.length
        })
        let done = false
        const finish = () => {
          if (done) return
          done = true
          const contentType = typeof res.headers['content-type'] === 'string' ? res.headers['content-type'] : undefined
          const textual = !contentType || /^(text\/|application\/(json|xml|x-www-form-urlencoded|[\w.+-]*\+json))/i.test(contentType)
          resolve({
            status: res.statusCode || 0,
            contentType,
            body: textual ? Buffer.concat(chunks).toString('utf8') : `[${size} bytes of ${contentType}; not text, so not shown]`,
            truncated,
            url: target.toString(),
          })
        }
        res.on('end', finish)
        res.on('error', (err) => { if (!done) { done = true; reject(new ToolConnectError(messageOf(err))) } })
      },
    )
    req.on('timeout', () => req.destroy(new ToolConnectError('The tool did not answer in time.')))
    req.on('error', (err: NodeJS.ErrnoException) => {
      reject(
        err instanceof ToolConnectError
          ? err
          : new ToolConnectError(
              err.code === 'ECONNREFUSED'
                ? `Nothing is listening at ${target.origin}. Is the tool running?`
                : messageOf(err),
            ),
      )
    })
    if (payload) req.write(payload)
    req.end()
  })
}

/** The program a command string would run, past any leading KEY=value settings. */
export function commandProgram(command: string): string | null {
  const words = command.trim().split(/\s+/)
  const first = words.find((word) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(word))
  return first && /^[\w@%+=:,./~-]+$/.test(first) ? first : null
}

/**
 * Find out whether a declared interface answers, without changing anything:
 * MCP is connected and asked for its tool list, an HTTP API gets one GET, and
 * a CLI is only looked up (never run).
 */
export async function probeAccess(tool: ConnectableTool, access: AgentAccess): Promise<AccessCheck> {
  const checkedAt = new Date().toISOString()
  const fail = (detail: string): AccessCheck => ({ ok: false, detail, checkedAt })
  try {
    if (access.kind === 'mcp') {
      const session = await connectToolMcp(tool, access)
      try {
        const listed = await session.client.listTools(undefined, { timeout: MCP_CONNECT_TIMEOUT_MS })
        const count = listed.tools.length
        return { ok: true, detail: `MCP answers with ${count} tool${count === 1 ? '' : 's'}.`, checkedAt, toolCount: count }
      } finally {
        await session.close()
      }
    }
    if (access.kind === 'http-api') {
      const response = await requestToolHttp(access, { method: 'GET', timeoutMs: PROBE_HTTP_TIMEOUT_MS })
      return response.status < 500
        ? { ok: true, detail: `HTTP API answers (${response.status}).`, checkedAt }
        : fail(`HTTP API answered with an error (${response.status}).`)
    }
    const program = commandProgram(access.entrypoint)
    if (!program) return fail('Shelf could not tell which command this runs.')
    if (program.includes('/') && !program.startsWith('~')) {
      const resolved = path.resolve(tool.projectPath || '/', program)
      return fs.existsSync(resolved)
        ? { ok: true, detail: `Command found: ${program}.`, checkedAt }
        : fail(`${program} does not exist in the project folder.`)
    }
    try {
      await execFileAsync('/bin/zsh', ['-lc', `command -v -- ${program}`], {
        cwd: tool.projectPath && fs.existsSync(tool.projectPath) ? tool.projectPath : undefined,
        timeout: 10_000,
      })
      return { ok: true, detail: `Command found: ${program}.`, checkedAt }
    } catch {
      return fail(`${program} is not installed or not on the PATH.`)
    }
  } catch (err) {
    return fail(messageOf(err))
  }
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
