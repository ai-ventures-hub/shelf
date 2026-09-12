import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { ApplyUpdateInput, ApplyUpdateResult } from './contracts'
import type { LibraryStore } from './library-store'
import { urlForPort, withForcedPort } from './ports'
import type { ProcessManager } from './process-manager'
import { ProcessOperations } from './process-operation'
import { runBootstrap } from './project-bootstrap'
import type { ToolManifest } from './tool-manifest'
import { GIT_MISSING_REMEDY } from './tool-share-errors'
import { currentCommit, gitFailure, resolveGitBinary, runGit } from './tool-share-git'
import { detectedInstall, localManifest, workingTreeFingerprint } from './tool-share-update-check'
import type { Tool } from './types'
import { clearUpdateJournal, readUpdateJournal, writeUpdateJournal } from './update-journal'

/**
 * Pull after explicit confirmation. Metadata from the new manifest is
 * applied only to fields the user had NOT changed locally (their value
 * still equals what the old manifest said) — local edits win.
 */
export async function applyToolUpdate(
  tool: Tool,
  input: ApplyUpdateInput,
  deps: { store: LibraryStore; processes?: ProcessManager },
): Promise<ApplyUpdateResult> {
  const root = deps.store.getRoot()
  const key = `project-update:${tool.projectPath || tool.id}`
  const operations = new ProcessOperations(root)
  return operations.run(key, () => operations.run(tool.id, () => applyToolUpdateLocked(tool, input, deps)))
}

async function applyToolUpdateLocked(
  tool: Tool, input: ApplyUpdateInput, deps: { store: LibraryStore; processes?: ProcessManager },
): Promise<ApplyUpdateResult> {
  const root = deps.store.getRoot()
  const failed = (message: string): ApplyUpdateResult => ({ ok: false, message, applied: [], skipped: [], missingEnvKeys: [], running: false })
  const cwd = tool.projectPath
  if (!cwd || !fs.existsSync(cwd)) return failed('Project folder is missing.')
  let journal = readUpdateJournal(root, tool)
  if (journal) {
    if (input.resumeOperationId !== journal.id) return failed('An earlier update needs recovery. Check for updates again to resume it.')
    input = journal.input
  }
  // Target is a ref name we produced (origin/main); reject anything that
  // could read as a flag or a path spec since it goes on the git command line.
  if (!/^[A-Za-z0-9][A-Za-z0-9._\-/]*$/.test(input.target) || input.target.includes('..')) {
    return { ok: false, message: 'Invalid update target.', applied: [], skipped: [], missingEnvKeys: [], running: false }
  }
  const git = await resolveGitBinary()
  if (!git) return { ok: false, message: GIT_MISSING_REMEDY, applied: [], skipped: [], missingEnvKeys: [], running: false }

  const currentRef = await currentCommit(git, cwd)
  const targetRef = await runGit(git, ['-C', cwd, 'rev-parse', input.target], { timeoutMs: 10_000 })
  if (!input.expectedRef || !/^[a-f0-9]{40,64}$/.test(input.expectedTargetRef || '') || !input.expectedWorkingTree) return failed('Check for updates again before applying. The reviewed revision is missing.')
  const filesAlreadyApplied = Boolean(journal && currentRef === input.expectedTargetRef)
  if (!filesAlreadyApplied && (!targetRef.ok || targetRef.stdout.trim() !== input.expectedTargetRef)) return failed('The shared revision changed after review. Check for updates again.')
  if (filesAlreadyApplied && journal?.appliedFingerprint && await workingTreeFingerprint(cwd, true) !== journal.appliedFingerprint) {
    return failed('Tracked files changed since this update paused. Preserve those edits and restore the paused working tree before resuming setup.')
  }
  if (!filesAlreadyApplied && (currentRef !== input.expectedRef || await workingTreeFingerprint(cwd) !== input.expectedWorkingTree)) return failed('Local files changed after review. No update was applied. Check for updates again.')
  const before = journal?.beforeManifest || localManifest(cwd)
  // Detection can change across the pull (a lockfile swap). Allow what the
  // check could have offered from EITHER side, so a ticked box is honoured.
  const preInstall = detectedInstall(cwd)
  const runningState = deps.processes ? await deps.processes.getState(tool.id) : undefined
  const running = Boolean(runningState?.pid) || runningState?.status === 'running' || runningState?.status === 'starting' || runningState?.status === 'stopping'
  if (running) return failed('Stop this tool before updating its files, then check for updates again.')
  if (!journal) {
    journal = { id: randomUUID(), toolId: tool.id, projectPath: cwd, input, beforeManifest: before || null, phase: 'prepared', completedSetup: [] }
    if (input.mode === 'take_theirs') {
      const incoming = await runGit(git, ['-C', cwd, 'diff', '--name-only', '-z', input.expectedRef, input.expectedTargetRef], { timeoutMs: 10_000 })
      if (!incoming.ok) return failed('Could not inspect incoming files. Nothing changed.')
      for (const file of incoming.stdout.split('\0').filter(Boolean)) {
        if (!fs.existsSync(path.join(cwd, file))) continue
        const tracked = await runGit(git, ['-C', cwd, 'ls-files', '--error-unmatch', '--', file], { timeoutMs: 10_000 })
        if (!tracked.ok) return failed(`The update would overwrite an untracked local file: ${file}. Move it before retrying.`)
      }
      const snapshot = await runGit(git, ['-C', cwd, 'stash', 'create', 'Shelf update restore point'], { timeoutMs: 30_000 })
      if (!snapshot.ok) return failed('Could not preserve local changes. Nothing changed.')
      journal.restoreRef = `refs/shelf/backups/${journal.id}`
      const backup = await runGit(git, ['-C', cwd, 'update-ref', journal.restoreRef, snapshot.stdout.trim() || input.expectedRef], { timeoutMs: 10_000 })
      if (!backup.ok) return failed('Could not preserve the previous revision. Nothing changed.')
    }
    writeUpdateJournal(root, journal)
  }
  const pull = filesAlreadyApplied ? { ok: true, code: 0, stdout: '', stderr: '' } :
    input.mode === 'take_theirs'
      ? await runGit(git, ['-C', cwd, 'reset', '--hard', input.expectedTargetRef], { timeoutMs: 60_000 })
      : await runGit(git, ['-C', cwd, 'merge', '--ff-only', '--no-edit', input.expectedTargetRef], { timeoutMs: 60_000 })
  if (!pull.ok) {
    if (await currentCommit(git, cwd) === input.expectedRef && await workingTreeFingerprint(cwd) === input.expectedWorkingTree) clearUpdateJournal(root, cwd)
    return {
      ok: false,
      message: `Update failed: ${gitFailure(pull, 'git could not update the folder')}`,
      applied: [],
      skipped: [],
      missingEnvKeys: [],
      running,
    }
  }
  journal.phase = 'files_applied'
  journal.appliedFingerprint = await workingTreeFingerprint(cwd, true)
  writeUpdateJournal(root, journal)
  const ref = await currentCommit(git, cwd)
  const after = localManifest(cwd)

  const applied: string[] = []
  const skipped: { field: string; reason: string }[] = []
  const next: Tool = { ...tool }
  const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
  const empty = (v: unknown) => v == null || v === '' || (Array.isArray(v) && v.length === 0)
  // When the OLD manifest left a field empty, the tool's current value came
  // from local inspection/detection, not a deliberate edit — say so softly.
  const editReason = (old: unknown) =>
    empty(old)
      ? 'this tool already had its own value, so the shared one was not applied'
      : 'you changed this locally, so the shared value was not applied'
  if (after) {
    for (const key of ['name', 'description', 'notes'] as const) {
      const incoming = after[key]
      const old = before?.[key]
      if (same(incoming, old)) continue
      if (same(tool[key] || undefined, old || undefined)) {
        if (key === 'name') next.name = incoming || tool.name
        else next[key] = incoming
        applied.push(key)
      } else skipped.push({ field: key, reason: editReason(old) })
    }
    // launchCommand: a healed port rewrote the local command (PORT= prefix,
    // --port flag). That is not a local edit — compare after re-pinning the
    // OLD manifest command to the tool's port, and re-pin the new one too.
    if (!same(after.launchCommand, before?.launchCommand)) {
      const pinned = tool.port && before?.launchCommand ? withForcedPort(before.launchCommand, tool.port) : undefined
      const unchanged =
        same(tool.launchCommand, before?.launchCommand) || (pinned !== undefined && same(tool.launchCommand, pinned))
      if (unchanged) {
        next.launchCommand =
          pinned !== undefined && same(tool.launchCommand, pinned) && tool.port
            ? withForcedPort(after.launchCommand, tool.port)
            : after.launchCommand
        applied.push('launchCommand')
      } else skipped.push({ field: 'launchCommand', reason: editReason(before?.launchCommand) })
    }
    for (const key of ['tags', 'capabilities'] as const) {
      if (same(after[key], before?.[key] || [])) continue
      if (same(tool[key], before?.[key] || [])) {
        next[key] = after[key]
        applied.push(key)
      } else skipped.push({ field: key, reason: editReason(before?.[key]) })
    }
    const accessKey = (list: ToolManifest['agentAccess']) =>
      JSON.stringify(list.map((a) => [a.kind, a.transport, a.entrypoint, a.setupRequired, a.notes]))
    if (accessKey(after.agentAccess) !== accessKey(before?.agentAccess || [])) {
      if (accessKey(tool.agentAccess) === accessKey(before?.agentAccess || [])) {
        next.agentAccess = after.agentAccess
        applied.push('agentAccess')
      } else skipped.push({ field: 'agentAccess', reason: editReason(before?.agentAccess) })
    }
    // Port/url only when the local copy still sits on the old manifest's
    // port (a healed/reassigned port is a local fact we must keep). Keep
    // url and a pinned command in step with the new port.
    if (after.port && after.port !== before?.port) {
      if (tool.port === before?.port) {
        next.port = after.port
        next.url = after.url ? urlForPort(after.url, after.port) : urlForPort(tool.url, after.port)
        if (before?.port && next.launchCommand === withForcedPort(next.launchCommand, before.port)) {
          next.launchCommand = withForcedPort(next.launchCommand, after.port)
        }
        applied.push('port')
      } else skipped.push({ field: 'port', reason: `your copy runs on port ${tool.port}, which Shelf kept` })
    }
  }
  next.source = {
    ...(tool.source || { kind: 'git', addedAt: new Date().toISOString() }),
    ref,
    updatedAt: new Date().toISOString(),
  }
  let saved: Tool
  try { saved = deps.store.save(next) }
  catch (err) { return { ...failed(`Files updated, but library save failed: ${err instanceof Error ? err.message : String(err)}. Check updates to resume.`), operationId: journal.id, restoreRef: journal.restoreRef, ref } }
  journal.phase = 'metadata_saved'
  writeUpdateJournal(root, journal)

  const missingEnvKeys = Object.keys(after?.env || {}).filter(
    (key) => key !== 'PORT' && !(saved.env && key in saved.env),
  )

  // What runs is what was shown, enforced here: only commands the fetched
  // manifest declares (or the detected install, pre- or post-pull) can run,
  // never an arbitrary string from the caller.
  const allowed = new Set([...(after?.bootstrap || []), ...preInstall, ...detectedInstall(cwd)])
  const setupCommands = (input.setupCommands || []).filter((cmd) => allowed.has(cmd))
  if (input.runSetup && (input.setupCommands || []).length && setupCommands.length === 0) {
    skipped.push({
      field: 'setup',
      reason: 'the setup commands no longer match the updated project, so nothing was run',
    })
  }
  let setup: { command: string; ok: boolean }[] | undefined
  if (input.runSetup && setupCommands.length) {
    setup = []
    for (const command of setupCommands) {
      if (journal.completedSetup.includes(command)) { setup.push({ command, ok: true }); continue }
      deps.processes?.appendLog(saved.id, 'system', `Setup: ${command}`)
      const result = await runBootstrap(
        { command, label: 'Setup step from the shared manifest' },
        {
          cwd,
          onLog: (stream, text) => deps.processes?.appendLog(saved.id, stream, text),
        },
      )
      setup.push({ command, ok: result.ok })
      journal.appliedFingerprint = await workingTreeFingerprint(cwd, true)
      if (!result.ok) {
        journal.phase = 'setup_failed'
        writeUpdateJournal(root, journal)
        return { ok: false, message: 'Files and library updated, but setup failed. Check for updates to retry the remaining setup steps.', tool: saved, ref, applied, skipped, missingEnvKeys, setup, running, operationId: journal.id, restoreRef: journal.restoreRef }
      }
      journal.completedSetup.push(command)
      writeUpdateJournal(root, journal)
    }
  }

  clearUpdateJournal(root, cwd)
  return {
    ok: true,
    restoreRef: journal.restoreRef,
    message:
      input.mode === 'take_theirs'
        ? 'Replaced your copy with the shared version.'
        : 'Updated to the latest shared version.',
    tool: saved,
    ref,
    applied,
    skipped,
    missingEnvKeys,
    setup,
    running,
  }
}
