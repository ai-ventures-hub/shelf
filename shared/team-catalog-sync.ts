/**
 * Git side of the Team Tools catalog (v1.4). Clone, refresh, and publish an
 * entry, reusing tool-share's hardened git invocation rather than growing a
 * second one — the allow-list, the disabled ext/file protocols, the
 * neutered hooks path, GIT_TERMINAL_PROMPT=0, and the `gh` credential helper
 * all have to stay identical to the receive path, and two copies drift.
 *
 * Only `catalog.json` is ever read out of a catalog clone. Nothing in one of
 * these repos is executed, copied into the library, or shown to the user
 * beyond the entries the normalizer produced.
 */
import fs from 'node:fs'
import path from 'node:path'
import {
  ShareError,
  cloneFailure,
  gitFailure,
  githubHelperArgs,
  requireGit,
  resolveGhBinary,
  runGit,
  validateRepoUrl,
} from './tool-share'
import {
  CATALOG_FILENAME,
  emptyCatalog,
  readCatalogFile,
  upsertCatalogEntry,
  writeCatalogFile,
  type CatalogEntry,
  type TeamCatalogFile,
} from './team-catalog'
import type { TeamCatalog, TeamCatalogStore } from './team-catalog-store'

const CLONE_TIMEOUT_MS = 120_000
const GIT_TIMEOUT_MS = 60_000

/**
 * One git operation per catalog at a time. Refresh and publish both drive git
 * inside the same working clone, and the GUI can start a publish while a
 * refresh is still running. Same shape as ProcessManager's per-tool launch
 * mutex: queue, never run two in one work tree.
 */
const inFlight = new Map<string, Promise<unknown>>()

function serialized<T>(catalogId: string, work: () => Promise<T>): Promise<T> {
  const prior = inFlight.get(catalogId) || Promise.resolve()
  const next = prior.then(work, work)
  inFlight.set(
    catalogId,
    next.then(
      () => undefined,
      () => undefined,
    ),
  )
  return next
}

/** Config flags that must accompany every git call touching a remote. */
function hardening(): string[] {
  return [
    '-c', 'protocol.ext.allow=never',
    '-c', 'protocol.file.allow=never',
    '-c', 'core.hooksPath=/dev/null',
  ]
}

function isGitRepo(dir: string): boolean {
  try {
    return fs.statSync(path.join(dir, '.git')).isDirectory()
  } catch {
    return false
  }
}

/** IPC shape for catalog:add / catalog:refresh (the ok side). */
export interface CatalogSyncView {
  ok: true
  catalog: TeamCatalog
  warnings: string[]
  empty: boolean
}

export interface CatalogSyncResult {
  catalog: TeamCatalog
  /** Entry count after the refresh, for the "12 tools" line in the pane. */
  count: number
  warnings: string[]
  /** True when the repo has no catalog.json yet (a team repo not started). */
  empty: boolean
}

/**
 * Bring a subscribed catalog's clone up to date and re-read its entries.
 *
 * Refresh is fetch + `merge --ff-only`, never `reset --hard`: an unpushed
 * "Share with team" commit has to survive, and when the merge can't
 * fast-forward the user is told rather than silently losing the entry.
 */
export function syncCatalog(
  catalogId: string,
  store: TeamCatalogStore,
): Promise<CatalogSyncResult> {
  return serialized(catalogId, () => syncCatalogLocked(catalogId, store))
}

async function syncCatalogLocked(
  catalogId: string,
  store: TeamCatalogStore,
): Promise<CatalogSyncResult> {
  const record = store.get(catalogId)
  if (!record) throw new ShareError('catalog_missing', 'That team catalog is no longer subscribed.')

  const valid = validateRepoUrl(record.url)
  if (!valid.ok) throw new ShareError('invalid_repo', valid.reason)

  const git = await requireGit()
  const gh = await resolveGhBinary()
  const dir = store.clonePath(record.id)
  let unpushed = false

  try {
    if (!isGitRepo(dir)) {
      // A half-written clone from an interrupted run would make `clone` fail
      // on a non-empty directory; start clean.
      fs.rmSync(dir, { recursive: true, force: true })
      const clone = await runGit(
        git,
        [
          ...hardening(),
          ...githubHelperArgs(valid.url, gh),
          // NOT shallow. A depth-1 clone refreshed by a depth-1 fetch leaves
          // two grafted root commits, so `merge --ff-only` reports unrelated
          // histories and the refresh silently keeps stale entries. A catalog
          // repo is one small file; full history is the cheap, correct option.
          'clone', '--quiet', '--single-branch', '--', valid.url, dir,
        ],
        { timeoutMs: CLONE_TIMEOUT_MS },
      )
      if (!clone.ok) throw cloneFailure(valid.url, clone)
    } else {
      const fetch = await runGit(
        git,
        [...hardening(), ...githubHelperArgs(valid.url, gh), '-C', dir, 'fetch', '--quiet', 'origin'],
        { timeoutMs: CLONE_TIMEOUT_MS },
      )
      if (!fetch.ok) throw cloneFailure(valid.url, fetch)

      const head = await runGit(git, ['-C', dir, 'rev-parse', 'HEAD'], { timeoutMs: GIT_TIMEOUT_MS })
      const remote = await runGit(git, ['-C', dir, 'rev-parse', 'FETCH_HEAD'], {
        timeoutMs: GIT_TIMEOUT_MS,
      })
      // Commits here that the remote doesn't have. Computed for EVERY
      // refresh, not just a failed merge: when the remote hasn't moved, the
      // ff-merge of an ancestor succeeds trivially, and deciding "unpushed"
      // from the merge result alone would clear the warning while the entry
      // was still sitting in this clone.
      const aheadCount = await runGit(git, ['-C', dir, 'rev-list', '--count', 'FETCH_HEAD..HEAD'], {
        timeoutMs: GIT_TIMEOUT_MS,
      })
      unpushed = aheadCount.ok && Number(aheadCount.stdout.trim()) > 0
      if (head.ok && remote.ok && head.stdout.trim() !== remote.stdout.trim()) {
        const merge = await runGit(git, ['-C', dir, 'merge', '--ff-only', 'FETCH_HEAD'], {
          timeoutMs: GIT_TIMEOUT_MS,
        })
        if (!merge.ok) {
          // A local commit the remote doesn't have is the expected case: a
          // "Share with team" whose push failed. Keep it and say so. But
          // only when the two sides share history — an unrelated history
          // means the repo was replaced or force-pushed, and calling that
          // "you have an unpushed entry" would hide it behind a reassuring
          // label while the pane showed stale entries.
          const related = await runGit(git, ['-C', dir, 'merge-base', 'FETCH_HEAD', 'HEAD'], {
            timeoutMs: GIT_TIMEOUT_MS,
          })
          unpushed = unpushed && related.ok
          if (!unpushed) {
            throw new ShareError(
              'clone_failed',
              related.ok
                ? `Couldn't update that catalog: ${gitFailure(merge, 'git merge failed')}`
                : `That catalog's history no longer matches the copy on this Mac, so Shelf won't merge it. Unsubscribe and add it again if the team replaced the repo.`,
            )
          }
        }
      }
    }

    const read = readCatalogFile(dir)
    const now = new Date().toISOString()
    if (!read) {
      const updated = store.update(record.id, {
        lastFetchedAt: now,
        lastError: undefined,
        warnings: undefined,
        hasUnpushedEntry: unpushed || undefined,
        entries: [],
      })
      return { catalog: updated || record, count: 0, warnings: [], empty: true }
    }

    const updated = store.update(record.id, {
      name: read.catalog.name?.trim() || record.name,
      lastFetchedAt: now,
      lastError: undefined,
      warnings: read.warnings.length > 0 ? read.warnings : undefined,
      hasUnpushedEntry: unpushed || undefined,
      entries: read.catalog.tools,
    })
    return {
      catalog: updated || record,
      count: read.catalog.tools.length,
      warnings: read.warnings,
      empty: false,
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // The record keeps its last good entries so the pane stays usable
    // offline; the error rides alongside them.
    store.update(record.id, { lastError: message })
    throw err
  }
}

/** Subscribe to a catalog URL and fetch it once. */
export async function addCatalog(
  url: string,
  store: TeamCatalogStore,
): Promise<CatalogSyncResult> {
  const valid = validateRepoUrl(url)
  if (!valid.ok) throw new ShareError('invalid_repo', valid.reason)
  const existing = store.findByUrl(valid.url)
  const record = existing || store.add(valid.url)
  try {
    return await syncCatalog(record.id, store)
  } catch (err) {
    // A URL that never fetched shouldn't linger as a broken subscription.
    if (!existing) store.remove(record.id)
    throw err
  }
}

export interface PublishResult {
  action: 'added' | 'updated'
  /** False when the commit is local because the push failed or was refused. */
  pushed: boolean
  /** Why the push didn't happen, in plain language. */
  pushProblem?: string
  pushRemedy?: string
  pushRemedyCommand?: string
  count: number
}

/**
 * Append (or update) this tool's entry in a catalog, commit it, and push when
 * git can. A failed push is not a failed publish: the commit stays, the record
 * is flagged, and the user is told exactly how to finish it.
 */
export function publishToCatalog(
  catalogId: string,
  entry: CatalogEntry,
  store: TeamCatalogStore,
): Promise<PublishResult> {
  return serialized(catalogId, () => publishToCatalogLocked(catalogId, entry, store))
}

async function publishToCatalogLocked(
  catalogId: string,
  entry: CatalogEntry,
  store: TeamCatalogStore,
): Promise<PublishResult> {
  const record = store.get(catalogId)
  if (!record) throw new ShareError('catalog_missing', 'That team catalog is no longer subscribed.')

  const entryUrl = validateRepoUrl(entry.repo)
  if (!entryUrl.ok) throw new ShareError('invalid_repo', entryUrl.reason)

  const valid = validateRepoUrl(record.url)
  if (!valid.ok) throw new ShareError('invalid_repo', valid.reason)

  // Publish onto current remote state, so two people adding tools the same
  // afternoon don't produce a non-fast-forward push. Calls the UNLOCKED sync:
  // this function already holds the catalog's slot.
  await syncCatalogLocked(catalogId, store)

  const git = await requireGit()
  const gh = await resolveGhBinary()
  const dir = store.clonePath(record.id)

  const identity = await gitIdentity(git, dir)
  if (!identity) {
    throw new ShareError(
      'push_failed',
      "git on this Mac has no name and email set, so Shelf can't make a commit in your name.",
      'Set them once and try again.',
      'git config --global user.name "Your Name" && git config --global user.email "you@example.com"',
    )
  }

  const existing = readCatalogFile(dir)
  const base: TeamCatalogFile = existing?.catalog || emptyCatalog(record.name)
  const result = upsertCatalogEntry(base, { ...entry, repo: entryUrl.url })
  writeCatalogFile(dir, result.catalog)

  const add = await runGit(git, ['-C', dir, 'add', '--', CATALOG_FILENAME], {
    timeoutMs: GIT_TIMEOUT_MS,
  })
  if (!add.ok) {
    throw new ShareError('catalog_invalid', `Couldn't stage the catalog: ${gitFailure(add, 'git add failed')}`)
  }

  const message = `${result.action === 'added' ? 'Add' : 'Update'} ${entry.name} in the Shelf catalog`
  const commit = await runGit(git, ['-C', dir, 'commit', '--quiet', '-m', message], {
    timeoutMs: GIT_TIMEOUT_MS,
  })
  if (!commit.ok && !/nothing to commit|no changes added/i.test(`${commit.stdout}${commit.stderr}`)) {
    throw new ShareError(
      'catalog_invalid',
      `Couldn't commit the catalog entry: ${gitFailure(commit, 'git commit failed')}`,
    )
  }

  // Clones are no longer shallow, but a clone left by an earlier build might
  // be, and some servers refuse a push from one. Cheap insurance.
  if (fs.existsSync(path.join(dir, '.git', 'shallow'))) {
    await runGit(
      git,
      [...hardening(), ...githubHelperArgs(valid.url, gh), '-C', dir, 'fetch', '--quiet', '--unshallow'],
      { timeoutMs: CLONE_TIMEOUT_MS },
    )
  }

  const push = await runGit(
    git,
    [...hardening(), ...githubHelperArgs(valid.url, gh), '-C', dir, 'push', '--quiet'],
    { timeoutMs: CLONE_TIMEOUT_MS },
  )

  const count = result.catalog.tools.length
  if (push.ok) {
    store.update(record.id, {
      entries: result.catalog.tools,
      hasUnpushedEntry: undefined,
      lastFetchedAt: new Date().toISOString(),
      lastError: undefined,
    })
    return { action: result.action, pushed: true, count }
  }

  const failure = cloneFailure(valid.url, push)
  store.update(record.id, { entries: result.catalog.tools, hasUnpushedEntry: true })
  return {
    action: result.action,
    pushed: false,
    pushProblem: `Your entry is committed here, but the push to ${record.name} didn't go through. ${failure.message}`,
    pushRemedy: failure.remedy,
    pushRemedyCommand: failure.remedyCommand,
    count,
  }
}

/** The user's git identity, or null when git has neither name nor email. */
async function gitIdentity(git: string, dir: string): Promise<{ name: string; email: string } | null> {
  const name = await runGit(git, ['-C', dir, 'config', 'user.name'], { timeoutMs: GIT_TIMEOUT_MS })
  const email = await runGit(git, ['-C', dir, 'config', 'user.email'], { timeoutMs: GIT_TIMEOUT_MS })
  const n = name.stdout.trim()
  const e = email.stdout.trim()
  if (!n || !e) return null
  return { name: n, email: e }
}
