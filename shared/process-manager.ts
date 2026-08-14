import type { ChildProcess } from 'node:child_process'
import type { LibraryStore } from './library-store'
import {
  findFreePort,
  findPortOccupants,
  killPortOccupant,
  urlForPort,
  withForcedPort,
} from './ports'
import { verifyOccupantsOwnedBy } from './process-ownership'
import { reconcileExternalTool, type ExternalOwner } from './process-reconcile'
import {
  PORT_TIMEOUT_MS,
  runOnce,
  sanitizeEnv,
  spawnLoginShell,
  terminatePidGroup,
  terminateProcess,
  waitForPort,
} from './process-lifecycle'
import { ProcessRuntimeSupport } from './process-runtime-support'
import { classifyLaunchFailure, remedyFor } from './launch-diagnostics'
import type { ReceiptStore } from './receipt-store'
import type {
  LaunchErrorCode,
  LaunchOrigin,
  LogLine,
  RemedyKind,
  RunReceipt,
  Tool,
  ToolRuntimeState,
} from './types'

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
  /** Who initiated this launch; falls back to the manager's defaultOrigin. */
  origin?: LaunchOrigin
}

export interface ProcessManagerOptions {
  /** Called when a tool becomes ready and has a configured URL. */
  onReadyUrl?: (url: string) => void | Promise<void>
  /** Optional IPC-style event sink (Electron renderer). */
  onEvent?: (channel: string, payload: unknown) => void
  /** Durable launch history (shared by Electron + MCP). */
  receipts?: ReceiptStore
  /**
   * Launch provenance when StartOptions.origin is absent. A thunk because the
   * MCP client identity is only known after the initialize handshake.
   */
  defaultOrigin?: () => LaunchOrigin | undefined
}

/**
 * Lightweight per-tool process supervisor shared by Electron and MCP.
 * Status is evidence-based: never reports running until spawn succeeds
 * and (when a port is configured) TCP readiness is confirmed.
 *
 * Electron and MCP each own a ProcessManager instance. When one launches a
 * tool, the other adopts it only when the live receipt and process group prove
 * Shelf ownership; unrelated listeners are never stopped.
 */
export class ProcessManager {
  private readonly processes = new Map<string, ManagedProcess>()
  private readonly options: ProcessManagerOptions
  private readonly runtime: ProcessRuntimeSupport
  /**
   * Coalesces concurrent start() calls per tool. The `processes.has` guard
   * alone is not enough: several awaits (lsof, findFreePort, store.save) sit
   * between it and registration, so two near-simultaneous launches (GUI click
   * + MCP call, or a stack launch) could both spawn without this.
   */
  private readonly inFlightStarts = new Map<string, Promise<ToolRuntimeState>>()
  /**
   * Serializes decisions that read-modify-write library.json during launch
   * (port reassignment, sniffed port/url persistence) so concurrent launches
   * cannot pick the same "free" port or interleave stale tool snapshots.
   */
  private libraryWriteChain: Promise<unknown> = Promise.resolve()

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

  /** Append to a tool's log buffer (e.g. streamed bootstrap/install output). */
  appendLog(toolId: string, stream: LogLine['stream'], text: string): void {
    this.runtime.appendLog(toolId, stream, text)
  }

  async start(
    toolId: string,
    options: StartOptions = {},
  ): Promise<ToolRuntimeState> {
    const inFlight = this.inFlightStarts.get(toolId)
    if (inFlight) return inFlight
    const run = this.startInternal(toolId, options).finally(() => {
      this.inFlightStarts.delete(toolId)
    })
    // Registered synchronously (before any await in startInternal can yield),
    // so a second caller in the same tick already coalesces onto this run.
    this.inFlightStarts.set(toolId, run)
    return run
  }

  private async startInternal(
    toolId: string,
    options: StartOptions,
  ): Promise<ToolRuntimeState> {
    const origin = options.origin ?? this.options.defaultOrigin?.()
    let tool = this.store.get(toolId)
    if (!tool) {
      this.runtime.emitFailedReceipt({
        toolId,
        toolName: toolId,
        launchCommand: '',
        message: 'Tool not found in library.',
        startedBy: origin,
      })
      return this.runtime.setState(toolId, {
        toolId,
        status: 'error',
        message: 'Tool not found in library.',
        code: 'tool_not_found',
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
        startedBy: origin,
      })
      return this.runtime.setState(toolId, {
        toolId,
        status: 'error',
        message: 'Launch command is empty.',
        code: 'no_launch_command',
        remedy: remedyFor('no_launch_command'),
      })
    }

    const onPortConflict = options.onPortConflict || 'fail'
    let reassignedFrom: number | undefined

    if (!tool.port) {
      // Portless tool already launched by another Shelf process (MCP/GUI):
      // adopt via its live receipt instead of spawning a duplicate.
      const external = this.findActiveReceipt(toolId)
      if (external?.pid) {
        this.runtime.appendLog(
          toolId,
          'system',
          `Adopted Shelf process for this tool (pid ${external.pid}, launched by another Shelf process).`,
        )
        return this.runtime.setState(toolId, {
          toolId,
          status: 'running',
          pid: external.pid,
          message: `Running · pid ${external.pid} (external)`,
          port: external.port,
          origin: 'external',
          startedBy: external.startedBy,
        })
      }
    }

    if (tool.port) {
      // Serialized with other launches: the "which port is free" decision and
      // the persisted rewrite must be atomic per manager, or two concurrent
      // stack launches can both claim the same free port.
      const resolution = await this.enqueueLibraryWrite(() =>
        this.resolvePortConflict(tool as Tool, onPortConflict, origin),
      )
      if (resolution.state) return resolution.state
      tool = resolution.tool
      reassignedFrom = resolution.reassignedFrom
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
      port: tool.port,
      origin: 'local',
      startedBy: origin,
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

      const managed: ManagedProcess = {
        child,
        toolId,
        startedAt,
        pgid: typeof child.pid === 'number' ? child.pid : undefined,
      }
      // Track immediately so any later persistence/readiness failure can cleanly
      // terminate the child instead of leaving an unowned background process.
      this.processes.set(toolId, managed)

      const receipt = this.runtime.beginReceipt({
        toolId,
        toolName: tool.name,
        launchCommand: tool.launchCommand,
        port: tool.port,
        url: tool.url,
        pid: child.pid,
        startedAt,
        message: tool.port
          ? `Waiting for localhost:${tool.port}`
          : 'Process starting…',
        startedBy: origin,
      })
      managed.receiptId = receipt?.id

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
        const { code } = classifyLaunchFailure(this.runtime.getLogs(toolId))
        this.runtime.setState(toolId, {
          toolId,
          status: 'error',
          startedAt,
          message: err.message,
          code,
          remedy: remedyFor(code),
        })
      })

      child.on('exit', (code, signal) => {
        // Commit any held partial log line before classifying the exit.
        this.runtime.flushLogs(toolId)
        const open = this.processes.get(toolId)
        const wasManaged = this.processes.delete(toolId)
        if (!wasManaged) return
        const current = this.runtime.peekState(toolId)
        if (current.status === 'stopped') return
        const exitedBeforeReady = current.status === 'starting' && Boolean(tool.port)
        const cleanExit =
          !exitedBeforeReady &&
          (code === 0 || signal === 'SIGTERM' || signal === 'SIGINT')
        const message = exitedBeforeReady
          ? `Process exited before port ${tool.port} became ready.`
          : cleanExit
            ? `Process exited${signal ? ` (${signal})` : ' cleanly'}.`
            : `Process exited with code ${code}${signal ? ` (${signal})` : ''}.`
        this.runtime.endReceipt(open?.receiptId, {
          outcome: cleanExit ? 'stopped' : 'error',
          exitCode: code,
          message,
          pid: child.pid,
        })
        const failureCode = cleanExit
          ? undefined
          : classifyLaunchFailure(this.runtime.getLogs(toolId)).code
        this.runtime.setState(toolId, {
          toolId,
          status: cleanExit ? 'stopped' : 'error',
          startedAt,
          exitCode: code,
          message,
          code: failureCode,
          remedy: failureCode ? remedyFor(failureCode) : undefined,
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
            const updated = await this.enqueueLibraryWrite(() =>
              this.store.save({
                ...(tool as Tool),
                url: sniffed.url,
                port: sniffed.port,
              }),
            )
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
              port: sniffed.port,
              origin: 'local',
              startedBy: origin,
            })
            if (updated.url) await this.openReadyUrl(toolId, updated.url)
            return this.runtime.peekState(toolId)
          }
          // Classify the captured output first — a dead install or crash is
          // more actionable than a generic timeout.
          const { code: timeoutCode } = classifyLaunchFailure(
            this.runtime.getLogs(toolId),
            'port_timeout',
          )
          await this.stop(toolId, 'Port readiness timed out after 60s.', {
            code: timeoutCode,
            remedy: remedyFor(timeoutCode),
          })
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
          port: tool.port,
          origin: 'local',
          startedBy: origin,
        })
        if (tool.url) await this.openReadyUrl(toolId, tool.url)
      } else {
        // No configured port: still try to learn URL from framework ready logs.
        const sniffed = await this.runtime.waitForSniffedUrl(toolId, 8_000, () => this.processes.has(toolId))
        if (!this.processes.has(toolId)) {
          return this.runtime.peekState(toolId)
        }
        if (sniffed) {
          await this.enqueueLibraryWrite(() =>
            this.store.save({
              ...(tool as Tool),
              url: sniffed.url,
              port: sniffed.port,
            }),
          )
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
          port: sniffed?.port || tool.port,
          origin: 'local',
          startedBy: origin,
        })
        const readyUrl = sniffed?.url || tool.url
        if (readyUrl) await this.openReadyUrl(toolId, readyUrl)
      }

      return this.runtime.peekState(toolId)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const open = this.processes.get(toolId)
      this.processes.delete(toolId)
      if (open) {
        try {
          await terminateProcess(open)
        } catch {
          // Preserve the original launch error below.
        }
      }
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
          startedBy: origin,
        })
      }
      const { code } = classifyLaunchFailure(this.runtime.getLogs(toolId))
      return this.runtime.setState(toolId, {
        toolId,
        status: 'error',
        startedAt,
        message,
        code,
        remedy: remedyFor(code),
      })
    }
  }

  async stop(
    toolId: string,
    reason?: string,
    failure?: { code?: LaunchErrorCode; remedy?: RemedyKind },
  ): Promise<ToolRuntimeState> {
    const tool = this.store.get(toolId)
    const managed = this.processes.get(toolId)
    let receiptId = managed?.receiptId

    // External launch (MCP / other Shelf process): no ChildProcess here.
    let externalOwner: ExternalOwner | null = null
    let externalReceipt: RunReceipt | undefined
    let untrustedOccupant: number | null = null
    if (!managed && tool?.port) {
      const occupants = await findPortOccupants(tool.port)
      if (occupants.length > 0) {
        externalOwner = await this.trustedExternalOwner(toolId, tool.port, occupants)
        if (externalOwner) {
          receiptId = externalOwner.receiptId
        } else {
          untrustedOccupant = occupants[0]
        }
      }
    } else if (!managed && tool && !tool.port) {
      // Portless external: the live receipt is both the proof and the target.
      externalReceipt = this.findActiveReceipt(toolId)
      if (externalReceipt?.pid) receiptId = externalReceipt.id
      else externalReceipt = undefined
    }

    if (!managed && !tool?.stopCommand && untrustedOccupant && tool?.port) {
      return this.runtime.setState(toolId, {
        toolId,
        status: 'error',
        message: `Refusing to stop process ${untrustedOccupant} on port ${tool.port} because Shelf did not launch it.`,
        code: 'stop_refused_not_owner',
      })
    }

    if (!managed && !tool?.stopCommand && !externalOwner && !externalReceipt) {
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
      pid: managed?.child.pid || externalOwner?.ownerPid || externalReceipt?.pid || undefined,
    })

    // A failing custom stop command must never abort the kill below — it is
    // a graceful-shutdown courtesy, not the mechanism of record. (This
    // previously threw past terminateProcess and left a live child behind.)
    let stopCommandError: string | null = null
    if (tool?.stopCommand?.trim()) {
      this.runtime.appendLog(toolId, 'system', `Stop command: ${tool.stopCommand}`)
      try {
        await runOnce(tool.stopCommand, tool.projectPath, tool.env)
      } catch (err) {
        stopCommandError = err instanceof Error ? err.message : String(err)
        this.runtime.appendLog(
          toolId,
          'system',
          `Stop command failed (continuing to terminate): ${stopCommandError}`,
        )
      }
    }

    try {
      // stopCommand was the ONLY lever for this tool and it failed — there is
      // nothing to terminate, so report the failure instead of claiming stopped.
      if (stopCommandError && !managed && !externalOwner && !externalReceipt) {
        throw new Error(stopCommandError)
      }

      if (managed) {
        await terminateProcess(managed)
        this.processes.delete(toolId)
      } else if (externalOwner && tool?.port) {
        this.runtime.appendLog(
          toolId,
          'system',
          `Stopping external process on port ${tool.port} (owner pid ${externalOwner.ownerPid})…`,
        )
        const result = await killPortOccupant(tool.port, {
          expectedPgid: externalOwner.ownerPid,
        })
        if (result.refused) {
          throw new Error('Port ownership changed; Shelf left the new process running.')
        }
        if (!result.freed) {
          throw new Error(
            `Port ${tool.port} still in use after stop (pid ${result.pid ?? externalOwner.ownerPid}).`,
          )
        }
      } else if (externalReceipt?.pid) {
        this.runtime.appendLog(
          toolId,
          'system',
          `Stopping external process (pid ${externalReceipt.pid}, launched by another Shelf process)…`,
        )
        await terminatePidGroup(externalReceipt.pid)
      }

      const externalPid = externalOwner?.ownerPid || externalReceipt?.pid
      const message = reason || (externalPid ? 'Stopped (external)' : 'Stopped')
      // Timeouts / forced stops count as failed runs; intentional stops as stopped.
      const outcome =
        reason && /timed out|quit|failed/i.test(reason) ? 'failed' : 'stopped'
      // For external stops, receiptId is the OTHER manager's receipt — the
      // store is shared, so finalizing here keeps launch history truthful
      // instead of leaving an open receipt for closeOrphans to mark interrupted.
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
        code: failure?.code,
        remedy: failure?.remedy,
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

  async restart(toolId: string, options: StartOptions = {}): Promise<ToolRuntimeState> {
    await this.stop(toolId)
    return this.start(toolId, options)
  }

  /**
   * Drop runtime state + logs for a tool whose record was deleted — without
   * this, listKnownStates() re-emits the ghost entry for the process
   * lifetime. Refuses while a child is still supervised.
   */
  forget(toolId: string): void {
    if (this.processes.has(toolId)) return
    this.runtime.forget(toolId)
  }

  /**
   * scope 'local' stops only processes THIS manager spawned — quitting the
   * GUI must not kill tools an agent's MCP server launched (and vice versa).
   * scope 'all' additionally stops adopted externals (smokes/cleanup).
   */
  async stopAll(
    reason = 'Shelf is quitting.',
    opts: { scope?: 'local' | 'all' } = {},
  ): Promise<void> {
    const scope = opts.scope || 'all'
    if (scope === 'local') {
      await Promise.all([...this.processes.keys()].map((id) => this.stop(id, reason)))
      return
    }
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
      trustedExternalOwner: (id, port, occupants) =>
        this.trustedExternalOwner(id, port, occupants),
      findActiveReceipt: (id) => this.findActiveReceipt(id),
    })
  }

  /** Run fn after every previously queued library-mutating launch step. */
  private enqueueLibraryWrite<T>(fn: () => Promise<T> | T): Promise<T> {
    const run = this.libraryWriteChain.then(fn, fn)
    this.libraryWriteChain = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  /**
   * Occupied-port handling for a launch: adopt a trusted Shelf owner, refuse
   * with port_in_use, or (reassign policy) pick a free port and persist the
   * rewritten entry. Runs inside enqueueLibraryWrite — see start().
   */
  private async resolvePortConflict(
    tool: Tool,
    onPortConflict: PortConflictPolicy,
    origin?: LaunchOrigin,
  ): Promise<{ tool: Tool; state?: ToolRuntimeState; reassignedFrom?: number }> {
    const toolId = tool.id
    const port = tool.port as number
    const occupants = await findPortOccupants(port)
    if (occupants.length === 0) return { tool }

    if (onPortConflict !== 'reassign') {
      const owner = await this.trustedExternalOwner(toolId, port, occupants)
      if (owner) {
        this.runtime.appendLog(
          toolId,
          'system',
          `Adopted Shelf process on port ${port} (owner pid ${owner.ownerPid}).`,
        )
        return {
          tool,
          state: this.runtime.setState(toolId, {
            toolId,
            status: 'running',
            pid: owner.ownerPid,
            message: `Running · port ${port} (external)`,
            port,
            origin: 'external',
            startedBy: owner.startedBy,
          }),
        }
      }

      const message = `Port ${port} is already in use by another process.`
      this.runtime.emitFailedReceipt({
        toolId,
        toolName: tool.name,
        launchCommand: tool.launchCommand,
        port,
        url: tool.url,
        message,
        startedBy: origin,
      })
      return {
        tool,
        state: this.runtime.setState(toolId, {
          toolId,
          status: 'error',
          message,
          code: 'port_in_use',
          remedy: remedyFor('port_in_use'),
        }),
      }
    }

    // Pick a free port and persist so GUI + future launches stay aligned.
    const previousPort = port
    const free = await findFreePort({ preferred: previousPort, from: 3000, to: 4999 })
    const nextPort = free.port
    const nextLaunch = withForcedPort(tool.launchCommand, nextPort)
    const nextUrl = urlForPort(tool.url, nextPort)
    const saved = this.store.save({
      ...tool,
      port: nextPort,
      url: nextUrl,
      launchCommand: nextLaunch,
      env: { ...(tool.env || {}), PORT: String(nextPort) },
    })
    return { tool: saved, reassignedFrom: previousPort }
  }

  /** Newest open receipt with a live pid for this tool, from any Shelf process. */
  private findActiveReceipt(toolId: string, port?: number): RunReceipt | undefined {
    try {
      return (
        this.options.receipts?.findActiveProcess(toolId, port) ??
        // Port drift (edited config, log-sniffed port) must not break ownership:
        // ancestry against the receipt pid is the real proof, not port equality.
        this.options.receipts?.findActiveProcess(toolId)
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.runtime.appendLog(toolId, 'system', `Receipt lookup failed: ${message}`)
      return undefined
    }
  }

  /**
   * Resolve a trusted owner for an externally-launched tool, or null. Trust =
   * an open Shelf receipt with a live pid whose process tree contains EVERY
   * current listener on the port (pgid match or bounded ancestry walk).
   */
  private async trustedExternalOwner(
    toolId: string,
    port: number,
    occupants: number[],
  ): Promise<ExternalOwner | null> {
    try {
      const receipt = this.findActiveReceipt(toolId, port)
      if (!receipt?.pid) return null
      const owned = await verifyOccupantsOwnedBy(occupants, receipt.pid)
      if (!owned) return null
      if (receipt.port !== port) {
        this.runtime.appendLog(
          toolId,
          'system',
          `Adopting via receipt with port ${receipt.port ?? 'unset'} (tool now configured for ${port}).`,
        )
        this.runtime.markReceiptRunning(receipt.id, { port })
      }
      return {
        ownerPid: receipt.pid,
        receiptId: receipt.id,
        receiptPort: receipt.port,
        startedBy: receipt.startedBy,
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.runtime.appendLog(toolId, 'system', `Ownership check failed: ${message}`)
      return null
    }
  }

  private async openReadyUrl(toolId: string, url: string): Promise<void> {
    if (!this.options.onReadyUrl) return
    try {
      await this.options.onReadyUrl(url)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.runtime.appendLog(toolId, 'system', `Tool is running, but its URL could not be opened: ${message}`)
    }
  }
}
