import fs from 'node:fs'
import { prepareArchive } from './archive-tasks'
import {
  buildManifest,
  readManifest,
  writeManifest,
  type ToolManifest
} from './tool-manifest'
import { ShareError } from './tool-share-errors'
import { buildShareLink, detectGitRemote, repoToplevel } from './tool-share-git'
import { sameDir } from './tool-share-paths'
import type { Tool } from './types'

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

/** Freeze a bundle before review, so export writes exactly the reviewed bytes. */
export async function prepareToolBundle(tool: Tool, opts: { appVersion: string }): Promise<{
  zip: Buffer; manifestPath: string; files: { name: string; bytes: number }[]
}> {
  const exported = await exportToolManifest(tool, opts)
  const { zip, files } = await prepareArchive(tool.projectPath as string)
  return { zip, manifestPath: exported.manifestPath, files }
}

/** Manifest export + zip of reviewed source files. */
export async function exportToolBundle(
  tool: Tool,
  outFile: string,
  opts: { appVersion: string },
): Promise<{ bundlePath: string; manifestPath: string; bytes: number }> {
  const prepared = await prepareToolBundle(tool, opts)
  fs.writeFileSync(outFile, prepared.zip, { mode: 0o600 })
  return { bundlePath: outFile, manifestPath: prepared.manifestPath, bytes: prepared.zip.length }
}
