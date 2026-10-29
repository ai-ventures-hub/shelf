import { buildActivityBoard } from '../../shared/activity-board'
import { acceptToolDraft } from '../../shared/tool-draft-store'
import type { IpcContext } from './context'
import { handle } from './typed'

/** The Activity board and agent registration drafts (accept / reject). */
export function registerActivityIpc(ctx: IpcContext): void {
  const { store, processes, prefs, verification, receipts, capabilityGaps, designProfiles, toolDrafts } = ctx

  handle('activity:board', () =>
    buildActivityBoard({ store, verification, receipts, capabilityGaps, designProfiles, toolDrafts }),
  )
  handle('drafts:list', () => toolDrafts.list())
  handle('drafts:accept', (_e, id, expectedUpdatedAt) => {
    const uiPrefs = prefs.get()
    return acceptToolDraft(id, toolDrafts, { store, processes }, {
      expectedUpdatedAt: typeof expectedUpdatedAt === 'string' ? expectedUpdatedAt : undefined,
      toolDefaults: {
        iconLucide: uiPrefs.defaultIconLucide,
        iconColor: uiPrefs.defaultIconColor,
        iconBackground: uiPrefs.defaultIconBackground,
      },
    })
  })
  handle('drafts:reject', (_e, id) => {
    toolDrafts.delete(id)
  })
}
