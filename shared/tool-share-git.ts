import { execFile } from 'node:child_process'
import fs from 'node:fs'
import { GIT_MISSING_REMEDY, ShareError } from './tool-share-errors'

// ---------------------------------------------------------------------------
// git plumbing
// ---------------------------------------------------------------------------

export interface GitRun {
  ok: boolean
  code: number | null
  stdout: string
  stderr: string
}

let cachedGit: string | null | undefined

export function fileExists(p: string): boolean {
  try {
    return fs.statSync(p).isFile()
  } catch {
    return false
  }
}

/**
 * Locate a usable git. On macOS `/usr/bin/git` is a shim that pops the
 * Command Line Tools installer when nothing is installed — so check
 * `xcode-select -p` first instead of calling git blind, then fall back to
 * Homebrew installs.
 */
export async function resolveGitBinary(): Promise<string | null> {
  if (cachedGit !== undefined) return cachedGit
  const override = process.env.SHELF_GIT_BINARY?.trim()
  if (override) {
    cachedGit = override
    return override
  }
  if (process.platform === 'darwin') {
    const xcode = await new Promise<boolean>((resolve) => {
      execFile('/usr/bin/xcode-select', ['-p'], { timeout: 5000 }, (err) => resolve(!err))
    })
    if (xcode && fileExists('/usr/bin/git')) {
      cachedGit = '/usr/bin/git'
      return cachedGit
    }
    for (const candidate of ['/opt/homebrew/bin/git', '/usr/local/bin/git']) {
      if (fileExists(candidate)) {
        cachedGit = candidate
        return cachedGit
      }
    }
    cachedGit = null
    return null
  }
  cachedGit = 'git'
  return cachedGit
}

export async function requireGit(): Promise<string> {
  const git = await resolveGitBinary()
  if (!git) {
    throw new ShareError(
      'git_missing',
      'This Mac is missing git, which Shelf needs to fetch shared tools.',
      GIT_MISSING_REMEDY,
      'xcode-select --install',
    )
  }
  return git
}

let cachedGh: string | null = null

/**
 * Locate the GitHub CLI if the user has it. gh holds their GitHub auth; when
 * present we let git borrow it for private clones over https — Shelf never
 * sees or stores the token, and nothing is written to their global config.
 */
export async function resolveGhBinary(): Promise<string | null> {
  // Cache only a HIT: a miss must be re-probed, so installing gh after an
  // auth_required card and retrying Fetch works without restarting Shelf.
  if (cachedGh) return cachedGh
  const override = process.env.SHELF_GH_BINARY?.trim()
  if (override) return fileExists(override) ? (cachedGh = override) : null
  for (const candidate of ['/opt/homebrew/bin/gh', '/usr/local/bin/gh', '/usr/bin/gh']) {
    if (fileExists(candidate)) return (cachedGh = candidate)
  }
  return null
}

/** github.com or a *.github.com host (GHE Cloud). gh + the ssh hint apply. */
function isGithubHost(host: string): boolean {
  return host === 'github.com' || host.endsWith('.github.com')
}

/**
 * Per-clone git config that lets git ask gh for credentials on this URL's
 * host — scoped to the single command, keychain still tried first, public
 * repos unaffected. Empty when the URL isn't https or gh isn't installed.
 */
export function githubHelperArgs(url: string, gh: string | null): string[] {
  if (!gh) return []
  let host: string
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:') return []
    host = parsed.hostname
  } catch {
    return [] // scp-like (git@host:path) and non-URLs: no https credential context
  }
  // Registered for any https host on purpose — this also covers self-hosted
  // GitHub Enterprise, whose domain we can't enumerate. gh answers ONLY for
  // hosts it is signed in to; for every other host it returns nothing and git
  // falls through to its normal credential path (keychain, then fail). The
  // token never reaches Shelf — git talks to gh over the helper's own pipe.
  return ['-c', `credential.https://${host}.helper=!${gh} auth git-credential`]
}

/** SSH form of an https repo URL (github-family), for the "use SSH" hint. */
export function sshUrlForHttps(url: string): string | null {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' || !isGithubHost(parsed.hostname)) return null
    const repoPath = parsed.pathname.replace(/^\/+/, '')
    if (!repoPath) return null
    return `git@${parsed.hostname}:${repoPath}`
  } catch {
    return null
  }
}

export type CloneFailureKind = 'auth' | 'not_found' | 'ssh_auth' | 'other'

/** Classify git clone/fetch stderr into an actionable class. */
export function classifyCloneFailure(text: string): CloneFailureKind {
  const t = text.toLowerCase()
  if (/host key verification failed|permission denied \(publickey\)/.test(t)) return 'ssh_auth'
  if (/could not read username|authentication failed|terminal prompts disabled|invalid username or password|\b403\b/.test(t)) {
    return 'auth'
  }
  if (/repository not found|remote:\s*not found|does not (?:exist|appear to be a git)|\b404\b|not found/.test(t)) {
    return 'not_found'
  }
  return 'other'
}

/**
 * Turn a failed clone into a ShareError whose message tells the receiver what
 * to actually do — sign git in, use SSH, or take a bundle — instead of
 * surfacing git's plumbing text.
 */
export function cloneFailure(url: string, run: GitRun): ShareError {
  const kind = classifyCloneFailure(`${run.stderr}\n${run.stdout}`)
  const ssh = sshUrlForHttps(url)
  let host = 'the server'
  try {
    host = new URL(url).hostname
  } catch {
    /* scp-like url; leave generic */
  }
  const github = /^https:/.test(url) && isGithubHost(host)

  if (kind === 'auth') {
    const paths = [
      github ? 'sign git in to GitHub' : `sign git in to ${host} (set up a credential helper or token)`,
      ssh ? `use the SSH address ${ssh}` : 'use an SSH address',
      'or use Add from bundle below',
    ]
    return new ShareError(
      'auth_required',
      `This looks like a private repository, and git on this Mac isn’t signed in to ${host}. ${capitalize(paths[0])}, ${paths[1]}, ${paths[2]}.`,
      github
        ? 'Shelf clones with your own git credentials and can’t ask for a password in a dialog. Sign git in to GitHub once and try Fetch again.'
        : 'Shelf clones with your own git credentials and can’t ask for a password in a dialog.',
      github ? 'gh auth login && gh auth setup-git' : undefined,
    )
  }
  if (kind === 'not_found') {
    return new ShareError(
      'repo_not_found',
      `Shelf couldn’t find that repository on ${host}. Check the URL is right and that you have access — a private repo you’re not a member of looks the same as one that doesn’t exist.`,
      'If it’s private, ask the owner to add you, or have them send a bundle (.zip) instead.',
    )
  }
  if (kind === 'ssh_auth') {
    return new ShareError(
      'auth_required',
      `git couldn’t authenticate to ${host} over SSH. Make sure your SSH key is added to your account, or use Add from bundle below.`,
      undefined,
    )
  }
  return new ShareError('clone_failed', `Couldn’t fetch that repository: ${gitFailure(run, 'git clone failed')}`)
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export function runGit(git: string, args: string[], opts: { cwd?: string; timeoutMs?: number } = {}): Promise<GitRun> {
  return new Promise((resolve) => {
    execFile(
      git,
      args,
      {
        cwd: opts.cwd,
        timeout: opts.timeoutMs ?? 60_000,
        maxBuffer: 8 * 1024 * 1024,
        env: {
          ...process.env,
          // Never hang on a credential prompt — fail and tell the user.
          GIT_TERMINAL_PROMPT: '0',
          GIT_ASKPASS: '',
          SSH_ASKPASS: '',
          // Belt and braces on top of the URL allow-list.
          GIT_ALLOW_PROTOCOL: 'https:ssh:git',
          LC_ALL: 'C',
        },
      },
      (err, stdout, stderr) => {
        const code = err && typeof (err as { code?: unknown }).code === 'number'
          ? ((err as { code: number }).code)
          : err
            ? null
            : 0
        resolve({
          ok: !err,
          code,
          stdout: String(stdout || ''),
          stderr: String(stderr || ''),
        })
      },
    )
  })
}

export function gitFailure(run: GitRun, fallback: string): string {
  const text = `${run.stderr}\n${run.stdout}`.trim()
  if (!text) return fallback
  // Last meaningful line is usually the reason ("fatal: …").
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
  const fatal = lines.reverse().find((l) => /^(fatal|error):/i.test(l)) || lines[0]
  return fatal ? fatal.replace(/^(fatal|error):\s*/i, '') : fallback
}

/**
 * Allow-list a clone URL. https://, ssh://, git://, and scp-like
 * `user@host:path` only — no file://, no ext::, no local paths, nothing
 * starting with `-`. Returns the trimmed URL.
 */
export function validateRepoUrl(raw: string): { ok: true; url: string } | { ok: false; reason: string } {
  const url = (raw || '').trim()
  if (!url) return { ok: false, reason: 'Paste a repository URL.' }
  if (url.length > 2048) return { ok: false, reason: 'That URL is too long.' }
  if (/[\s\u0000-\u001f\u007f]/.test(url)) return { ok: false, reason: 'That URL contains whitespace or control characters.' }
  if (url.startsWith('-')) return { ok: false, reason: 'That URL is not a repository address.' }
  if (/^(https|ssh|git):\/\//i.test(url)) {
    try {
      const parsed = new URL(url)
      if (!parsed.hostname) return { ok: false, reason: 'That URL has no host.' }
      // git refuses `-`-led hosts itself (CVE-2017-1000117), but never hand
      // it something that could read as an ssh flag in the first place.
      if (parsed.hostname.startsWith('-') || parsed.username.startsWith('-')) {
        return { ok: false, reason: 'That URL is not a repository address.' }
      }
      if (parsed.search || parsed.hash || (parsed.protocol === 'https:' && parsed.username)) {
        return { ok: false, reason: 'Remove credentials, query parameters, and fragments from the repository URL.' }
      }
      if (parsed.password) return { ok: false, reason: 'Remove the password from the URL; Shelf never stores credentials.' }
      return { ok: true, url }
    } catch {
      return { ok: false, reason: 'That URL is not valid.' }
    }
  }
  // scp-like: git@github.com:org/repo.git
  if (/^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+:[A-Za-z0-9._\-/~]+$/.test(url)) {
    return { ok: true, url }
  }
  return {
    ok: false,
    reason: 'Shelf accepts https://, ssh://, git://, or git@host:path repository URLs.',
  }
}

export function buildShareLink(repoUrl: string): string {
  return `shelf://add?repo=${encodeURIComponent(repoUrl)}`
}

/** `origin` (or the first remote's) URL of a project, or null (not a repo / no remote). */
export async function detectGitRemote(projectPath: string): Promise<string | null> {
  const git = await resolveGitBinary()
  if (!git) return null
  const origin = await runGit(git, ['-C', projectPath, 'remote', 'get-url', 'origin'], { timeoutMs: 10_000 })
  if (origin.ok && origin.stdout.trim()) return origin.stdout.trim()
  const remotes = await runGit(git, ['-C', projectPath, 'remote'], { timeoutMs: 10_000 })
  const first = remotes.ok ? remotes.stdout.split('\n').map((l) => l.trim()).find(Boolean) : undefined
  if (!first) return null
  const run = await runGit(git, ['-C', projectPath, 'remote', 'get-url', first], { timeoutMs: 10_000 })
  return run.ok && run.stdout.trim() ? run.stdout.trim() : null
}

/** Repo root containing `projectPath` (realpath), or null when not in a repo. */
export async function repoToplevel(projectPath: string): Promise<string | null> {
  const git = await resolveGitBinary()
  if (!git) return null
  const run = await runGit(git, ['-C', projectPath, 'rev-parse', '--show-toplevel'], { timeoutMs: 10_000 })
  if (!run.ok || !run.stdout.trim()) return null
  try {
    return fs.realpathSync(run.stdout.trim())
  } catch {
    return null
  }
}

export async function currentCommit(git: string, projectPath: string): Promise<string | undefined> {
  const run = await runGit(git, ['-C', projectPath, 'rev-parse', 'HEAD'], { timeoutMs: 10_000 })
  return run.ok ? run.stdout.trim() || undefined : undefined
}
