import { resolveProfileForGap } from '../../shared/design-resolve'
import { buildGapBrief } from '../../shared/gap-brief'
import { suggestGapResolutions } from '../../shared/gap-suggest'
import type { Tool } from '../types'
import type { IpcContext } from './context'
import { handle } from './typed'

/** Capability Gaps inbox: record, plan, resolve (user-confirmed), brief. */
export function registerCapabilityGapsIpc(ctx: IpcContext): void {
  const { store, capabilityGaps, designProfiles } = ctx

  handle('capabilityGaps:list', (_e, opts) => capabilityGaps.list(opts || {}))
  handle('capabilityGaps:record', (_e, input) => {
    const knownIds = new Set(store.list().map((tool) => tool.id))
    return capabilityGaps.record({
      ...input,
      relatedToolIds: (input.relatedToolIds || []).filter((id) => knownIds.has(id)),
    })
  })
  handle('capabilityGaps:updateStatus', (_e, id, status) =>
    capabilityGaps.updateStatus(id, status),
  )
  handle('capabilityGaps:update', (_e, id, patch) => {
    const knownIds = new Set(store.list().map((tool) => tool.id))
    const validToolIds = (patch.relatedToolIds || []).filter((toolId) =>
      knownIds.has(toolId),
    )
    // Resolve-with-tool must record WHICH tool resolved the gap; if the
    // tool vanished since the suggestion rendered, fail instead of
    // resolving with no provenance.
    if (patch.relatedToolIds?.length && validToolIds.length === 0) {
      throw new Error('That tool no longer exists in the library.')
    }
    return capabilityGaps.update(id, { ...patch, relatedToolIds: validToolIds })
  })
  handle('capabilityGaps:delete', (_e, id) => {
    capabilityGaps.delete(id)
  })
  // Paste-ready build brief ("Copy brief for your AI tool").
  handle('capabilityGaps:brief', (_e, id) => {
    const gap = capabilityGaps.get(id)
    if (!gap) throw new Error(`Capability gap not found: ${id}`)
    const related = gap.relatedToolIds
      .map((toolId) => store.get(toolId))
      .filter((tool): tool is Tool => Boolean(tool))
    const brand = resolveProfileForGap(gap, store.listCollections(), designProfiles.list())
    return buildGapBrief(gap, related, brand.profile ? { profile: brand.profile } : undefined)
  })
  // Suggest-only resolve matching; the user confirms in the GUI. Uncapped
  // read — list()'s 200 cap would silently starve older gaps.
  handle('capabilityGaps:suggestions', () =>
    suggestGapResolutions(capabilityGaps.listAll(), store.list()),
  )
  handle('capabilityGaps:dismissSuggestion', (_e, id, toolId) =>
    capabilityGaps.dismissSuggestion(id, toolId),
  )
}
