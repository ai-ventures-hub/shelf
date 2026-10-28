import { listClientObservations } from '../../shared/client-observation'
import { buildMorningBoard } from '../../shared/morning-board'
import { acceptToolDraft } from '../../shared/tool-draft-store'
import type { IpcContext } from './context'
import { handle } from './typed'

/** The Activity board and agent registration drafts (accept / reject). */
export function registerActivityIpc(ctx: IpcContext): void {
  const { store, processes, prefs, verification, receipts, capabilityGaps, designProfiles, toolDrafts } = ctx

  handle('activity:board', () => {
    const verifications = store.list().flatMap((tool) => {
      try {
        // Pass the record: re-reading library.json per tool cost ~1 ms each
        // on the main thread (322 ms for 300 tools).
        return verification.get(tool.id, tool).runs.map((run) => ({
          toolId: tool.id,
          toolName: tool.name,
          status: run.status,
          at: run.endedAt || run.startedAt,
          message: run.message,
        }))
      } catch {
        // A damaged workflow is opened on its own page. It does not blank the board.
        return []
      }
    })
    return buildMorningBoard({
      receipts: receipts.list({ limit: 80 }),
      gaps: capabilityGaps.list({ limit: 40 }),
      profiles: designProfiles.list(),
      verifications,
      clients: listClientObservations(),
      drafts: toolDrafts.list().map((draft) => ({
        id: draft.id,
        name: draft.name,
        at: draft.updatedAt,
        client: draft.client,
      })),
    })
  })
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
