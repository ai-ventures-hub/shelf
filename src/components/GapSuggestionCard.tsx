import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Sparkles } from 'lucide-react'
import { useUiMode } from '../hooks/useUiMode'
import type { GapResolveSuggestion } from '../types'

/**
 * "Loop closed" nudge on the Library home: a new/edited tool covers something
 * an agent recorded as missing. This is the ONLY gap surface Simple mode
 * sees, so its copy stays jargon-free ("your AI assistant was missing…"),
 * while Developer mode links into the full Capability gaps inbox. Renders
 * nothing whenever there are no suggestions — zero idle chrome.
 */
export function GapSuggestionCard() {
  const { isDeveloper } = useUiMode()
  const [suggestions, setSuggestions] = useState<GapResolveSuggestion[]>([])
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    if (!window.shelf?.listGapSuggestions) return
    try {
      setSuggestions(await window.shelf.listGapSuggestions())
    } catch {
      // Nudge surface only — stay hidden rather than surface an error here.
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

  if (suggestions.length === 0) return null
  // One at a time keeps the moment legible; the next surfaces once handled.
  const suggestion = suggestions[0]
  const remaining = suggestions.length - 1

  async function act(kind: 'resolve' | 'dismiss') {
    setBusy(true)
    try {
      if (kind === 'resolve') {
        await window.shelf.updateCapabilityGap(suggestion.gapId, {
          status: 'resolved',
          relatedToolIds: [suggestion.toolId],
        })
      } else {
        await window.shelf.dismissGapSuggestion(suggestion.gapId, suggestion.toolId)
      }
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="gap-suggestion gap-suggestion-card" role="status">
      <p>
        <Sparkles size={14} aria-hidden className="gap-suggestion-icon" />{' '}
        <Link to={`/tools/${suggestion.toolId}`}>{suggestion.toolName}</Link>{' '}
        can now do something your AI assistant was missing —{' '}
        <em>{suggestion.matched.join(', ')}</em>
        {suggestion.matched.length < suggestion.total
          ? ` (${suggestion.matched.length} of ${suggestion.total} requested)`
          : ''}
        .
      </p>
      <div className="gap-suggestion-actions">
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={busy}
          onClick={() => void act('resolve')}
        >
          {isDeveloper ? 'Resolve gap with this tool' : 'Mark it handled'}
        </button>
        <button
          type="button"
          className="btn btn-quiet btn-sm"
          disabled={busy}
          onClick={() => void act('dismiss')}
        >
          Not a match
        </button>
        {isDeveloper ? (
          <Link className="btn btn-quiet btn-sm" to="/gaps">
            View in Capability gaps
          </Link>
        ) : null}
        {remaining > 0 ? (
          <span className="gap-suggestion-more">+{remaining} more</span>
        ) : null}
      </div>
    </div>
  )
}
