import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { extractArchive } from './archive-tasks'
import type { ShareSource, StagedShare } from './contracts'
import { resolveShelfDataRoot } from './paths'
import { detectBootstrapNeeds } from './project-bootstrap'
import {
  folderNameFor,
  MANIFEST_FILENAME,
  readManifest,
  type ToolManifest
} from './tool-manifest'
import { ShareError } from './tool-share-errors'
import {
  cloneFailure,
  currentCommit,
  fileExists,
  githubHelperArgs,
  requireGit,
  resolveGhBinary,
  runGit,
  validateRepoUrl,
} from './tool-share-git'
import { defaultToolsRoot, stagingRoot, uniqueDestination } from './tool-share-paths'

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

/**
 * Fetch a shared tool into a scratch folder and describe it for the consent
 * sheet. Runs nothing from the manifest. Throws ShareError on failure and
 * cleans its own scratch folder.
 */
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
        extracted = await extractArchive(source.bundlePath, stagePath)
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

/** Throw away a staged add (cancel). Only ever removes inside the staging root. */
export function discardStagedShare(stage: Pick<StagedShare, 'stageId'>, dataRoot?: string): void {
  const root = stagingRoot(dataRoot || resolveShelfDataRoot())
  const target = path.join(root, stage.stageId)
  if (!target.startsWith(root + path.sep)) return
  fs.rmSync(target, { recursive: true, force: true })
}
