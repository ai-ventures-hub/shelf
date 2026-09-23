import { useCallback, useEffect, useState } from 'react'
import type { ToolDraft } from '../types'

/**
 * Pending agent registrations. Refreshes when the window focuses so a draft
 * staged by an MCP client shows up without a restart.
 */
export function useToolDrafts() {
  const [drafts, setDrafts] = useState<ToolDraft[]>([])
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      setDrafts(await window.shelf.listToolDrafts())
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  useEffect(() => {
    void refresh()
    const onFocus = () => void refresh()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [refresh])

  return { drafts, error, refresh }
}
