/**
 * The Activity board as the desktop and the Companion both show it: one
 * place that gathers the sources `buildMorningBoard` wants.
 */
import type { CapabilityGapStore } from './capability-gap-store'
import { listClientObservations } from './client-observation'
import type { DesignProfileStore } from './design-profile-store'
import type { LibraryStore } from './library-store'
import { buildMorningBoard, type MorningEvent } from './morning-board'
import type { ReceiptStore } from './receipt-store'
import type { ToolDraftStore } from './tool-draft-store'
import type { VerificationRunner } from './verification-runner'

export interface ActivityBoardSources {
  store: LibraryStore
  verification: VerificationRunner
  receipts: ReceiptStore
  capabilityGaps: CapabilityGapStore
  designProfiles: DesignProfileStore
  toolDrafts: ToolDraftStore
}

export function buildActivityBoard(sources: ActivityBoardSources): MorningEvent[] {
  const { store, verification, receipts, capabilityGaps, designProfiles, toolDrafts } = sources
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
}
