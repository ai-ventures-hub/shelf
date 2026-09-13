import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReceiptOutcome, RunReceipt } from '../types'

export interface UseReceiptsOpts {
  toolId?: string
  limit?: number
  outcomes?: ReceiptOutcome[]
  query?: string
}

export function useReceipts(opts: UseReceiptsOpts = {}) {
  const [receipts, setReceipts] = useState<RunReceipt[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const generation = useRef(0)
  const outcomesKey = opts.outcomes?.slice().sort().join(',') || ''
  const refresh = useCallback(async () => {
    if (!window.shelf) {
      setLoading(false)
      return
    }
    const ticket = ++generation.current
    setLoading(true)
    try {
      const next = await window.shelf.listReceipts({
        toolId: opts.toolId,
        limit: opts.limit ?? 40,
        outcomes: outcomesKey ? (outcomesKey.split(',') as ReceiptOutcome[]) : undefined,
        query: opts.query,
      })
      if (ticket === generation.current) {
        setReceipts(next)
        setError(null)
      }
    } catch (err) {
      if (ticket === generation.current) setError(err instanceof Error ? err.message : String(err))
    } finally {
      if (ticket === generation.current) setLoading(false)
    }
  }, [opts.toolId, opts.limit, outcomesKey, opts.query])

  useEffect(() => {
    setReceipts([])
    void refresh()
    // Requery after receipt events: filter membership and chronological order can change.
    if (!window.shelf) return
    const offReceipt = window.shelf.onReceiptUpdate(() => {
      void refresh()
    })
    const offFile = window.shelf.onExternalDataChange((filename) => {
      if (filename === 'receipts.json') void refresh()
    })
    return () => {
      generation.current++
      offReceipt()
      offFile()
    }
  }, [refresh])
  const clear = useCallback(async () => {
    await window.shelf.clearReceipts({ toolId: opts.toolId })
    await refresh()
  }, [opts.toolId, refresh])
  const exportReceipts = useCallback(
    (format: 'json' | 'csv') =>
      window.shelf.exportReceipts({
        format,
        toolId: opts.toolId,
        outcomes: outcomesKey ? (outcomesKey.split(',') as ReceiptOutcome[]) : undefined,
        query: opts.query,
      }),
    [opts.toolId, outcomesKey, opts.query],
  )
  return { receipts, loading, error, refresh, clear, exportReceipts }
}
