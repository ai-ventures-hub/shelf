import { spawn, type ChildProcess, execFile } from 'node:child_process'
import net from 'node:net'
import { promisify } from 'node:util'
import type { LibraryStore } from './library-store'
import {
  findFreePort,
  findPortOccupant,
  killPortOccupant,
  sniffLocalUrlFromText,
  urlForPort,
  withForcedPort,
} from './ports'
import type { ReceiptStore } from './receipt-store'
import type { LogLine, RunReceipt, ToolRuntimeState } from './types'
import { maskSecrets } from './types'

const execFileAsync = promisify(execFile)

const MAX_LOG_LINES = 3000
const PORT_TIMEOUT_MS = 60_000
const PORT_POLL_MS = 400
const STOP_KILL_GRACE_MS = 4_000

interface ManagedProcess {
  child: ChildProcess
  toolId: string
  startedAt: string
  pgid?: number
  /** Open run receipt id while this process is managed. */
  receiptId?: string
}

export type PortConflictPolicy = 'fail' | 'reassign'

export interface StartOptions {
  /**
   * When the configured port is busy:
   * - fail (default): refuse to start
   * - reassign: pick a free port, rewrite launch/url, persist, then start
   */
  onPortConflict?: PortConflictPolicy
}

export interface ProcessManagerOptions {
  /** Called when a tool becomes ready and has a configured URL. */
  onReadyUrl?: (url: string) => void | Promise<void>
  /** Optional IPC-style event sink (Electron renderer). */
  onEvent?: (channel: string, payload: unknown) => void
  /** Durable launch history (shared by Electron + MCP). */
  receipts?: ReceiptStore
}

/**
 * Lightweight per-tool process supervisor shared by Electron and MCP.
 * Status is evidence-based: never reports running until spawn succeeds
 * and (when a port is configured) TCP readiness is confirmed.
 *
 * Electron and MCP each own a ProcessManager instance. When one launches a
 * tool, the other adopts it by port occupancy so Stop/Launch stay usable.
 */
export class ProcessManager {
  private readonly processes = new Map<string, ManagedProcess>()
  private readonly states = new Map<string, ToolRuntimeState>()
  private readonly logs = new Map<string, LogLine[]>()
  private readonly options: ProcessManagerOptions

  constructor(
    private readonly store: LibraryStore,
    options: ProcessManagerOptions = {},
  ) {
    this.options = options
  }

  /**
   * Cached snapshot (sync). Prefer getState/getStates when status must reflect
   * MCP/orphaned listeners that this instance did not spawn.
   */
  peekState(toolId: string): ToolRuntimeState {
    return (
      this.states.get(toolId) || {
        toolId,
        status: 'stopped',
      }
    )
  }

  /** Probe port occupancy for tools this manager does not own, then return states. */
  async getStates(): Promise<ToolRuntimeState[]> {
    await this.reconcileExternals()
    const seen = new Set<string>()
    const out: ToolRuntimeState[] = []
    for (const tool of this.store.list()) {
      seen.add(tool.id)
      out.push(this.peekState(tool.id))
    }
    for (const [id, state] of this.states) {
      if (!seen.has(id)) out.push(state)
    }
    return out
  }

  async getState(toolId: string): Promise<ToolRuntimeState> {
    if (!this.processes.has(toolId)) {
      await this.reconcileTool(toolId)
    }
    return this.peekState(toolId)
  }

  getLogs(toolId: string): LogLine[] {
    return this.logs.get(toolId) || []
  }

  async start(
    toolId: string,
    options: StartOptions = {},
  ): Promise<ToolRuntimeState> {
    let tool = this.store.get(toolId)
    if (!tool) {
      this.emitFailedReceipt({
        toolId,
        toolName: toolId,
        launchCommand: '',
        message: 'Tool not found in library.',
      })
      return this.setState(toolId, {
        toolId,
        status: 'error',
        message: 'Tool not found in library.',
      })
    }

    if (this.processes.has(toolId)) {
      return this.peekState(toolId)
    }

    if (!tool.launchCommand?.trim()) {
      this.emitFailedReceipt({
        toolId,
        toolName: tool.name,
        launchCommand: '',
        port: tool.port,
        url: tool.url,
        message: 'Launch command is empty.',
      })
      return this.setState(toolId, {
        toolId,
        status: 'error',
        message: 'Launch command is empty.',
      })
    }

    const onPortConflict = options.onPortConflict || 'fail'
    let reassignedFrom: number | undefined

    if (tool.port) {
      const occupant = await findPortOccupant(tool.port)
      if (occupant) {
        // Default: adopt the external listener (MCP/orphan) instead of failing.
        // reassign still starts a second instance on a free port when requested.
        if (onPortConflict !== 'reassign') {
          this.appendLog(
            toolId,
            'system',
            `Adopted existing process on port ${tool.port} (pid ${occupant}).`,
          )
          return this.setState(toolId, {
            toolId,
            status: 'running',
            pid: occupant,
            message: `Running · port ${tool.port} (external)`,
          })
        }

        // Pick a free port and persist so GUI + future launches stay aligned.
        const previousPort = tool.port
        const free = await findFreePort({ preferred: previousPort, from: 3000, to: 4999 })
        const nextPort = free.port
        const nextLaunch = withForcedPort(tool.launchCommand, nextPort)
        const nextUrl = urlForPort(tool.url, nextPort)
        tool = this.store.save({
          ...tool,
          port: nextPort,
          url: nextUrl,
          launchCommand: nextLaunch,
          env: { ...(tool.env || {}), PORT: String(nextPort) },
        })
        reassignedFrom = previousPort
      }
    }

    this.clearLogs(toolId)
    const startedAt = new Date().toISOString()
    this.setState(toolId, {
      toolId,
      status: 'starting',
      startedAt,
      message: tool.port
        ? reassignedFrom
          ? `Port ${reassignedFrom} busy → waiting on ${tool.port}`
          : `Waiting for localhost:${tool.port}`
        : 'Process starting…',
    })

    this.appendLog(toolId, 'system', `Launch: ${tool.launchCommand}`)
    if (reassignedFrom && tool.port) {
      this.appendLog(
        toolId,
        'system',
        `Port ${reassignedFrom} was busy; reassigned to ${tool.port} and updated library entry.`,
      )
    }
    if (tool.projectPath) {
      this.appendLog(toolId, 'system', `cwd: ${tool.projectPath}`)
    }

    try {
      const child = spawnLoginShell(tool.launchCommand, {
        cwd: tool.projectPath || undefined,
        env: sanitizeEnv({
          ...(tool.env || {}),
          ...(tool.port ? { PORT: String(tool.port) } : {}),
        }),
      })

      const receipt = this.beginReceipt({
        toolId,
        toolName: tool.name,
        launchCommand: tool.launchCommand,
        port: tool.port,
        url: tool.url,
        startedAt,
        message: tool.port
          ? `Waiting for localhost:${tool.port}`
          : 'Process starting…',
      })

      const managed: ManagedProcess = {
        child,
        toolId,
        startedAt,
        pgid: typeof child.pid === 'number' ? child.pid : undefined,
        receiptId: receipt?.id,
      }
      this.processes.set(toolId, managed)

      child.stdout?.on('data', (buf: Buffer) => {
        this.appendLog(toolId, 'stdout', buf.toString('utf8'))
      })
      child.stderr?.on('data', (buf: Buffer) => {
        this.appendLog(toolId, 'stderr', buf.toString('utf8'))
      })

      child.on('error', (err) => {
        const open = this.processes.get(toolId)
        this.processes.delete(toolId)
        this.endReceipt(open?.receiptId, {
          outcome: 'error',
          message: err.message,
        })
        this.setState(toolId, {
          toolId,
          status: 'error',
          startedAt,
          message: err.message,
        })
      })

      child.on('exit', (code, signal) => {
        const open = this.processes.get(toolId)
        const wasManaged = this.processes.delete(toolId)
        if (!wasManaged) return
        const current = this.peekState(toolId)
        if (current.status === 'stopped') return
        const message =
          code === 0
            ? `Process exited (signal ${signal || 'none'}).`
            : `Process exited with code ${code}${signal ? ` (signal ${signal})` : ''}.`
        this.endReceipt(open?.receiptId, {
          outcome: 'error',
          exitCode: code,
          message,
          pid: child.pid,
        })
        this.setState(toolId, {
          toolId,
          status: 'error',
          startedAt,
          exitCode: code,
          message,
        })
      })

      this.store.touchLastLaunched(toolId)

      if (tool.port) {
        const ready = await waitForPort(tool.port, PORT_TIMEOUT_MS, () =>
          this.processes.has(toolId),
        )
        if (!this.processes.has(toolId)) {
          return this.peekState(toolId)
        }
        if (!ready) {
          // Framework may have hopped ports; sniff logs before giving up.
          const sniffed = this.sniffReadyUrl(toolId)
          if (sniffed) {
            const updated = this.store.save({
              ...tool,
              url: sniffed.url,
              port: sniffed.port,
            })
            this.appendLog(
              toolId,
              'system',
              `Detected listening URL ${sniffed.url} (port ${sniffed.port}); updated library entry.`,
            )
            this.markReceiptRunning(managed.receiptId, {
              pid: child.pid,
              port: sniffed.port,
              url: sniffed.url,
              message: `Running · port ${sniffed.port} (from logs)`,
            })
            this.setState(toolId, {
              toolId,
              status: 'running',
              pid: child.pid,
              startedAt,
              message: `Running · port ${sniffed.port} (from logs)`,
            })
            if (updated.url && this.options.onReadyUrl) {
              await this.options.onReadyUrl(updated.url)
            }
            return this.peekState(toolId)
          }
          await this.stop(toolId, 'Port readiness timed out after 60s.')
          return this.peekState(toolId)
        }
        const runningMessage = reassignedFrom
          ? `Running · port ${tool.port} (reassigned from ${reassignedFrom})`
          : `Running · port ${tool.port}`
        this.markReceiptRunning(managed.receiptId, {
          pid: child.pid,
          port: tool.port,
          url: tool.url,
          message: runningMessage,
        })
        this.setState(toolId, {
          toolId,
          status: 'running',
          pid: child.pid,
          startedAt,
          message: runningMessage,
        })
        if (tool.url && this.options.onReadyUrl) {
          await this.options.onReadyUrl(tool.url)
        }
      } else {
        // No configured port: still try to learn URL from framework ready logs.
        const sniffed = await this.waitForSniffedUrl(toolId, 8_000)
        if (sniffed) {
          this.store.save({
            ...tool,
            url: sniffed.url,
            port: sniffed.port,
          })
          this.appendLog(
            toolId,
            'system',
            `Detected listening URL ${sniffed.url}; updated library entry.`,
          )
        }
        const runningMessage = sniffed
          ? `Running · port ${sniffed.port}`
          : child.pid
            ? `Running · pid ${child.pid}`
            : 'Running'
        this.markReceiptRunning(managed.receiptId, {
          pid: child.pid,
          port: sniffed?.port || tool.port,
          url: sniffed?.url || tool.url,
          message: runningMessage,
        })
        this.setState(toolId, {
          toolId,
          status: 'running',
          pid: child.pid,
          startedAt,
          message: runningMessage,
        })
        const readyUrl = sniffed?.url || tool.url
        if (readyUrl && this.options.onReadyUrl) {
          await this.options.onReadyUrl(readyUrl)
        }
      }

      return this.peekState(toolId)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const open = this.processes.get(toolId)
      this.processes.delete(toolId)
      if (open?.receiptId) {
        this.endReceipt(open.receiptId, { outcome: 'failed', message })
      } else {
        this.emitFailedReceipt({
          toolId,
          toolName: tool.name,
          launchCommand: tool.launchCommand,
          port: tool.port,
          url: tool.url,
          startedAt,
          message,
        })
      }
      return this.setState(toolId, {
        toolId,
        status: 'error',
        startedAt,
        message,
      })
    }
  }

  /** Scan recent logs for a Local:/listening URL. */
  private sniffReadyUrl(
    toolId: string,
  ): { url: string; port: number } | null {
    const blob = this.getLogs(toolId)
      .map((l) => l.text)
      .join('\n')
    const url = sniffLocalUrlFromText(blob)
    if (!url) return null
    try {
      const parsed = new URL(url)
      const port = Number(parsed.port || (parsed.protocol === 'https:' ? 443 : 80))
      if (!Number.isFinite(port)) return null
      return { url, port }
    } catch {
      return null
    }
  }

  /** Poll briefly for framework ready logs when no port was preconfigured. */
  private async waitForSniffedUrl(
    toolId: string,
    timeoutMs: number,
  ): Promise<{ url: string; port: number } | null> {
    const started = Date.now()
    while (Date.now() - started < timeoutMs) {
      if (!this.processes.has(toolId)) return null
      const found = this.sniffReadyUrl(toolId)
      if (found) return found
      await sleep(PORT_POLL_MS)
    }
    return this.sniffReadyUrl(toolId)
  }

  async stop(toolId: string, reason?: string): Promise<ToolRuntimeState> {
    const tool = this.store.get(toolId)
    const managed = this.processes.get(toolId)
    const receiptId = managed?.receiptId

    // External/MCP launch: no ChildProcess here, but the configured port is live.
    let externalPid: number | null = null
    if (!managed && tool?.port) {
      externalPid = await findPortOccupant(tool.port)
    }

    if (!managed && !tool?.stopCommand && !externalPid) {
      return this.setState(toolId, {
        toolId,
        status: 'stopped',
        message: reason || 'Already stopped.',
      })
    }

    this.setState(toolId, {
      toolId,
      status: 'stopped',
      message: reason || 'Stopping…',
      pid: managed?.child.pid || externalPid || undefined,
    })

    try {
      if (tool?.stopCommand?.trim()) {
        this.appendLog(toolId, 'system', `Stop command: ${tool.stopCommand}`)
        await runOnce(tool.stopCommand, tool.projectPath, tool.env)
      }

      if (managed) {
        await terminateProcess(managed)
        this.processes.delete(toolId)
      } else if (externalPid && tool?.port) {
        this.appendLog(
          toolId,
          'system',
          `Stopping external process on port ${tool.port} (pid ${externalPid})…`,
        )
        const result = await killPortOccupant(tool.port)
        if (!result.freed) {
          throw new Error(
            `Port ${tool.port} still in use after stop (pid ${result.pid ?? externalPid}).`,
          )
        }
      }

      const message = reason || (externalPid ? 'Stopped (external)' : 'Stopped')
      // Timeouts / forced stops count as failed runs; intentional stops as stopped.
      const outcome =
        reason && /timed out|quit|failed/i.test(reason) ? 'failed' : 'stopped'
      this.endReceipt(receiptId, {
        outcome,
        message,
        pid: managed?.child.pid || externalPid || undefined,
        port: tool?.port,
        url: tool?.url,
      })
      this.appendLog(toolId, 'system', message)
      return this.setState(toolId, {
        toolId,
        status: 'stopped',
        message,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.appendLog(toolId, 'system', `Stop failed: ${message}`)
      this.endReceipt(receiptId, {
        outcome: 'error',
        message: `Stop failed: ${message}`,
      })
      return this.setState(toolId, {
        toolId,
        status: 'error',
        message: `Stop failed: ${message}`,
      })
    }
  }

  async restart(toolId: string): Promise<ToolRuntimeState> {
    await this.stop(toolId)
    return this.start(toolId)
  }

  async stopAll(reason = 'Shelf is quitting.'): Promise<void> {
    await this.reconcileExternals()
    const ids = new Set<string>([
      ...this.processes.keys(),
      ...this.store
        .list()
        .filter((t) => this.peekState(t.id).status === 'running')
        .map((t) => t.id),
    ])
    await Promise.all([...ids].map((id) => this.stop(id, reason)))
  }

  /** Mark tools running when their configured port is occupied by another manager. */
  async reconcileExternals(): Promise<void> {
    await Promise.all(this.store.list().map((tool) => this.reconcileTool(tool.id)))
  }

  private async reconcileTool(toolId: string): Promise<void> {
    if (this.processes.has(toolId)) return
    const tool = this.store.get(toolId)
    if (!tool?.port) return

    const current = this.peekState(toolId)
    // Don't interrupt an in-flight local start.
    if (current.status === 'starting') return

    const occupant = await findPortOccupant(tool.port)
    if (occupant) {
      if (current.status !== 'running' || current.pid !== occupant) {
        this.setState(toolId, {
          toolId,
          status: 'running',
          pid: occupant,
          message: `Running · port ${tool.port} (external)`,
        })
      }
      return
    }

    // Clear stale external-running badges when the listener is gone.
    if (current.status === 'running' && (current.message || '').includes('external')) {
      this.setState(toolId, {
        toolId,
        status: 'stopped',
        message: 'Stopped (external process exited)',
      })
    }
  }

  private clearLogs(toolId: string): void {
    this.logs.set(toolId, [])
  }

  private appendLog(
    toolId: string,
    stream: LogLine['stream'],
    chunk: string,
  ): void {
    const lines = chunk.replace(/\r\n/g, '\n').split('\n')
    const bucket = this.logs.get(toolId) || []
    const at = new Date().toISOString()

    for (const text of lines) {
      if (!text && lines.length > 1) continue
      if (!text) continue
      const entry: LogLine = {
        toolId,
        stream,
        text: maskSecrets(text),
        at,
      }
      bucket.push(entry)
      this.emit('logs:line', entry)
    }

    while (bucket.length > MAX_LOG_LINES) bucket.shift()
    this.logs.set(toolId, bucket)
  }

  private setState(
    toolId: string,
    state: ToolRuntimeState,
  ): ToolRuntimeState {
    this.states.set(toolId, state)
    this.emit('process:update', state)
    return state
  }

  private beginReceipt(
    input: Parameters<ReceiptStore['begin']>[0],
  ): RunReceipt | undefined {
    const store = this.options.receipts
    if (!store) return undefined
    const receipt = store.begin(input)
    this.emit('receipts:update', receipt)
    return receipt
  }

  private markReceiptRunning(
    id: string | undefined,
    patch: { pid?: number; port?: number; url?: string; message?: string },
  ): void {
    if (!id || !this.options.receipts) return
    const receipt = this.options.receipts.markRunning(id, patch)
    if (receipt) this.emit('receipts:update', receipt)
  }

  private endReceipt(
    id: string | undefined,
    input: Parameters<ReceiptStore['end']>[1],
  ): void {
    if (!id || !this.options.receipts) return
    const receipt = this.options.receipts.end(id, input)
    if (receipt) this.emit('receipts:update', receipt)
  }

  private emitFailedReceipt(
    input: Parameters<ReceiptStore['recordFailed']>[0],
  ): void {
    if (!this.options.receipts) return
    const receipt = this.options.receipts.recordFailed(input)
    this.emit('receipts:update', receipt)
  }

  private emit(channel: string, payload: unknown): void {
    this.options.onEvent?.(channel, payload)
  }
}

function spawnLoginShell(
  command: string,
  opts: { cwd?: string; env?: Record<string, string> },
): ChildProcess {
  const env = {
    ...process.env,
    ...opts.env,
    FORCE_COLOR: '0',
    NO_COLOR: '1',
  }

  return spawn('/bin/zsh', ['-lc', command], {
    cwd: opts.cwd,
    env,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

async function runOnce(
  command: string,
  cwd?: string,
  env?: Record<string, string>,
): Promise<void> {
  await execFileAsync('/bin/zsh', ['-lc', command], {
    cwd,
    env: { ...process.env, ...sanitizeEnv(env) },
    timeout: 30_000,
  })
}

async function terminateProcess(managed: ManagedProcess): Promise<void> {
  const { child, pgid } = managed
  if (child.killed || child.exitCode !== null) return

  try {
    if (pgid) process.kill(-pgid, 'SIGTERM')
    else child.kill('SIGTERM')
  } catch {
    // already exited
  }

  await waitForExit(child, STOP_KILL_GRACE_MS)

  if (child.exitCode === null && !child.killed) {
    try {
      if (pgid) process.kill(-pgid, 'SIGKILL')
      else child.kill('SIGKILL')
    } catch {
      // ignore
    }
  }
}

function waitForExit(child: ChildProcess, ms: number): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null) {
      resolve()
      return
    }
    const timer = setTimeout(() => resolve(), ms)
    child.once('exit', () => {
      clearTimeout(timer)
      resolve()
    })
  })
}

function waitForPort(
  port: number,
  timeoutMs: number,
  stillRunning: () => boolean,
): Promise<boolean> {
  const started = Date.now()
  return new Promise((resolve) => {
    const tick = () => {
      if (!stillRunning()) {
        resolve(false)
        return
      }
      const socket = net.connect({ host: '127.0.0.1', port }, () => {
        socket.end()
        resolve(true)
      })
      socket.on('error', () => {
        socket.destroy()
        if (Date.now() - started >= timeoutMs) {
          resolve(false)
          return
        }
        setTimeout(tick, PORT_POLL_MS)
      })
    }
    tick()
  })
}

function sanitizeEnv(
  env?: Record<string, string>,
): Record<string, string> | undefined {
  if (!env) return undefined
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(env)) {
    if (!k.trim()) continue
    out[k] = v
  }
  return out
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
