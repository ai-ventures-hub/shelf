import { useCallback, useEffect, useState } from 'react'
import type {
  AgentAccessKind,
  CapabilityGap,
  CapabilityGapStatus,
} from '../types'

export function useCapabilityGaps(
  opts: { status?: CapabilityGapStatus; limit?: number } = {},
) {
  const { status, limit } = opts
  const [gaps, setGaps] = useState<CapabilityGap[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!window.shelf?.listCapabilityGaps) {
      setError('Capability gaps are unavailable outside Shelf.')
      setLoading(false)
      return
    }
    try {
      setGaps(await window.shelf.listCapabilityGaps({ status, limit }))
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [status, limit])

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

  return { gaps, loading, error, refresh, updateStatus, remove, record }
}
