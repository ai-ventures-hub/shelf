/**
 * Suggest-only gap resolution matching (PLAN-0.9.md): when a tool's
 * capabilities overlap an open/planned gap's, surface a suggestion the USER
 * confirms. Never auto-resolve — a wrong auto-resolve silently deletes a
 * recorded need, which is exactly what the inbox exists to preserve.
 *
 * Deterministic and explainable: normalized capability set-overlap, tools
 * that were created or edited at/after the gap was recorded (tools that
 * already existed unchanged when the gap was recorded were, by definition,
 * insufficient then).
 */
import type { CapabilityGap, Tool } from './types'

export interface GapResolveSuggestion {
  gapId: string
  toolId: string
  toolName: string
  /** Gap capabilities (display form) the tool covers. */
  matched: string[]
  /** Total capabilities the gap requested. */
  total: number
}

export function suggestGapResolutions(
  gaps: CapabilityGap[],
  tools: Tool[],
): GapResolveSuggestion[] {
  const suggestions: GapResolveSuggestion[] = []
  for (const gap of gaps) {
    if (gap.status !== 'open' && gap.status !== 'planned') continue
    const dismissed = new Set(gap.suggestionDismissedToolIds || [])
    const gapCreated = Date.parse(gap.createdAt)
    // Fail closed on corrupt timestamps: no suggestion beats a wrong one.
    if (!Number.isFinite(gapCreated)) continue
    for (const tool of tools) {
      if (dismissed.has(tool.id)) continue
      // Compare when the tool's CAPABILITIES changed — updatedAt bumps on
      // every launch/edit and would re-qualify tools the gap already
      // deemed insufficient. Pre-0.9 records fall back to createdAt.
      const capableSince = Date.parse(tool.capabilitiesUpdatedAt || tool.createdAt)
      if (!Number.isFinite(capableSince) || capableSince < gapCreated) continue
      const toolCaps = new Set(
        tool.capabilities.map((capability) => capability.trim().toLowerCase()),
      )
      const matched = gap.capabilities.filter((capability) =>
        toolCaps.has(capability.trim().toLowerCase()),
      )
      if (matched.length === 0) continue
      suggestions.push({
        gapId: gap.id,
        toolId: tool.id,
        toolName: tool.name,
        matched,
        total: gap.capabilities.length,
      })
    }
  }
  // Best coverage first within each gap; stable across identical inputs.
  return suggestions.sort(
    (a, b) =>
      a.gapId.localeCompare(b.gapId) ||
      b.matched.length - a.matched.length ||
      a.toolName.localeCompare(b.toolName),
  )
}
