import { useCallback, useEffect, useState } from 'react'
import { subscribeDataRefresh } from '../lib/refreshTriggers'
import type {
  AgentAccessKind,
  CapabilityGap,
  CapabilityGapStatus,
  GapResolveSuggestion,
} from '../types'

/**
 * Gaps (and optional resolve suggestions) read on mount and again when
 * capability-gaps.json or library.json changes, or the window regains focus.
 * `enabled: false` skips all reads where nothing is displayed.
 */
export function useCapabilityGaps(
  opts: {
    status?: CapabilityGapStatus
    limit?: number
    enabled?: boolean
    /** Also read resolve suggestions (a second IPC call). */
    withSuggestions?: boolean
  } = {},
) {
  const { status, limit, enabled = true, withSuggestions = true } = opts
  const [gaps, setGaps] = useState<CapabilityGap[]>([])
  const [suggestions, setSuggestions] = useState<GapResolveSuggestion[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!window.shelf?.listCapabilityGaps) {
      setError('Capability gaps are unavailable outside Shelf.')
      setLoading(false)
      return
    }
    try {
      const [nextGaps, nextSuggestions] = await Promise.all([
        window.shelf.listCapabilityGaps({ status, limit }),
        // Suggestions are a nudge, never load-bearing: a failure here must
        // not take down the gaps list (or the sidebar's open-gap count).
        withSuggestions
          ? window.shelf.listGapSuggestions?.().catch(() => []) ?? Promise.resolve([])
          : Promise.resolve([]),
      ])
      setGaps(nextGaps)
      setSuggestions(nextSuggestions)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [status, limit, withSuggestions])

  useEffect(() => {
    if (!enabled) return
    void refresh()
    // Suggestions depend on tool capabilities, so library edits count too.
    return subscribeDataRefresh(['capability-gaps.json', 'library.json'], () => void refresh())
  }, [refresh, enabled])

  const updateStatus = useCallback(
    async (id: string, next: CapabilityGapStatus) => {
      await window.shelf.updateCapabilityGapStatus(id, next)
      await refresh()
    },
    [refresh],
  )

  const remove = useCallback(async (id: string) => {
    await window.shelf.deleteCapabilityGap(id)
    await refresh()
  }, [refresh])

  /** Resolve from a suggestion: records WHICH tool resolved the gap. */
  const resolveWithTool = useCallback(
    async (id: string, toolId: string) => {
      await window.shelf.updateCapabilityGap(id, {
        status: 'resolved',
        relatedToolIds: [toolId],
      })
      await refresh()
    },
    [refresh],
  )

  const dismissSuggestion = useCallback(
    async (id: string, toolId: string) => {
      await window.shelf.dismissGapSuggestion(id, toolId)
      await refresh()
    },
    [refresh],
  )

  const getBrief = useCallback(
    (id: string) => window.shelf.getGapBrief(id),
    [],
  )

  const record = useCallback(async (input: {
    task: string
    capabilities: string[]
    reason: string
    relatedToolIds?: string[]
    suggestedAccess?: AgentAccessKind
  }) => {
    const result = await window.shelf.recordCapabilityGap(input)
    await refresh()
    return result
  }, [refresh])

  return {
    gaps,
    suggestions,
    loading,
    error,
    refresh,
    updateStatus,
    remove,
    record,
    resolveWithTool,
    dismissSuggestion,
    getBrief,
  }
}
