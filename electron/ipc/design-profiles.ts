import { dialog } from 'electron'
import path from 'node:path'
import { BRAND_ASSET_MIME_TYPES, containedDataUrl } from '../../shared/contained-data-url'
import { buildDesignBrief } from '../../shared/design-brief'
import { extractProjectTokens } from '../../shared/design-extract'
import type { IpcContext } from './context'
import { handle } from './typed'

/**
 * Design Engine (v1.0): list + editor mutations. Agents stay read-only over
 * MCP; the GUI is the only write surface.
 */
export function registerDesignProfilesIpc(ctx: IpcContext): void {
  const { designProfiles } = ctx

  handle('designProfiles:list', () => designProfiles.list())
  // Any GUI save transfers ownership to the user: agents may then no longer
  // overwrite the profile via shelf_upsert_design_profile.
  handle('designProfiles:save', (_e, input) =>
    designProfiles.save({ ...input, origin: 'user' }),
  )
  handle('designProfiles:delete', (_e, id) => {
    designProfiles.delete(id)
  })
  handle('designProfiles:setDefault', (_e, id) => designProfiles.setDefault(id))
  handle('designProfiles:pickAsset', async (_e, profileId, kind) => {
    const result = await dialog.showOpenDialog(ctx.getMainWindow()!, {
      properties: ['openFile'],
      filters: [
        {
          name: 'Brand assets',
          extensions: [
            'svg', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'ico',
            'pdf', 'woff2', 'woff', 'ttf', 'otf',
          ],
        },
      ],
    })
    if (result.canceled || !result.filePaths[0]) return null
    return designProfiles.importAsset(profileId, result.filePaths[0], kind)
  })
  handle('designProfiles:importAsset', (_e, profileId, sourcePath, kind) =>
    designProfiles.importAsset(profileId, sourcePath, kind),
  )
  handle('designProfiles:removeAsset', (_e, profileId, assetPath) => {
    designProfiles.removeAsset(profileId, assetPath)
  })
  handle('designProfiles:brief', (_e, id) => {
    const profile = designProfiles.get(id)
    return profile ? buildDesignBrief(profile) : null
  })
  // Phase 3 assist: deterministic parse of the project's CSS custom
  // properties / Tailwind literals. Read-only — applying is a GUI save.
  handle('designProfiles:extractTokens', (_e, projectPath) =>
    extractProjectTokens(projectPath),
  )
  // Data-url previews for the editor. Restricted to the brand-assets root so
  // the renderer cannot read arbitrary files through this channel.
  handle('designProfiles:assetDataUrl', (_e, assetPath) =>
    // PDFs and other non-previewable types return null; the renderer shows a glyph tile.
    containedDataUrl(path.join(designProfiles.getRoot(), 'brand-assets'), assetPath, BRAND_ASSET_MIME_TYPES),
  )
}
