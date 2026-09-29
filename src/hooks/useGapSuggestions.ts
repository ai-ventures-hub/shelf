import { useCallback, useEffect, useState } from 'react'
import { subscribeDataRefresh } from '../lib/refreshTriggers'
import type { GapResolveSuggestion } from '../types'

/**
 * Resolve suggestions as presentation state: the Library grid marks the
 * suggested tool's card, the tool detail page hosts the confirm/deny
 * actions. Fails silent — a nudge surface, never an error surface.
 * Re-reads when capability-gaps.json or library.json changes on disk.
 */
export function useGapSuggestions({ enabled = true }: { enabled?: boolean } = {}) {
  const [suggestions, setSuggestions] = useState<GapResolveSuggestion[]>([])

  const refresh = useCallback(async () => {
    if (!window.shelf?.listGapSuggestions) return
    try {
      setSuggestions(await window.shelf.listGapSuggestions())
    } catch {
      // Stay hidden on failure.
    }
  }, [])

  // Pushed, not polled: re-read when gaps or tools change on disk, or the
  // window regains focus. Disabled callers (Simple mode Library) make no calls.
  useEffect(() => {
    if (!enabled) {
      setSuggestions([])
      return
    }
    void refresh()
    return subscribeDataRefresh(['capability-gaps.json', 'library.json'], () => void refresh())
  }, [refresh, enabled])

  /** Confirm: resolves the gap and records WHICH tool resolved it. */
  const resolve = useCallback(
    async (suggestion: GapResolveSuggestion) => {
      await window.shelf.updateCapabilityGap(suggestion.gapId, {
        status: 'resolved',
        relatedToolIds: [suggestion.toolId],
      })
      await refresh()
    },
    [refresh],
  )

  const dismiss = useCallback(
    async (suggestion: GapResolveSuggestion) => {
      await window.shelf.dismissGapSuggestion(suggestion.gapId, suggestion.toolId)
      await refresh()
    },
    [refresh],
  )

  return { suggestions, refresh, resolve, dismiss }
}
