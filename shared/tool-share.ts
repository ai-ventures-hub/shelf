/**
 * Tool Sharing (1.2) engine — send, receive (staged + consented), updates.
 *
 * Send:    exportToolManifest / exportToolBundle / buildShareLink
 * Receive: stageSharedTool → (consent sheet in the GUI) → confirmStagedShare
 *          or discardStagedShare. Staging clones/unzips into a scratch dir
 *          so the consent sheet can show real contents; NOTHING from the
 *          manifest executes or persists until confirm.
 * Update:  checkToolUpdates (fetch + summary only) → applyToolUpdate
 *          (user-confirmed fast-forward, or take-theirs on a diverged copy).
 *
 * git is the system binary (Apple CLT or Homebrew); a missing git is a
 * structured `git_missing` result with the same remedy shape launches use
 * for runtime_missing. Repo URLs are allow-listed (https/ssh/git/scp-like)
 * and always passed after `--` so a crafted value can never become a flag.
 */
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { LibraryStore } from './library-store'
import { resolveShelfDataRoot } from './paths'
import type { ProcessManager } from './process-manager'
import { urlForPort, withForcedPort } from './ports'
import { detectBootstrapNeeds, runBootstrap, type BootstrapStep } from './project-bootstrap'
import { registerProject, type RegisterProjectOptions, type RegisterProjectResult } from './register-project'
import {
  buildManifest,
  diffManifests,
  MANIFEST_FILENAME,
  normalizeManifest,
  readManifest,
  writeManifest,
  folderNameFor,
  type ManifestFieldDiff,
  type ToolManifest,
} from './tool-manifest'
import type { Tool, ToolSource } from './types'
import { bundleFolder, extractZip } from './zip'

export type ShareErrorCode =
  | 'git_missing'
  | 'invalid_repo'
  | 'clone_failed'
  | 'auth_required'
  | 'repo_not_found'
  | 'bundle_invalid'
  | 'manifest_invalid'
  | 'destination_invalid'
  | 'stage_missing'
  | 'export_refused'
  | 'folder_missing'
  // Catalog paths (v1.4). They share ShareError so the GUI's existing
  // remedy rendering (prose + one-click command) works unchanged.
  | 'catalog_invalid'
  | 'catalog_missing'
  | 'catalog_unpushed'
  | 'push_failed'

/** IPC-safe failure shape (a thrown ShareError loses code/remedy over IPC). */
export interface ShareFailure {
  ok: false
  code: ShareErrorCode | 'unknown'
  message: string
  /** Plain-language fix (prose). */
  remedy?: string
  /** A shell command the fix needs, offered as a one-click copy in the UI. */
  remedyCommand?: string
}

export class ShareError extends Error {
  code: ShareErrorCode
  /** Plain-language fix, when one exists (e.g. how to install git). */
  remedy?: string
  /** A shell command the fix needs, offered as a one-click copy in the UI. */
  remedyCommand?: string
  constructor(code: ShareErrorCode, message: string, remedy?: string, remedyCommand?: string) {
    super(message)
    this.code = code
    this.remedy = remedy
    this.remedyCommand = remedyCommand
  }
}

export const GIT_MISSING_REMEDY =
  'Install Apple’s Command Line Tools: open Terminal, run `xcode-select --install`, finish the installer, then try again.'

/** Default destination parent for received tools. */
export function defaultToolsRoot(): string {
  const override = process.env.SHELF_TOOLS_ROOT?.trim()
  if (override) return path.resolve(override)
  return path.join(os.homedir(), 'Shelf Tools')
}

/** Scratch area for staged (not yet approved) adds. */
export function stagingRoot(dataRoot = resolveShelfDataRoot()): string {
  return path.join(dataRoot, 'staging')
}

/** Remove leftovers from adds that never reached confirm/discard (app start). */
export function cleanStagingRoot(dataRoot = resolveShelfDataRoot()): void {
  try {
    fs.rmSync(stagingRoot(dataRoot), { recursive: true, force: true })
  } catch {
    // best-effort
  }
}

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

function fileExists(p: string): boolean {
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
async function repoToplevel(projectPath: string): Promise<string | null> {
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

function sameDir(a: string, b: string): boolean {
  try {
    return fs.realpathSync(a) === fs.realpathSync(b)
  } catch {
    return false
  }
}

async function currentCommit(git: string, projectPath: string): Promise<string | undefined> {
  const run = await runGit(git, ['-C', projectPath, 'rev-parse', 'HEAD'], { timeoutMs: 10_000 })
  return run.ok ? run.stdout.trim() || undefined : undefined
}

// ---------------------------------------------------------------------------
// Send
// ---------------------------------------------------------------------------

export interface ExportManifestResult {
  manifestPath: string
  manifest: ToolManifest
  /** Present when the project has a git remote AND is the repo root. */
  remote?: string
  /** `shelf://add?repo=…` when `remote` is present. */
  link?: string
  /** Why there is no link, when the project is in git but unshareable by link. */
  linkNote?: string
}

/**
 * Write/update `<project>/shelf.json` for a tool (env values stripped) and
 * compute the share link. Throws ShareError('export_refused') when a
 * free-text field looks like a credential.
 */
export async function exportToolManifest(
  tool: Tool,
  opts: { appVersion: string },
): Promise<ExportManifestResult> {
  if (!tool.projectPath || !fs.existsSync(tool.projectPath)) {
    throw new ShareError(
      'folder_missing',
      'This tool has no project folder to share. Set one in Edit first.',
    )
  }
  let previous: ToolManifest | null = null
  try {
    previous = readManifest(tool.projectPath)?.manifest || null
  } catch (err) {
    // Hand-authored bootstrap/hints live only in this file — never
    // silently overwrite one the author got slightly wrong.
    throw new ShareError(
      'export_refused',
      `The existing shelf.json can't be read (${err instanceof Error ? err.message : String(err)}) Fix or delete it, then share again.`,
    )
  }
  const built = buildManifest(tool, { appVersion: opts.appVersion, previous })
  if (!built.ok) throw new ShareError('export_refused', built.reason)
  const manifestPath = writeManifest(tool.projectPath, built.manifest)
  // A link clones the repo ROOT; the manifest lives in the tool's folder.
  // Those must be the same place or the receiver gets the wrong project.
  const toplevel = await repoToplevel(tool.projectPath)
  if (toplevel && !sameDir(toplevel, tool.projectPath)) {
    return {
      manifestPath,
      manifest: built.manifest,
      linkNote:
        'This tool lives in a subfolder of its git repository, so a link would clone the wrong folder. Share it as a bundle, or give the tool its own repository.',
    }
  }
  const remote = await detectGitRemote(tool.projectPath)
  return {
    manifestPath,
    manifest: built.manifest,
    remote: remote || undefined,
    link: remote ? buildShareLink(remote) : undefined,
  }
}

/** Manifest export + zip of the project (node_modules/.git/.env* excluded). */
export async function exportToolBundle(
  tool: Tool,
  outFile: string,
  opts: { appVersion: string },
): Promise<{ bundlePath: string; manifestPath: string; bytes: number }> {
  const exported = await exportToolManifest(tool, opts)
  const zip = bundleFolder(tool.projectPath as string)
  fs.writeFileSync(outFile, zip)
  return { bundlePath: outFile, manifestPath: exported.manifestPath, bytes: zip.length }
}

// ---------------------------------------------------------------------------
// Receive (staged)
// ---------------------------------------------------------------------------

export type ShareSource =
  | { kind: 'git'; repo: string }
  | { kind: 'bundle'; bundlePath: string }

export interface StagedShare {
  stageId: string
  /** Where the fetched files currently live (scratch). */
  stagePath: string
  source: ShareSource
  manifestFound: boolean
  manifest: ToolManifest
  warnings: string[]
  /** Proposed destination; the user may change the parent folder. */
  destination: string
  /** Exactly the setup commands that will run on approval, in order. */
  setupSteps: BootstrapStep[]
  /** Commit sha at fetch time (git sources). */
  ref?: string
}

export function uniqueDestination(
  parent: string,
  folderName: string,
  isTaken: (destination: string) => boolean = () => false,
): string {
  let candidate = path.join(parent, folderName)
  let n = 2
  while (fs.existsSync(candidate) || isTaken(candidate)) {
    candidate = path.join(parent, `${folderName}-${n}`)
    n += 1
    if (n > 500) throw new ShareError('destination_invalid', 'Could not find a free folder name.')
  }
  return candidate
}

/**
 * Fetch a shared tool into a scratch folder and describe it for the consent
 * sheet. Runs nothing from the manifest. Throws ShareError on failure and
 * cleans its own scratch folder.
 */
/** Working-tree bytes allowed for a fetched project (clone or bundle). */
export const MAX_STAGED_BYTES = 2 * 1024 * 1024 * 1024

/**
 * Walk a staged tree (skipping .git): total bytes, and any symlink whose
 * target resolves outside the tree — a cloned repo may track symlinks that a
 * consented setup step would then follow.
 */
function auditStagedTree(root: string): { bytes: number; escapingLinks: string[]; hasGitDir: boolean } {
  // Walk the REALPATH: on macOS the data root is under /var → /private/var,
  // so a relative internal symlink resolved against the unresolved `root`
  // would look like it escapes when it does not. We never descend into
  // symlinked dirs, so every `dir` below is already a real path.
  const rootReal = fs.realpathSync(root)
  let bytes = 0
  let hasGitDir = false
  const escapingLinks: string[] = []
  const walk = (dir: string) => {
    for (const dirent of fs.readdirSync(dir, { withFileTypes: true })) {
      if (dirent.name.toLowerCase() === '.git') {
        hasGitDir = true
        continue
      }
      const abs = path.join(dir, dirent.name)
      if (dirent.isSymbolicLink()) {
        const target = path.resolve(dir, fs.readlinkSync(abs))
        if (target !== rootReal && !target.startsWith(rootReal + path.sep)) {
          escapingLinks.push(`${path.relative(rootReal, abs)} → ${fs.readlinkSync(abs)}`)
        }
        continue
      }
      if (dirent.isDirectory()) walk(abs)
      else if (dirent.isFile()) bytes += fs.statSync(abs).size
    }
  }
  walk(rootReal)
  return { bytes, escapingLinks, hasGitDir }
}

export async function stageSharedTool(
  source: ShareSource,
  opts: {
    dataRoot?: string
    toolsRoot?: string
    /** Paths the library already claims — never propose those as a destination. */
    isTaken?: (destination: string) => boolean
  } = {},
): Promise<StagedShare> {
  const dataRoot = opts.dataRoot || resolveShelfDataRoot()
  const toolsRoot = opts.toolsRoot || defaultToolsRoot()
  const stageId = randomUUID()
  const stagePath = path.join(stagingRoot(dataRoot), stageId)
  fs.mkdirSync(stagePath, { recursive: true })

  let ref: string | undefined
  try {
    if (source.kind === 'git') {
      const valid = validateRepoUrl(source.repo)
      if (!valid.ok) throw new ShareError('invalid_repo', valid.reason)
      source = { kind: 'git', repo: valid.url }
      const git = await requireGit()
      const gh = await resolveGhBinary()
      const clone = await runGit(
        git,
        [
          // Scoped config, never global: no ext/file transports, no hooks
          // path tricks from the clone itself (hooks are not cloned anyway).
          '-c', 'protocol.ext.allow=never',
          '-c', 'protocol.file.allow=never',
          '-c', 'core.hooksPath=/dev/null',
          // Borrow gh's GitHub auth for a private https clone (scoped here;
          // Shelf never sees the token). No-op for public repos / non-github.
          ...githubHelperArgs(valid.url, gh),
          'clone', '--quiet', '--', valid.url, stagePath,
        ],
        { timeoutMs: 180_000 },
      )
      if (!clone.ok) {
        throw cloneFailure(valid.url, clone)
      }
      ref = await currentCommit(git, stagePath)
    } else {
      if (!source.bundlePath || !fileExists(source.bundlePath)) {
        throw new ShareError('bundle_invalid', 'That bundle file does not exist.')
      }
      let extracted
      try {
        extracted = extractZip(source.bundlePath, stagePath)
      } catch (err) {
        throw new ShareError(
          'bundle_invalid',
          `Couldn’t open that bundle: ${err instanceof Error ? err.message : String(err)}`,
        )
      }
      if (extracted.files === 0) {
        throw new ShareError('bundle_invalid', 'That bundle is empty.')
      }
    }

    // A bundle/repo that wraps everything in one top-level folder: descend.
    const projectRoot = unwrapSingleFolder(stagePath)

    const audit = auditStagedTree(projectRoot)
    // A git clone legitimately has a `.git` (its own metadata, needed for
    // updates). A BUNDLE must not: isSafeZipPath already refuses `.git`
    // entries, and this is belt-and-braces over a wrapper folder that
    // smuggled one — git would run its config the next time the user opens
    // the folder. existsSync is case-folded on APFS, catching `.GIT`.
    if (source.kind === 'bundle' && (audit.hasGitDir || fs.existsSync(path.join(projectRoot, '.git')))) {
      throw new ShareError(
        'bundle_invalid',
        'That bundle contains an embedded .git directory; Shelf won’t add it.',
      )
    }
    if (audit.bytes > MAX_STAGED_BYTES) {
      throw new ShareError(
        source.kind === 'git' ? 'clone_failed' : 'bundle_invalid',
        `That project is larger than ${Math.round(MAX_STAGED_BYTES / (1024 * 1024 * 1024))} GB; Shelf won't add it.`,
      )
    }
    if (audit.escapingLinks.length > 0) {
      throw new ShareError(
        source.kind === 'git' ? 'clone_failed' : 'bundle_invalid',
        `That project contains a symlink pointing outside its folder (${audit.escapingLinks[0]}); Shelf won't add it.`,
      )
    }

    let manifestFound = false
    let manifest: ToolManifest
    let warnings: string[] = []
    try {
      const read = readManifest(projectRoot)
      if (read) {
        manifestFound = true
        manifest = read.manifest
        warnings = read.warnings
      } else {
        manifest = emptyManifest()
        warnings = [
          `No ${MANIFEST_FILENAME} found. Shelf will detect the launch command from the project instead.`,
        ]
      }
    } catch (err) {
      throw new ShareError(
        'manifest_invalid',
        err instanceof Error ? err.message : String(err),
      )
    }

    const fallbackName =
      source.kind === 'git'
        ? path.basename(source.repo.replace(/\/+$/, '')).replace(/\.git$/i, '')
        : path.basename(source.bundlePath).replace(/\.zip$/i, '')
    const name = manifest.name || fallbackName || 'Shared tool'
    manifest = { ...manifest, name }

    // What will run on approval: the manifest's declared setup, verbatim,
    // plus detected needs the manifest did not mention (dedupe by command).
    const declared = manifest.bootstrap.map((command) => ({
      command,
      label: 'Setup step from the shared manifest',
    }))
    const detected = detectBootstrapNeeds(projectRoot).filter(
      (step) => !declared.some((d) => d.command.trim() === step.command.trim()),
    )
    const setupSteps = [...declared, ...detected]

    // Proposed only — the tools root itself is created at approve time.
    const destination = uniqueDestination(toolsRoot, folderNameFor(name), opts.isTaken)

    return {
      stageId,
      stagePath: projectRoot,
      source,
      manifestFound,
      manifest,
      warnings,
      destination,
      setupSteps,
      ref,
    }
  } catch (err) {
    fs.rmSync(path.join(stagingRoot(dataRoot), stageId), { recursive: true, force: true })
    throw err
  }
}

function emptyManifest(): ToolManifest {
  return {
    shelfManifest: 1,
    name: '',
    launchCommand: '',
    tags: [],
    capabilities: [],
    agentAccess: [],
    bootstrap: [],
    env: {},
  }
}

/** If the stage holds exactly one directory and nothing else, use it as the project root. */
function unwrapSingleFolder(stagePath: string): string {
  const entries = fs.readdirSync(stagePath, { withFileTypes: true }).filter(
    (d) => d.name !== '.DS_Store' && d.name !== '__MACOSX',
  )
  if (entries.length === 1 && entries[0].isDirectory() && entries[0].name !== '.git') {
    return path.join(stagePath, entries[0].name)
  }
  return stagePath
}

/** Validate a destination chosen on the sheet: absolute, not yet existing (or empty), outside the stage. */
export function validateDestination(
  destination: string,
  stage: Pick<StagedShare, 'stagePath'>,
): { ok: true; destination: string } | { ok: false; reason: string } {
  const resolved = path.resolve(destination.trim())
  if (!path.isAbsolute(resolved) || resolved === path.parse(resolved).root) {
    return { ok: false, reason: 'Choose a folder on this Mac (not the root of a disk).' }
  }
  const stageRoot = path.resolve(stage.stagePath)
  if (resolved === stageRoot || resolved.startsWith(stageRoot + path.sep)) {
    return { ok: false, reason: 'That folder is Shelf’s scratch area.' }
  }
  if (fs.existsSync(resolved)) {
    try {
      const stat = fs.lstatSync(resolved)
      if (stat.isSymbolicLink()) return { ok: false, reason: 'That path is a symlink; choose a real folder.' }
      if (!stat.isDirectory()) return { ok: false, reason: 'That path is a file, not a folder.' }
      if (fs.readdirSync(resolved).length > 0) {
        return { ok: false, reason: 'That folder already has files in it — pick an empty or new folder.' }
      }
    } catch {
      return { ok: false, reason: 'That folder cannot be used.' }
    }
  }
  return { ok: true, destination: resolved }
}

export interface ConfirmShareInput {
  /** Final destination (validated here). */
  destination: string
  /** User-typed env values, keyed by manifest env key. Empty values are dropped. */
  env: Record<string, string>
  /** Run `stage.setupSteps` — the user saw them; this is the consent. */
  runSetup: boolean
  /** Launch after saving (default true). */
  launch?: boolean
}

export interface ConfirmShareResult extends RegisterProjectResult {
  destination: string
}

/**
 * The approval: move the staged files to the destination, then run the
 * existing register pipeline seeded from the manifest with the user's env
 * values and consented setup steps. Records provenance on the saved tool.
 */
export async function confirmStagedShare(
  stage: StagedShare,
  input: ConfirmShareInput,
  deps: {
    store: LibraryStore
    processes: ProcessManager
    toolDefaults?: RegisterProjectOptions['toolDefaults']
    dataRoot?: string
  },
): Promise<ConfirmShareResult> {
  const valid = validateDestination(input.destination, stage)
  if (!valid.ok) throw new ShareError('destination_invalid', valid.reason)
  const destination = valid.destination
  // A stale library entry at this path would make registerProject MERGE
  // into it and drop the manifest + typed env values on the floor.
  const claimed = deps.store.findByProjectPath(destination)
  if (claimed) {
    throw new ShareError(
      'destination_invalid',
      `“${claimed.name}” in your library already points at that folder. Remove it first, or choose another folder.`,
    )
  }
  if (!fs.existsSync(stage.stagePath)) {
    throw new ShareError('stage_missing', 'The fetched files are gone. Fetch again.')
  }

  // A destination that turned unusable between validation and now (no
  // permission, a symlink, a race) is a folder problem — keep the stage
  // alive so the user can pick another folder, not a lost fetch.
  try {
    fs.mkdirSync(path.dirname(destination), { recursive: true })
    if (fs.existsSync(destination)) fs.rmdirSync(destination) // validated empty
    moveDir(stage.stagePath, destination)
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code && ['EACCES', 'EPERM', 'ENOTDIR', 'EEXIST', 'ENOENT', 'EROFS'].includes(code)) {
      throw new ShareError('destination_invalid', `Shelf couldn’t write to that folder (${code}). Choose another.`)
    }
    throw err
  }
  // Stage wrapper (when the project was nested one level) goes with it.
  fs.rmSync(path.join(stagingRoot(deps.dataRoot || resolveShelfDataRoot()), stage.stageId), {
    recursive: true,
    force: true,
  })

  const env: Record<string, string> = {}
  for (const key of Object.keys(stage.manifest.env)) {
    if (key === 'PORT') continue // tool.port governs; the launch path sets PORT itself
    const value = typeof input.env?.[key] === 'string' ? input.env[key] : ''
    if (value.trim()) env[key] = value
  }

  const now = new Date().toISOString()
  const source: ToolSource =
    stage.source.kind === 'git'
      ? { kind: 'git', repo: stage.source.repo, ref: stage.ref, addedAt: now }
      : { kind: 'bundle', addedAt: now }

  const result = await registerProject(
    destination,
    { store: deps.store, processes: deps.processes },
    {
      autoLaunch: input.launch ?? true,
      onPortConflict: 'reassign',
      runSetup: input.runSetup,
      setupSteps: stage.setupSteps,
      toolDefaults: deps.toolDefaults,
      overrides: {
        name: stage.manifest.name || undefined,
        description: stage.manifest.description,
        launchCommand: stage.manifest.launchCommand || undefined,
        port: stage.manifest.port,
        url: stage.manifest.url,
        tags: stage.manifest.tags,
        capabilities: stage.manifest.capabilities,
        agentAccess: stage.manifest.agentAccess,
        notes: stage.manifest.notes,
        env: Object.keys(env).length ? env : undefined,
      },
      source,
    },
  )
  return { ...result, destination }
}

/** Throw away a staged add (cancel). Only ever removes inside the staging root. */
export function discardStagedShare(stage: Pick<StagedShare, 'stageId'>, dataRoot?: string): void {
  const root = stagingRoot(dataRoot || resolveShelfDataRoot())
  const target = path.join(root, stage.stageId)
  if (!target.startsWith(root + path.sep)) return
  fs.rmSync(target, { recursive: true, force: true })
}

function moveDir(from: string, to: string): void {
  try {
    fs.renameSync(from, to)
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code !== 'EXDEV') throw err
    fs.cpSync(from, to, { recursive: true, verbatimSymlinks: true })
    fs.rmSync(from, { recursive: true, force: true })
  }
}

// ---------------------------------------------------------------------------
// Updates
// ---------------------------------------------------------------------------

export interface UpdateCommit {
  sha: string
  subject: string
}

export type UpdateCheck =
  | { state: 'not_shared' }
  | { state: 'folder_missing' }
  | { state: 'git_missing'; message: string; remedy: string }
  | { state: 'not_git' }
  | { state: 'no_remote' }
  | { state: 'no_target_branch'; remote: string }
  | { state: 'fetch_failed'; message: string }
  | { state: 'up_to_date'; ref: string; remote: string; dirty: boolean }
  | {
      state: 'updates_available'
      ref: string
      remoteRef: string
      target: string
      behind: number
      commits: UpdateCommit[]
      manifestDiff: ManifestFieldDiff[]
      /**
       * Setup commands to offer after updating: ones the incoming manifest
       * adds, plus every declared step when dependency files changed.
       */
      newBootstrap: string[]
      /** Dependency manifests (package.json, lockfiles, requirements…) changed. */
      depsChanged: boolean
      /** Env keys the incoming manifest adds (values still needed). */
      newEnvKeys: string[]
      remote: string
    }
  | {
      state: 'diverged'
      ref: string
      remoteRef: string
      target: string
      ahead: number
      behind: number
      dirty: boolean
      commits: UpdateCommit[]
      manifestDiff: ManifestFieldDiff[]
      newBootstrap: string[]
      depsChanged: boolean
      newEnvKeys: string[]
      remote: string
    }

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

function localManifest(projectPath: string): ToolManifest | null {
  try {
    return readManifest(projectPath)?.manifest || null
  } catch {
    return null
  }
}

/** Fetch and summarize. Touches nothing in the working tree. */
export async function checkToolUpdates(tool: Tool): Promise<UpdateCheck> {
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

  if (ahead > 0 || dirty) {
    return {
      state: 'diverged',
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
function detectedInstall(cwd: string): string[] {
  // Detection keys off a missing node_modules/.venv; for an existing install
  // we want the manager's install command regardless, so probe lockfiles.
  const has = (rel: string) => fs.existsSync(path.join(cwd, rel))
  const steps: string[] = []
  if (has('package.json')) {
    const manager = has('pnpm-lock.yaml') ? 'pnpm' : has('yarn.lock') ? 'yarn' : has('bun.lockb') || has('bun.lock') ? 'bun' : 'npm'
    steps.push(`${manager} install`)
  }
  if (has('requirements.txt')) {
    steps.push(has('.venv') ? '.venv/bin/pip install -r requirements.txt' : 'python3 -m venv .venv && .venv/bin/pip install -r requirements.txt')
  }
  return steps
}

export interface ApplyUpdateInput {
  /** 'fast_forward' for a clean copy; 'take_theirs' discards local commits/changes. */
  mode: 'fast_forward' | 'take_theirs'
  /** Remote target shown on the sheet (e.g. origin/main). */
  target: string
  /** Consent to run `setupCommands` after pulling (exactly what was shown). */
  runSetup?: boolean
  setupCommands?: string[]
}

export interface ApplyUpdateResult {
  ok: boolean
  message: string
  tool?: Tool
  ref?: string
  /** Fields changed on the tool from the new manifest. */
  applied: string[]
  /** Manifest changes NOT applied because the local value differs (local edits win). */
  skipped: { field: string; reason: string }[]
  /** Env keys the new manifest needs that still have no value. */
  missingEnvKeys: string[]
  setup?: { command: string; ok: boolean }[]
  /** The tool was running when the files changed — it needs a restart to pick them up. */
  running: boolean
}

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
  const cwd = tool.projectPath
  if (!cwd || !fs.existsSync(cwd)) {
    return { ok: false, message: 'Project folder is missing.', applied: [], skipped: [], missingEnvKeys: [], running: false }
  }
  // Target is a ref name we produced (origin/main); reject anything that
  // could read as a flag or a path spec since it goes on the git command line.
  if (!/^[A-Za-z0-9][A-Za-z0-9._\-/]*$/.test(input.target) || input.target.includes('..')) {
    return { ok: false, message: 'Invalid update target.', applied: [], skipped: [], missingEnvKeys: [], running: false }
  }
  const git = await resolveGitBinary()
  if (!git) return { ok: false, message: GIT_MISSING_REMEDY, applied: [], skipped: [], missingEnvKeys: [], running: false }

  const before = localManifest(cwd)
  // Detection can change across the pull (a lockfile swap). Allow what the
  // check could have offered from EITHER side, so a ticked box is honoured.
  const preInstall = detectedInstall(cwd)
  const runningState = deps.processes ? await deps.processes.getState(tool.id) : undefined
  const running = runningState?.status === 'running' || runningState?.status === 'starting'
  const pull =
    input.mode === 'take_theirs'
      ? await runGit(git, ['-C', cwd, 'reset', '--hard', input.target], { timeoutMs: 60_000 })
      : await runGit(git, ['-C', cwd, 'merge', '--ff-only', '--no-edit', input.target], { timeoutMs: 60_000 })
  if (!pull.ok) {
    return {
      ok: false,
      message: `Update failed: ${gitFailure(pull, 'git could not update the folder')}`,
      applied: [],
      skipped: [],
      missingEnvKeys: [],
      running,
    }
  }
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
  const saved = deps.store.save(next)

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
      deps.processes?.appendLog(saved.id, 'system', `Setup: ${command}`)
      const result = await runBootstrap(
        { command, label: 'Setup step from the shared manifest' },
        {
          cwd,
          onLog: (stream, text) => deps.processes?.appendLog(saved.id, stream, text),
        },
      )
      setup.push({ command, ok: result.ok })
      if (!result.ok) break
    }
  }

  return {
    ok: true,
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
