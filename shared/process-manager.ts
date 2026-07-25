import type { ChildProcess } from 'node:child_process'
import type { LibraryStore } from './library-store'
import {
  findFreePort,
  findPortOccupant,
  killPortOccupant,
  urlForPort,
  withForcedPort,
} from './ports'
import { reconcileExternalTool } from './process-reconcile'
import {
  PORT_TIMEOUT_MS,
  runOnce,
  sanitizeEnv,
  spawnLoginShell,
  terminateProcess,
  waitForPort,
} from './process-lifecycle'
import { ProcessRuntimeSupport } from './process-runtime-support'
import type { ReceiptStore } from './receipt-store'
import type { LogLine, ToolRuntimeState } from './types'

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
  private readonly options: ProcessManagerOptions
  private readonly runtime: ProcessRuntimeSupport

  constructor(
    private readonly store: LibraryStore,
    options: ProcessManagerOptions = {},
  ) {
    this.options = options
    this.runtime = new ProcessRuntimeSupport(options.onEvent, options.receipts)
  }

  /**
   * Cached snapshot (sync). Prefer getState/getStates when status must reflect
   * MCP/orphaned listeners that this instance did not spawn.
   */
  peekState(toolId: string): ToolRuntimeState {
    return this.runtime.peekState(toolId)
  }

  /** Probe port occupancy for tools this manager does not own, then return states. */
  async getStates(): Promise<ToolRuntimeState[]> {
    await this.reconcileExternals()
    const seen = new Set<string>()
    const out: ToolRuntimeState[] = []
    for (const tool of this.store.list()) {
      seen.add(tool.id)
      out.push(this.runtime.peekState(tool.id))
    }
    for (const state of this.runtime.listKnownStates()) {
      if (!seen.has(state.toolId)) out.push(state)
    }
    return out
  }

  async getState(toolId: string): Promise<ToolRuntimeState> {
    if (!this.processes.has(toolId)) {
      await this.reconcileTool(toolId)
    }
    return this.runtime.peekState(toolId)
  }

  getLogs(toolId: string): LogLine[] {
    return this.runtime.getLogs(toolId)
  }

  async start(
    toolId: string,
    options: StartOptions = {},
  ): Promise<ToolRuntimeState> {
    let tool = this.store.get(toolId)
    if (!tool) {
      this.runtime.emitFailedReceipt({
        toolId,
        toolName: toolId,
        launchCommand: '',
        message: 'Tool not found in library.',
      })
      return this.runtime.setState(toolId, {
        toolId,
        status: 'error',
        message: 'Tool not found in library.',
      })
    }

    if (this.processes.has(toolId)) {
      return this.runtime.peekState(toolId)
    }

    if (!tool.launchCommand?.trim()) {
      this.runtime.emitFailedReceipt({
        toolId,
        toolName: tool.name,
        launchCommand: '',
        port: tool.port,
        url: tool.url,
        message: 'Launch command is empty.',
      })
      return this.runtime.setState(toolId, {
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
          this.runtime.appendLog(
            toolId,
            'system',
            `Adopted existing process on port ${tool.port} (pid ${occupant}).`,
          )
          return this.runtime.setState(toolId, {
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

    this.runtime.clearLogs(toolId)
    const startedAt = new Date().toISOString()
    this.runtime.setState(toolId, {
      toolId,
      status: 'starting',
      startedAt,
      message: tool.port
        ? reassignedFrom
          ? `Port ${reassignedFrom} busy → waiting on ${tool.port}`
          : `Waiting for localhost:${tool.port}`
        : 'Process starting…',
    })

    this.runtime.appendLog(toolId, 'system', `Launch: ${tool.launchCommand}`)
    if (reassignedFrom && tool.port) {
      this.runtime.appendLog(
        toolId,
        'system',
        `Port ${reassignedFrom} was busy; reassigned to ${tool.port} and updated library entry.`,
      )
    }
    if (tool.projectPath) {
      this.runtime.appendLog(toolId, 'system', `cwd: ${tool.projectPath}`)
    }

    try {
      const child = spawnLoginShell(tool.launchCommand, {
        cwd: tool.projectPath || undefined,
        env: sanitizeEnv({
          ...(tool.env || {}),
          ...(tool.port ? { PORT: String(tool.port) } : {}),
        }),
      })

      const receipt = this.runtime.beginReceipt({
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
        this.runtime.appendLog(toolId, 'stdout', buf.toString('utf8'))
      })
      child.stderr?.on('data', (buf: Buffer) => {
        this.runtime.appendLog(toolId, 'stderr', buf.toString('utf8'))
      })

      child.on('error', (err) => {
        const open = this.processes.get(toolId)
        this.processes.delete(toolId)
        this.runtime.endReceipt(open?.receiptId, {
          outcome: 'error',
          message: err.message,
        })
        this.runtime.setState(toolId, {
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
        const current = this.runtime.peekState(toolId)
        if (current.status === 'stopped') return
        const message =
          code === 0
            ? `Process exited (signal ${signal || 'none'}).`
            : `Process exited with code ${code}${signal ? ` (signal ${signal})` : ''}.`
        this.runtime.endReceipt(open?.receiptId, {
          outcome: 'error',
          exitCode: code,
          message,
          pid: child.pid,
        })
        this.runtime.setState(toolId, {
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
          return this.runtime.peekState(toolId)
        }
        if (!ready) {
          // Framework may have hopped ports; sniff logs before giving up.
          const sniffed = this.runtime.sniffReadyUrl(toolId)
          if (sniffed) {
            const updated = this.store.save({
              ...tool,
              url: sniffed.url,
              port: sniffed.port,
            })
            this.runtime.appendLog(
              toolId,
              'system',
              `Detected listening URL ${sniffed.url} (port ${sniffed.port}); updated library entry.`,
            )
            this.runtime.markReceiptRunning(managed.receiptId, {
              pid: child.pid,
              port: sniffed.port,
              url: sniffed.url,
              message: `Running · port ${sniffed.port} (from logs)`,
            })
            this.runtime.setState(toolId, {
              toolId,
              status: 'running',
              pid: child.pid,
              startedAt,
              message: `Running · port ${sniffed.port} (from logs)`,
            })
            if (updated.url && this.options.onReadyUrl) {
              await this.options.onReadyUrl(updated.url)
            }
            return this.runtime.peekState(toolId)
          }
          await this.stop(toolId, 'Port readiness timed out after 60s.')
          return this.runtime.peekState(toolId)
        }
        const runningMessage = reassignedFrom
          ? `Running · port ${tool.port} (reassigned from ${reassignedFrom})`
          : `Running · port ${tool.port}`
        this.runtime.markReceiptRunning(managed.receiptId, {
          pid: child.pid,
          port: tool.port,
          url: tool.url,
          message: runningMessage,
        })
        this.runtime.setState(toolId, {
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
        const sniffed = await this.runtime.waitForSniffedUrl(toolId, 8_000, () => this.processes.has(toolId))
        if (sniffed) {
          this.store.save({
            ...tool,
            url: sniffed.url,
            port: sniffed.port,
          })
          this.runtime.appendLog(
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
        this.runtime.markReceiptRunning(managed.receiptId, {
          pid: child.pid,
          port: sniffed?.port || tool.port,
          url: sniffed?.url || tool.url,
          message: runningMessage,
        })
        this.runtime.setState(toolId, {
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

      return this.runtime.peekState(toolId)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const open = this.processes.get(toolId)
      this.processes.delete(toolId)
      if (open?.receiptId) {
        this.runtime.endReceipt(open.receiptId, { outcome: 'failed', message })
      } else {
        this.runtime.emitFailedReceipt({
          toolId,
          toolName: tool.name,
          launchCommand: tool.launchCommand,
          port: tool.port,
          url: tool.url,
          startedAt,
          message,
        })
      }
      return this.runtime.setState(toolId, {
        toolId,
        status: 'error',
        startedAt,
        message,
      })
    }
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
      return this.runtime.setState(toolId, {
        toolId,
        status: 'stopped',
        message: reason || 'Already stopped.',
      })
    }

    this.runtime.setState(toolId, {
      toolId,
      status: 'stopped',
      message: reason || 'Stopping…',
      pid: managed?.child.pid || externalPid || undefined,
    })

    try {
      if (tool?.stopCommand?.trim()) {
        this.runtime.appendLog(toolId, 'system', `Stop command: ${tool.stopCommand}`)
        await runOnce(tool.stopCommand, tool.projectPath, tool.env)
      }

      if (managed) {
        await terminateProcess(managed)
        this.processes.delete(toolId)
      } else if (externalPid && tool?.port) {
        this.runtime.appendLog(
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
      this.runtime.endReceipt(receiptId, {
        outcome,
        message,
        pid: managed?.child.pid || externalPid || undefined,
        port: tool?.port,
        url: tool?.url,
      })
      this.runtime.appendLog(toolId, 'system', message)
      return this.runtime.setState(toolId, {
        toolId,
        status: 'stopped',
        message,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.runtime.appendLog(toolId, 'system', `Stop failed: ${message}`)
      this.runtime.endReceipt(receiptId, {
        outcome: 'error',
        message: `Stop failed: ${message}`,
      })
      return this.runtime.setState(toolId, {
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
        .filter((t) => this.runtime.peekState(t.id).status === 'running')
        .map((t) => t.id),
    ])
    await Promise.all([...ids].map((id) => this.stop(id, reason)))
  }

  /** Mark tools running when their configured port is occupied by another manager. */
  async reconcileExternals(): Promise<void> {
    await Promise.all(this.store.list().map((tool) => this.reconcileTool(tool.id)))
  }

  private async reconcileTool(toolId: string): Promise<void> {
    await reconcileExternalTool(toolId, {
      store: this.store,
      runtime: this.runtime,
      isLocallyManaged: (id) => this.processes.has(id),
    })
  }
}
