import fs from 'node:fs'
import { randomUUID } from 'node:crypto'
import { StringDecoder } from 'node:string_decoder'
import { z } from 'zod'
import type { ChildProcess } from 'node:child_process'
import type { LibraryStore } from './library-store'
import { processIdentity } from './process-identity'
import {
  spawnLoginShell,
  terminateProcess,
  terminatePidGroup,
  sanitizeEnv,
} from './process-lifecycle'
import { ProcessRuntimeSupport } from './process-runtime-support'
import { RunLogStore } from './run-log-store'
import { readProjectFacts } from './project-facts'
import { maskSecrets, sanitizeOutput, toolSecretValues } from './types'
import { VerificationStore } from './verification-store'
import {
  verificationActive,
  type VerificationRun,
  type VerificationStep,
  type StartVerificationInput,
  type SaveVerificationInput,
} from './verification-contracts'

function exists(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH'
  }
}
interface ActiveRun {
  run: VerificationRun
  logs: ProcessRuntimeSupport
  controller: AbortController
  done: Promise<void>
  child?: ChildProcess
  persistenceFailed?: boolean
}

/** Desktop-owned finite commands. Normal launcher state and receipts stay independent. */
export class VerificationRunner {
  readonly store: VerificationStore
  private readonly active = new Map<string, ActiveRun>()
  constructor(
    private readonly library: LibraryStore,
    private readonly changed: (toolId: string) => void = () => {},
  ) {
    this.store = new VerificationStore(library.getRoot())
  }
  private tool(id: string) {
    z.string().min(1).max(200).parse(id)
    const tool = this.library.get(id)
    if (!tool) throw new Error('This tool is no longer in the library.')
    return tool
  }
  get(id: string) {
    const tool = this.tool(id)
    const state = this.store.get(id)
    for (const run of state.runs) {
      if (!verificationActive(run.status) || this.active.get(id)?.run.id === run.id)
        continue
      // Never signal an owner or a child whose PID might have been reused.
      const ownerIdentity = processIdentity(run.owner.pid, true)
      if (
        exists(run.owner.pid) &&
        (!ownerIdentity || ownerIdentity === run.owner.identity)
      )
        continue
      const childAlive = run.child && (exists(run.child.pid) || exists(-run.child.pid))
      run.status = childAlive ? 'cleanup_required' : 'interrupted'
      run.message = childAlive
        ? 'Shelf was interrupted. This command may still be running. Cancel to attempt safe cleanup before running again.'
        : 'Shelf was interrupted. This run was not verified; review and run again.'
      if (!childAlive) run.endedAt = new Date().toISOString()
      for (const step of run.steps) {
        if (step.status === 'running') step.status = run.status
        if (step.status === 'pending') step.status = 'skipped'
      }
      this.store.update(run)
    }
    const local = this.active.get(id)
    if (local)
      state.runs = [local.run, ...state.runs.filter((run) => run.id !== local.run.id)]
    // Saved commands remain editable verbatim; historical evidence is always masked.
    return {
      ...state,
      runs: state.runs.map((run) => ({
        ...sanitizeOutput(run, toolSecretValues(tool)),
        owner: run.owner,
        child: run.child,
      })),
    }
  }
  save(input: SaveVerificationInput) {
    this.tool(input?.toolId)
    if (this.active.has(input.toolId))
      throw new Error('Finish or cancel verification before editing commands.')
    const result = this.store.save(input)
    this.changed(input.toolId)
    return result
  }
  suggest(id: string): VerificationStep[] {
    const tool = this.tool(id)
    if (!tool.projectPath)
      throw new Error('Set a project folder before adding verification commands.')
    const facts = readProjectFacts(tool.projectPath)
    return ['typecheck', 'lint', 'test', 'build']
      .filter((name) => facts.packageJson?.scripts[name])
      .map((name) => ({
        id: randomUUID(),
        label: name === 'typecheck' ? 'Typecheck' : name[0].toUpperCase() + name.slice(1),
        command: `${facts.packageManager} run ${name}`,
        timeoutSeconds: 600,
      }))
  }
  start(input: StartVerificationInput): VerificationRun {
    const clean = z
      .object({
        toolId: z.string().min(1).max(200),
        workflowRevision: z.string().uuid(),
        toolRevision: z.string(),
      })
      .strict()
      .parse(input)
    const tool = this.tool(clean.toolId)
    const state = this.get(tool.id)
    if (
      this.active.has(tool.id) ||
      state.runs.some((run) => verificationActive(run.status))
    )
      throw new Error('A verification is already active for this project.')
    if (
      state.workflow?.revision !== clean.workflowRevision ||
      tool.updatedAt !== clean.toolRevision
    )
      throw new Error(
        'Project configuration or commands changed. Review the current commands before running.',
      )
    if (!tool.projectPath || !fs.statSync(tool.projectPath).isDirectory())
      throw new Error(
        'The project folder is unavailable. Update the tool folder before running.',
      )
    const identity = processIdentity(process.pid, true)
    if (!identity)
      throw new Error(
        'Shelf could not establish process ownership. No commands were started.',
      )
    const workflow = state.workflow
    const secrets = [
      ...new Set([
        ...toolSecretValues(tool),
        ...workflow.steps.flatMap((step) =>
          toolSecretValues({ ...tool, launchCommand: step.command }),
        ),
      ]),
    ]
    const run: VerificationRun = {
      id: randomUUID(),
      toolId: tool.id,
      workflowRevision: workflow.revision,
      toolRevision: tool.updatedAt,
      projectPath: tool.projectPath,
      startedAt: new Date().toISOString(),
      status: 'running',
      steps: sanitizeOutput(
        workflow.steps.map((step) => ({ ...step, status: 'pending' as const })),
        secrets,
      ),
      owner: { pid: process.pid, identity },
    }
    this.store.begin(run)
    const logs = new ProcessRuntimeSupport(
      (_channel, payload) => {
        const line = payload as { stream?: string; text?: string; toolId?: string }
        if (
          line.stream === 'system' &&
          line.text?.startsWith('Shared log storage is unavailable')
        ) {
          const step = run.steps.find((item) => item.id === line.toolId)
          if (step)
            step.message =
              'Some output could not be saved. This result may have incomplete retained logs.'
        }
      },
      undefined,
      () => secrets,
      new RunLogStore(this.store.logRoot(run.id)),
    )
    const active: ActiveRun = {
      run,
      logs,
      controller: new AbortController(),
      done: Promise.resolve(),
    }
    this.active.set(tool.id, active)
    // Reserve synchronously before handing control back to IPC or a second click.
    active.done = Promise.resolve().then(() =>
      this.execute(active, workflow.steps, sanitizeEnv(tool.env) || {}, secrets),
    )
    this.changed(tool.id)
    return structuredClone(run)
  }
  private persist(active: ActiveRun) {
    try {
      this.store.update(active.run)
      active.persistenceFailed = false
    } catch (error) {
      active.persistenceFailed = true
      throw error
    }
    this.changed(active.run.toolId)
  }
  private async execute(
    active: ActiveRun,
    commands: VerificationStep[],
    env: Record<string, string>,
    secrets: string[],
  ) {
    const { run, logs } = active
    try {
      for (let index = 0; index < commands.length; index++) {
        if (active.controller.signal.aborted) {
          run.status = 'cancelled'
          break
        }
        const step = run.steps[index]
        step.status = 'running'
        step.startedAt = new Date().toISOString()
        logs.clearLogs(step.id)
        this.persist(active)
        const result = await this.command(active, commands[index], env)
        Object.assign(step, result, { endedAt: new Date().toISOString() })
        if (result.status !== 'passed') {
          run.status = result.status
          break
        }
        this.persist(active)
      }
      if (run.status === 'running')
        run.status = active.controller.signal.aborted ? 'cancelled' : 'passed'
    } catch (error) {
      run.status = 'failed'
      run.message = maskSecrets(
        error instanceof Error ? error.message : 'Verification failed.',
        secrets,
      ).slice(0, 4000)
    } finally {
      if (active.child) {
        try {
          await terminateProcess({ child: active.child, pgid: active.child.pid })
          active.child = undefined
          run.child = undefined
        } catch (error) {
          run.status = 'cleanup_required'
          run.message = maskSecrets(
            `Process cleanup failed: ${error instanceof Error ? error.message : String(error)}. Cancel to retry.`,
            secrets,
          ).slice(0, 4000)
        }
      }
      for (const step of run.steps) {
        if (step.status === 'pending') step.status = 'skipped'
        if (step.status === 'running') {
          step.status = run.status
          step.endedAt = new Date().toISOString()
        }
        logs.flushLogs(step.id)
      }
      if (run.status !== 'cleanup_required') run.endedAt = new Date().toISOString()
      try {
        this.persist(active)
      } catch {
        run.status = 'cleanup_required'
        run.message =
          `${run.message || ''} Verification history could not be saved. Cancel to retry saving before starting another run.`.trim()
        this.changed(run.toolId)
      }
      if (!active.child && !active.persistenceFailed) this.active.delete(run.toolId)
    }
  }
  private command(
    active: ActiveRun,
    step: VerificationStep,
    env: Record<string, string>,
  ): Promise<{
    status: 'passed' | 'failed' | 'cancelled' | 'timed_out'
    exitCode: number | null
  }> {
    const { run, logs, controller } = active
    return new Promise((resolve, reject) => {
      if (controller.signal.aborted) {
        resolve({ status: 'cancelled', exitCode: null })
        return
      }
      const child = spawnLoginShell(step.command, { cwd: run.projectPath, env })
      active.child = child
      let timedOut = false
      let finished = false
      let stopping: Promise<void> | undefined
      let pipesClosed = false
      let drainTimer: ReturnType<typeof setTimeout> | undefined
      const closed = new Promise<void>((resolve) =>
        child.once('close', () => {
          pipesClosed = true
          resolve()
        }),
      )
      const decoders = {
        stdout: new StringDecoder('utf8'),
        stderr: new StringDecoder('utf8'),
      }
      const stop = () => {
        stopping ||= terminateProcess({ child, pgid: child.pid })
        void stopping.catch(fail)
        return stopping
      }
      const timer = setTimeout(() => {
        timedOut = true
        void stop()
      }, step.timeoutSeconds * 1000)
      const abort = () => {
        void stop()
      }
      controller.signal.addEventListener('abort', abort, { once: true })
      const cleanup = () => {
        clearTimeout(timer)
        if (drainTimer) clearTimeout(drainTimer)
        controller.signal.removeEventListener('abort', abort)
        for (const stream of ['stdout', 'stderr'] as const) {
          logs.appendLog(step.id, stream, decoders[stream].end())
          child[stream]?.destroy()
        }
        logs.flushLogs(step.id)
      }
      const fail = (error: unknown) => {
        if (finished) return
        finished = true
        cleanup()
        reject(error)
      }
      for (const stream of ['stdout', 'stderr'] as const)
        child[stream]?.on('data', (chunk: Buffer) =>
          logs.appendLog(step.id, stream, decoders[stream].write(chunk)),
        )
      child.once('error', fail)
      // A zero-exit shell may leave background descendants holding pipes open.
      // Clean its owned group before allowing the next finite step to begin.
      child.once('exit', (code) => {
        void (async () => {
          await stop()
          if (finished) return
          // Exit precedes close: let Node drain the last pipe chunks before flushing.
          await Promise.race([
            closed,
            new Promise<void>((resolve) => {
              drainTimer = setTimeout(resolve, 2000)
            }),
          ])
          if (!pipesClosed)
            logs.appendLog(
              step.id,
              'system',
              'Output pipes did not close after process cleanup. A detached process may remain; inspect this project in Terminal. Output may be incomplete.',
            )
          if (finished) return
          finished = true
          cleanup()
          active.child = undefined
          run.child = undefined
          resolve({
            status: timedOut
              ? 'timed_out'
              : controller.signal.aborted
                ? 'cancelled'
                : code === 0 && pipesClosed
                  ? 'passed'
                  : 'failed',
            exitCode: code,
          })
        })().catch(fail)
      })
      child.once('spawn', () => {
        try {
          run.child = {
            pid: child.pid!,
            identity: processIdentity(child.pid!, true) || 'unavailable',
          }
          this.persist(active)
          if (controller.signal.aborted) void stop()
        } catch (error) {
          fail(error)
        }
      })
    })
  }
  async cancel(id: string, runId: string) {
    this.tool(id)
    z.string().uuid().parse(runId)
    const local = this.active.get(id)
    if (local && local.run.id === runId) {
      local.controller.abort()
      await local.done
      if (local.child) {
        await terminateProcess({ child: local.child, pgid: local.child.pid })
        local.child = undefined
        local.run.child = undefined
        local.run.status = 'cancelled'
        local.run.endedAt = new Date().toISOString()
        local.run.message = 'Process cleanup completed after cancellation.'
        for (const step of local.run.steps)
          if (step.status === 'cleanup_required') step.status = 'cancelled'
      }
      if (local.run.status === 'cleanup_required') {
        local.run.status = 'interrupted'
        local.run.endedAt = new Date().toISOString()
        local.run.message =
          'Commands stopped. History persistence recovered; run again for a complete verification.'
      }
      this.persist(local)
      this.active.delete(id)
      return
    }
    const run = this.get(id).runs.find((item) => item.id === runId)
    if (!run || !verificationActive(run.status)) return
    const ownerIdentity = processIdentity(run.owner.pid, true)
    if (exists(run.owner.pid) && (!ownerIdentity || ownerIdentity === run.owner.identity))
      throw new Error(
        'This verification belongs to another running Shelf instance. Cancel it there.',
      )
    if (run.child && (exists(run.child.pid) || exists(-run.child.pid))) {
      if (
        run.child.identity === 'unavailable' ||
        processIdentity(run.child.pid, true) !== run.child.identity
      )
        throw new Error(
          `Cannot safely identify process group ${run.child.pid}. Inspect and stop that command in Terminal, then retry Cancel. Shelf will not signal an unverified process.`,
        )
      await terminatePidGroup(run.child.pid)
    }
    run.child = undefined
    run.status = 'interrupted'
    run.endedAt = new Date().toISOString()
    run.message =
      'Interrupted command has stopped. Review and run again to verify this project.'
    for (const step of run.steps)
      if (verificationActive(step.status)) step.status = 'interrupted'
    this.store.update(run)
    this.changed(id)
  }
  logs(id: string, runId: string, stepId: string) {
    const tool = this.tool(id)
    const run = this.get(id).runs.find((item) => item.id === runId)
    if (!run || !run.steps.some((step) => step.id === stepId))
      throw new Error('The selected verification step is no longer available.')
    const local = this.active.get(id)
    const lines =
      local?.run.id === runId
        ? local.logs.getLogs(stepId)
        : new RunLogStore(this.store.logRoot(runId)).read(stepId, toolSecretValues(tool))
    return sanitizeOutput(lines, toolSecretValues(tool))
  }
  activity() {
    return this.library.list().flatMap((tool) => {
      try {
        return this.get(tool.id)
          .runs.filter((run) => verificationActive(run.status))
          .map((run) => ({ toolId: tool.id, name: tool.name, status: run.status }))
      } catch {
        return []
      } // A damaged workflow is reported when opened, never as a running command.
    })
  }
  async stopAll() {
    // Read all local runs before awaits; failed cleanup keeps ownership for another attempt.
    const results = await Promise.allSettled(
      [...this.active.values()].map((item) => this.cancel(item.run.toolId, item.run.id)),
    )
    const failed = results.find((result) => result.status === 'rejected')
    if (failed?.status === 'rejected') throw failed.reason
  }
  async stopTool(id: string) {
    for (const run of this.get(id).runs.filter((run) => verificationActive(run.status)))
      await this.cancel(id, run.id)
    const local = this.active.get(id)
    if (local) await this.cancel(id, local.run.id)
  }
}
