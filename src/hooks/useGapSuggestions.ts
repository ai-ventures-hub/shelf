import { useCallback, useEffect, useState } from 'react'
import type { GapResolveSuggestion } from '../types'

/**
 * Resolve suggestions as presentation state: the Library grid marks the
 * suggested tool's card, the tool detail page hosts the confirm/deny
 * actions. Fails silent — a nudge surface, never an error surface.
 */
export function useGapSuggestions() {
  const [suggestions, setSuggestions] = useState<GapResolveSuggestion[]>([])

  const refresh = useCallback(async () => {
    if (!window.shelf?.listGapSuggestions) return
    try {
      setSuggestions(await window.shelf.listGapSuggestions())
    } catch {
      // Stay hidden on failure.
    }
  }, [])

  useEffect(() => {
    void refresh()
    const timer = window.setInterval(() => void refresh(), 5_000)
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [refresh])

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
