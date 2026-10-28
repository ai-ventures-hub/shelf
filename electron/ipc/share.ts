import { app, clipboard, dialog } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { atomicWriteFileSync } from '../../shared/atomic-file'
import { firstCredentialField } from '../../shared/capability-intelligence'
import { prepareCatalogStarter, validateCatalogStarter } from '../../shared/catalog-starter'
import { finishImport, importMarker, pendingImportIds, readImport } from '../../shared/import-journal'
import type { CatalogEntry } from '../../shared/team-catalog'
import type { TeamCatalog } from '../../shared/team-catalog-store'
import {
  addCatalog,
  publishToCatalog,
  syncCatalog,
  type PublishResult,
} from '../../shared/team-catalog-sync'
import { folderNameFor } from '../../shared/tool-manifest'
import {
  applyToolUpdate,
  checkToolUpdates,
  confirmStagedShare,
  detectGitRemote,
  discardStagedShare,
  exportToolManifest,
  prepareToolBundle,
  ShareError,
  stageSharedTool,
  uniqueDestination,
  validateDestination,
  type ShareFailure,
  type StagedShare,
} from '../../shared/tool-share'
import type { IpcContext } from './context'
import { handle } from './typed'

/**
 * Tool Sharing (1.2) and Team Tools catalogs (1.4).
 *
 * A catalog is a git repo holding catalog.json. Shelf reads that one file
 * and nothing else out of it; installing an entry goes through the SAME
 * stage → consent sheet → confirm path a shelf:// link uses, so the sheet
 * stays the only thing that can authorize execution.
 */
export function registerShareIpc(ctx: IpcContext): void {
  const { store, processes, prefs, teamCatalogs } = ctx
  /** Staged (fetched, not yet approved) shared-tool adds, by stageId. */
  const stagedShares = new Map<string, StagedShare>()

  // Send: write shelf.json (env values structurally stripped) + share link.
  handle('share:exportManifest', async (_e, id) => {
    const tool = store.get(id)
    if (!tool) throw new Error(`Tool not found: ${id}`)
    const result = await exportToolManifest(tool, { appVersion: app.getVersion() })
    if (result.link) clipboard.writeText(result.link)
    return {
      manifestPath: result.manifestPath,
      remote: result.remote,
      link: result.link,
      linkNote: result.linkNote,
      copied: Boolean(result.link),
      envKeys: Object.keys(result.manifest.env),
    }
  })
  handle('share:exportBundle', async (_e, id) => {
    const tool = store.get(id)
    if (!tool) throw new Error(`Tool not found: ${id}`)
    const prepared = await prepareToolBundle(tool, { appVersion: app.getVersion() })
    const reviewOptions: Electron.MessageBoxOptions = {
      type: 'question', title: 'Review files to share',
      message: `Share ${prepared.files.length} files from ${tool.name}?`,
      detail: 'Only these files will be exported. Check for private data in source files. Git projects include tracked source plus shelf.json.\n\n' +
        prepared.files.map((file) => `${file.name} (${file.bytes} bytes)`).join('\n'),
      buttons: ['Cancel', 'Choose export location'], defaultId: 0, cancelId: 0,
    }
    const mainWindow = ctx.getMainWindow()
    const review = mainWindow ? await dialog.showMessageBox(mainWindow, reviewOptions) : await dialog.showMessageBox(reviewOptions)
    if (review.response !== 1) return { saved: false }
    const saveOpts: Electron.SaveDialogOptions = {
      title: 'Export tool bundle',
      defaultPath: `${folderNameFor(tool.name)}.zip`,
      filters: [{ name: 'Zip archive', extensions: ['zip'] }],
    }
    const result = mainWindow
      ? await dialog.showSaveDialog(mainWindow, saveOpts)
      : await dialog.showSaveDialog(saveOpts)
    if (result.canceled || !result.filePath) return { saved: false }
    fs.writeFileSync(result.filePath, prepared.zip, { mode: 0o600 })
    return { saved: true, path: result.filePath, bytes: prepared.zip.length }
  })
  // Receive: stage (clone/unzip into scratch; runs nothing, persists nothing).
  // ShareError carries code + remedy; IPC would flatten a thrown error to
  // its message, so these handlers return discriminated results instead.
  const shareFailure = (err: unknown): ShareFailure => ({
    ok: false,
    code: err instanceof ShareError ? err.code : 'unknown',
    message: err instanceof Error ? err.message : String(err),
    remedy: err instanceof ShareError ? err.remedy : undefined,
    remedyCommand: err instanceof ShareError ? err.remedyCommand : undefined,
  })
  handle('share:stage', async (_e, source) => {
    try {
      const stage = await stageSharedTool(source, {
        isTaken: (candidate) => Boolean(store.findByProjectPath(candidate)),
      })
      stagedShares.set(stage.stageId, stage)
      // The renderer gets the description only — stagePath stays in main.
      const { stagePath: _stagePath, ...description } = stage
      return { ok: true as const, stage: description }
    } catch (err) {
      return shareFailure(err)
    }
  })
  handle('share:pickBundle', async () => {
    const result = await dialog.showOpenDialog(ctx.getMainWindow()!, {
      title: 'Add from bundle',
      properties: ['openFile'],
      filters: [{ name: 'Shelf tool bundle', extensions: ['zip'] }],
    })
    return result.canceled ? null : result.filePaths[0] || null
  })
  // The user picks a PARENT folder; the sanitized manifest name is appended.
  handle('share:pickDestination', async (_e, stageId) => {
    const stage = stagedShares.get(stageId)
    if (!stage) {
      return shareFailure(new ShareError('stage_missing', 'The fetched files are gone. Fetch again.'))
    }
    const result = await dialog.showOpenDialog(ctx.getMainWindow()!, {
      title: 'Choose where to put this tool',
      properties: ['openDirectory', 'createDirectory'],
    })
    if (result.canceled || !result.filePaths[0]) return { ok: true as const, destination: null }
    // Re-derive the folder name under the new parent (the proposed one may
    // already carry a "-2" suffix from the default parent).
    const candidate = uniqueDestination(
      result.filePaths[0],
      folderNameFor(stage.manifest.name || path.basename(stage.destination)),
      (p) => Boolean(store.findByProjectPath(p)),
    )
    const valid = validateDestination(candidate, stage)
    if (!valid.ok) return shareFailure(new ShareError('destination_invalid', valid.reason))
    return { ok: true as const, destination: valid.destination }
  })
  // The approval. Everything executable happens after this call, never before.
  handle('share:confirm', async (_e, stageId, input) => {
    const stage = stagedShares.get(stageId)
    if (!stage) {
      return shareFailure(new ShareError('stage_missing', 'The fetched files are gone. Fetch again.'))
    }
    const uiPrefs = prefs.get()
    try {
      const result = await confirmStagedShare(stage, input, {
        store,
        processes,
        toolDefaults: {
          iconLucide: uiPrefs.defaultIconLucide,
          iconColor: uiPrefs.defaultIconColor,
          iconBackground: uiPrefs.defaultIconBackground,
        },
      })
      stagedShares.delete(stageId)
      return { ok: true as const, result }
    } catch (err) {
      // Destination problems keep the stage alive so the user can fix the
      // folder; partial moves remain recoverable from the import journal.
      if (!(err instanceof ShareError && (err.code === 'destination_invalid' || err.code === 'import_incomplete'))) {
        stagedShares.delete(stageId)
      }
      return shareFailure(err)
    }
  })
  handle('share:pendingImports', () => pendingImportIds(store.getRoot()).flatMap((id) => {
    const pending = readImport(store.getRoot(), id)
    if (!pending) return []
    if (store.findByProjectPath(pending.destination)) {
      finishImport(store.getRoot(), id)
      fs.rmSync(importMarker(pending.destination, id), { force: true })
      return []
    }
    return [{ id, name: pending.stage.manifest.name || 'Shared tool', destination: pending.destination }]
  }))
  handle('share:resumeImport', (_e, id) => {
    const pending = readImport(store.getRoot(), id)
    if (!pending) throw new Error('This import no longer needs recovery.')
    stagedShares.set(id, pending.stage)
    const { stagePath: _stagePath, ...view } = pending.stage
    return { ...view, destination: pending.destination }
  })
  handle('share:discard', (_e, stageId) => {
    const stage = stagedShares.get(stageId)
    if (!stage) return
    stagedShares.delete(stageId)
    discardStagedShare(stage)
  })
  // Updates: check is read-only (fetch + summary); apply is user-confirmed.
  handle('share:checkUpdates', (_e, id) => {
    const tool = store.get(id)
    if (!tool) throw new Error(`Tool not found: ${id}`)
    return checkToolUpdates(tool, store.getRoot())
  })
  handle('share:applyUpdate', (_e, id, input) => {
    const tool = store.get(id)
    if (!tool) throw new Error(`Tool not found: ${id}`)
    return applyToolUpdate(tool, input, { store, processes })
  })

  // ---- Team Tools catalog (1.4) -----------------------------------------
  handle('catalog:prepareStarter', (_e, name, toolIds) => {
    if (!Array.isArray(toolIds) || toolIds.length > 500 || toolIds.some((id) => typeof id !== 'string')) throw new Error('Choose up to 500 tools.')
    const selected = [...new Set(toolIds)].map((id) => {
      const tool = store.get(id)
      if (!tool) throw new Error('A selected tool was removed. Review your selection.')
      return tool
    })
    return prepareCatalogStarter(name, selected)
  })
  handle('catalog:exportStarter', async (_e, content) => {
    const validated = validateCatalogStarter(content)
    const result = await dialog.showSaveDialog({ title: 'Save team catalog', defaultPath: 'catalog.json', filters: [{ name: 'JSON', extensions: ['json'] }] })
    if (result.canceled || !result.filePath) return { saved: false }
    atomicWriteFileSync(result.filePath, validated)
    return { saved: true, path: result.filePath }
  })
  handle('catalog:list', (): TeamCatalog[] => teamCatalogs.list())
  handle('catalog:add', async (_e, url) => {
    try {
      const result = await addCatalog(url, teamCatalogs)
      return { ok: true as const, catalog: result.catalog, warnings: result.warnings, empty: result.empty }
    } catch (err) {
      return shareFailure(err)
    }
  })
  handle('catalog:refresh', async (_e, id) => {
    try {
      const result = await syncCatalog(id, teamCatalogs)
      return { ok: true as const, catalog: result.catalog, warnings: result.warnings, empty: result.empty }
    } catch (err) {
      return shareFailure(err)
    }
  })
  handle('catalog:remove', (_e, id) => teamCatalogs.remove(id))
  // Publish: the tool's own git remote is the entry's repo. A tool with no
  // remote has nothing a coworker could clone, so it is refused here rather
  // than written as an entry nobody can install.
  handle('catalog:publish', async (_e, catalogId, toolId) => {
    try {
      const tool = store.get(toolId)
      if (!tool) throw new Error(`Tool not found: ${toolId}`)
      const remote = tool.projectPath ? await detectGitRemote(tool.projectPath) : null
      if (!remote) {
        return shareFailure(
          new ShareError(
            'catalog_invalid',
            `${tool.name} has no git remote, so there's nothing for a teammate to install from.`,
            'Push the project to a remote first, then share it with your team. Or send a bundle from the ⋯ menu.',
          ),
        )
      }
      // Same refusal buildManifest applies to these exact fields: a catalog
      // entry is pushed to a shared repo, so a credential in a name,
      // description, or capability would live in that repo's history for
      // everyone with clone access.
      const credentialField = firstCredentialField([
        ['name', tool.name],
        ['description', tool.description],
        ...tool.capabilities.map((c): [string, string] => ['capabilities', c]),
      ])
      if (credentialField) {
        return shareFailure(
          new ShareError(
            'export_refused',
            `The ${credentialField} looks like it contains a credential, and a catalog entry is pushed to a repository your whole team can read. Move secrets into Environment variables (those are never shared) and try again.`,
          ),
        )
      }
      const entry: CatalogEntry = {
        name: tool.name,
        description: tool.description || undefined,
        capabilities: tool.capabilities.slice(0, 40),
        repo: remote,
      }
      const result: PublishResult = await publishToCatalog(catalogId, entry, teamCatalogs)
      return { ok: true as const, result, catalog: teamCatalogs.get(catalogId) }
    } catch (err) {
      return shareFailure(err)
    }
  })
}
