import { createHash } from 'node:crypto'
import fs from 'node:fs'
import type { UpdateCheck, UpdateCommit } from './contracts'
import { resolveShelfDataRoot } from './paths'
import { projectInstallCommands, readProjectFacts } from './project-facts'
import {
  diffManifests,
  MANIFEST_FILENAME,
  normalizeManifest,
  readManifest,
  type ToolManifest
} from './tool-manifest'
import { GIT_MISSING_REMEDY } from './tool-share-errors'
import {
  detectGitRemote,
  gitFailure,
  githubHelperArgs,
  resolveGhBinary,
  resolveGitBinary,
  runGit,
} from './tool-share-git'
import type { Tool } from './types'
import { readUpdateJournal } from './update-journal'

async function resolveRemoteTarget(git: string, cwd: string): Promise<string | null> {
  const head = await runGit(git, ['-C', cwd, 'symbolic-ref', '-q', '--short', 'refs/remotes/origin/HEAD'], { timeoutMs: 10_000 })
  if (head.ok && head.stdout.trim()) return head.stdout.trim()
  const upstream = await runGit(git, ['-C', cwd, 'rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], { timeoutMs: 10_000 })
  if (upstream.ok && upstream.stdout.trim()) return upstream.stdout.trim()
  for (const candidate of ['origin/main', 'origin/master']) {
    const exists = await runGit(git, ['-C', cwd, 'rev-parse', '--verify', '-q', candidate], { timeoutMs: 10_000 })
    if (exists.ok) return candidate
  }
  return null
}

async function manifestAtRef(git: string, cwd: string, ref: string): Promise<ToolManifest | null> {
  const show = await runGit(git, ['-C', cwd, 'show', `${ref}:${MANIFEST_FILENAME}`], { timeoutMs: 10_000 })
  if (!show.ok) return null
  try {
    return normalizeManifest(JSON.parse(show.stdout)).manifest
  } catch {
    return null
  }
}

export function localManifest(projectPath: string): ToolManifest | null {
  try {
    return readManifest(projectPath)?.manifest || null
  } catch {
    return null
  }
}

export async function workingTreeFingerprint(cwd: string, trackedOnly = false): Promise<string> {
  const git = await resolveGitBinary()
  if (!git) throw new Error(GIT_MISSING_REMEDY)
  const diff = await runGit(git, ['-C', cwd, 'diff', '--binary', 'HEAD'], { timeoutMs: 10_000 })
  const status = await runGit(git, ['-C', cwd, 'status', '--porcelain', trackedOnly ? '--untracked-files=no' : '--untracked-files=all'], { timeoutMs: 10_000 })
  if (!diff.ok || !status.ok) throw new Error('Could not verify local changes. No update was applied.')
  return createHash('sha256').update(diff.stdout).update(status.stdout).digest('hex')
}

/** Fetch and summarize. Touches nothing in the working tree. */
export async function checkToolUpdates(tool: Tool, dataRoot = resolveShelfDataRoot()): Promise<UpdateCheck> {
  const pending = readUpdateJournal(dataRoot, tool)
  if (pending) return { state: 'recovery_required', operationId: pending.id, input: { ...pending.input, resumeOperationId: pending.id }, message: `An update stopped during ${pending.phase.replaceAll('_', ' ')}. Review and resume the remaining steps. Local restore ref: ${pending.restoreRef || 'none needed'}.` }
  if (!tool.source || tool.source.kind !== 'git') return { state: 'not_shared' }
  const cwd = tool.projectPath
  if (!cwd || !fs.existsSync(cwd)) return { state: 'folder_missing' }
  const git = await resolveGitBinary()
  if (!git) {
    return {
      state: 'git_missing',
      message: 'This Mac is missing git, which Shelf needs to check for updates.',
      remedy: GIT_MISSING_REMEDY,
    }
  }
  const inside = await runGit(git, ['-C', cwd, 'rev-parse', '--is-inside-work-tree'], { timeoutMs: 10_000 })
  if (!inside.ok) return { state: 'not_git' }
  const remote = await detectGitRemote(cwd)
  if (!remote) return { state: 'no_remote' }

  const fetch = await runGit(
    git,
    [
      '-C', cwd,
      '-c', 'protocol.ext.allow=never',
      '-c', 'protocol.file.allow=never',
      ...githubHelperArgs(remote, await resolveGhBinary()),
      'fetch', '--prune', '--quiet', 'origin',
    ],
    { timeoutMs: 120_000 },
  )
  if (!fetch.ok) {
    return { state: 'fetch_failed', message: gitFailure(fetch, 'git fetch failed') }
  }
  // Re-point origin/HEAD in case the remote's default branch was renamed
  // (a stale origin/HEAD would otherwise report up_to_date forever).
  await runGit(git, ['-C', cwd, 'remote', 'set-head', 'origin', '--auto'], { timeoutMs: 10_000 })
  const target = await resolveRemoteTarget(git, cwd)
  if (!target) return { state: 'no_target_branch', remote }

  const headRun = await runGit(git, ['-C', cwd, 'rev-parse', 'HEAD'], { timeoutMs: 10_000 })
  const remoteRun = await runGit(git, ['-C', cwd, 'rev-parse', target], { timeoutMs: 10_000 })
  if (!headRun.ok || !remoteRun.ok) {
    return { state: 'fetch_failed', message: 'Could not read commits after fetching.' }
  }
  const ref = headRun.stdout.trim()
  const remoteRef = remoteRun.stdout.trim()

  const aheadRun = await runGit(git, ['-C', cwd, 'rev-list', '--count', `${target}..HEAD`], { timeoutMs: 10_000 })
  const behindRun = await runGit(git, ['-C', cwd, 'rev-list', '--count', `HEAD..${target}`], { timeoutMs: 10_000 })
  const ahead = Number(aheadRun.stdout.trim()) || 0
  const behind = Number(behindRun.stdout.trim()) || 0
  const statusRun = await runGit(git, ['-C', cwd, 'status', '--porcelain', '--untracked-files=no'], { timeoutMs: 10_000 })
  const dirty = statusRun.ok && statusRun.stdout.trim().length > 0

  // Nothing to take → nothing to offer. Local edits alone are not "diverged";
  // offering a hard reset with zero incoming commits would only destroy work.
  if (behind === 0) return { state: 'up_to_date', ref, remote, dirty }

  const logRun = await runGit(
    git,
    ['-C', cwd, 'log', '--no-decorate', '--format=%h%x09%s', '--max-count=50', `HEAD..${target}`],
    { timeoutMs: 10_000 },
  )
  const commits: UpdateCommit[] = logRun.ok
    ? logRun.stdout
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const [sha, ...rest] = l.split('\t')
        return { sha, subject: rest.join('\t').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 200) }
      })
    : []

  const before = localManifest(cwd)
  const after = await manifestAtRef(git, cwd, target)
  const manifestDiff = diffManifests(before, after)
  const changedFiles = await runGit(git, ['-C', cwd, 'diff', '--name-only', `HEAD..${target}`], { timeoutMs: 10_000 })
  const depsChanged =
    changedFiles.ok &&
    changedFiles.stdout
      .split('\n')
      .some((f) => DEPENDENCY_FILES.test(f.trim()))
  const added = (after?.bootstrap || []).filter((cmd) => !(before?.bootstrap || []).includes(cmd))
  // Dependencies changed → every declared step is worth re-running, and if
  // the manifest declares none, offer what detection would.
  const newBootstrap = depsChanged
    ? Array.from(new Set([...(after?.bootstrap || []), ...(after?.bootstrap?.length ? [] : detectedInstall(cwd))]))
    : added
  const newEnvKeys = Object.keys(after?.env || {}).filter(
    (key) => !(before?.env && key in before.env) && !(tool.env && key in tool.env),
  )

  const workingTree = await workingTreeFingerprint(cwd)
  if (ahead > 0 || dirty) {
    return {
      state: 'diverged',
      workingTree,
      ref,
      remoteRef,
      target,
      ahead,
      behind,
      dirty,
      commits,
      manifestDiff,
      newBootstrap,
      depsChanged,
      newEnvKeys,
      remote,
    }
  }
  return {
    state: 'updates_available',
    workingTree,
    ref,
    remoteRef,
    target,
    behind,
    commits,
    manifestDiff,
    newBootstrap,
    depsChanged,
    newEnvKeys,
    remote,
  }
}

const DEPENDENCY_FILES =
  /^(package\.json|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|requirements\.txt|pyproject\.toml|Pipfile(\.lock)?|poetry\.lock|Gemfile(\.lock)?|go\.(mod|sum)|Cargo\.(toml|lock))$/

/** The install command detection would propose for this folder (may be empty). */
export function detectedInstall(cwd: string): string[] {
  return projectInstallCommands(readProjectFacts(cwd), 'refresh')
}
