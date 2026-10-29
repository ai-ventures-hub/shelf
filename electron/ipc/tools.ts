import { dialog } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { deriveToolReadiness } from '../../shared/capability-intelligence'
import { containedDataUrl, ICON_MIME_TYPES } from '../../shared/contained-data-url'
import { resolveDesignMd } from '../../shared/design-md'
import { inspectProject } from '../../shared/project-import'
import { registerProject } from '../../shared/register-project'
import { inspectToolEnvironment } from '../../shared/tool-environment'
import { deriveLibraryHealth } from '../../shared/tool-health'
import type { IpcContext } from './context'
import { handle } from './typed'

/** Library tools: list, save, delete, import, icons, health, per-tool DESIGN.md. */
export function registerToolsIpc(ctx: IpcContext): void {
  const { store, processes, prefs, verification, projectMemory } = ctx

  handle('tools:list', () => store.list())
  handle('tools:recovery', () => store.recoveryNotice())
  handle('tools:save', (_e, tool) => {
    const saved = store.save(tool)
    // The remote-preview toggle takes effect without waiting for the file watcher.
    ctx.companion.syncPreviews()
    return saved
  })
  handle('tools:delete', async (_e, id) => {
    // Stop must complete AND succeed before the record goes: deleting first
    // would orphan a child that a failed stop left running, with nothing in
    // the library to represent it.
    const tool = store.get(id)
    const state = await processes.stop(id)
    await verification.stopTool(id)
    // Two error codes cannot orphan anything and must not block deletion:
    // stop_command_failed (stop script errored while nothing was observably
    // running) and stop_refused_not_owner (an UNRELATED process holds the
    // tool's port — Shelf rightly left it alone, and it isn't ours).
    if (
      state.status === 'error' &&
      state.code !== 'stop_command_failed' &&
      state.code !== 'stop_refused_not_owner'
    ) {
      throw new Error(
        `Could not stop “${tool?.name || id}”: ${state.message} The tool was not removed.`,
      )
    }
    store.delete(id)
    processes.forget(id)
    ctx.companion.syncPreviews()
    // History for a tool that no longer exists only grows; clear it. Best
    // effort: a cleanup failure must not undo a completed delete.
    try { verification.forgetTool(id) } catch { /* left for a later delete */ }
    try { projectMemory.forget(id) } catch { /* unreadable memory stays untouched */ }
  })
  handle('tools:readiness', (_e, id) => {
    const tool = store.get(id)
    if (!tool) throw new Error(`Tool not found: ${id}`)
    return deriveToolReadiness(tool)
  })
  // Launchability glyphs for library cards — one lsof call for all tools.
  handle('tools:health', async () =>
    deriveLibraryHealth(store.list(), processes.peekStates()),
  )
  handle('tools:environment', (_e, id) => {
    const tool = store.get(id)
    if (!tool) throw new Error('Tool not found.')
    return inspectToolEnvironment(tool)
  })

  handle('tools:pickFolder', async () => {
    const result = await dialog.showOpenDialog(ctx.getMainWindow()!, {
      properties: ['openDirectory', 'createDirectory'],
    })
    return result.canceled ? null : result.filePaths[0] || null
  })

  // Smart import: suggest launch/port/tags from a chosen project folder.
  handle('tools:inspectProject', (_e, projectPath) => inspectProject(projectPath))

  // One-shot register: inspect → save → (consented) setup → launch.
  // Consent flow is two calls: first without runSetup (may return
  // needs_setup), then again with runSetup: true after the user agrees.
  handle('tools:registerProject', (_e, projectPath, options) => {
    const uiPrefs = prefs.get()
    return registerProject(
      projectPath,
      { store, processes },
      {
        ...options,
        toolDefaults: {
          iconLucide: uiPrefs.defaultIconLucide,
          iconColor: uiPrefs.defaultIconColor,
          iconBackground: uiPrefs.defaultIconBackground,
        },
      },
    )
  })

  handle('tools:pickIcon', async () => {
    const result = await dialog.showOpenDialog(ctx.getMainWindow()!, {
      properties: ['openFile'],
      filters: [
        { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'icns'] },
      ],
    })
    if (result.canceled || !result.filePaths[0]) return null

    const src = result.filePaths[0]
    const ext = path.extname(src) || '.png'
    const dest = path.join(store.getIconsDir(), `${Date.now()}${ext}`)
    fs.copyFileSync(src, dest)
    return dest
  })

  // Same containment stance as designProfiles:assetDataUrl: this channel
  // reads ONLY inside the icons dir (realpath on both sides — a planted
  // symlink must not escape, and a symlinked data root must still match).
  handle('tools:iconDataUrl', (_e, iconPath) =>
    containedDataUrl(store.getIconsDir(), iconPath, ICON_MIME_TYPES),
  )

  handle('designMd:get', (_e, opts) => {
    const tool = opts.id ? store.get(opts.id) : undefined
    const projectPath = opts.projectPath || tool?.projectPath
    return resolveDesignMd(projectPath, tool?.id || opts.id)
  })
}
