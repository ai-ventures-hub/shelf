import { useCallback, useEffect, useState } from 'react'
import type { ReceiptOutcome, RunReceipt } from '../types'

export interface UseReceiptsOpts {
  toolId?: string
  limit?: number
  outcomes?: ReceiptOutcome[]
  query?: string
}

/** Load + live-update run receipts from the main process. */
export function useReceipts(opts: UseReceiptsOpts = {}) {
  const [receipts, setReceipts] = useState<RunReceipt[]>([])
  const [loading, setLoading] = useState(true)
  const outcomesKey = opts.outcomes?.slice().sort().join(',') || ''

  const refresh = useCallback(async () => {
    if (!window.shelf?.listReceipts) {
      setReceipts([])
      setLoading(false)
      return
    }
    try {
      const next = await window.shelf.listReceipts({
        toolId: opts.toolId,
        limit: opts.limit ?? 40,
        outcomes: opts.outcomes,
        query: opts.query,
      })
      setReceipts(next)
    } finally {
      setLoading(false)
    }
  }, [opts.toolId, opts.limit, outcomesKey, opts.query])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (!window.shelf?.onReceiptUpdate) return
    return window.shelf.onReceiptUpdate((receipt) => {
      // Ignore updates for other tools when filtered.
      if (opts.toolId && receipt.toolId !== opts.toolId) return
      if (opts.outcomes?.length && !opts.outcomes.includes(receipt.outcome)) return
      if (opts.query?.trim()) {
        const q = opts.query.trim().toLowerCase()
        const hay = [receipt.toolName, receipt.launchCommand, receipt.message || '']
          .join(' ')
          .toLowerCase()
        if (!hay.includes(q)) return
      }
      setReceipts((prev) => {
        const without = prev.filter((r) => r.id !== receipt.id)
        return [receipt, ...without].slice(0, opts.limit ?? 40)
      })
    })
  }, [opts.toolId, opts.limit, outcomesKey, opts.query])

  const clear = useCallback(async () => {
    if (!window.shelf?.clearReceipts) return
    await window.shelf.clearReceipts({ toolId: opts.toolId })
    await refresh()
  }, [opts.toolId, refresh])

  const exportReceipts = useCallback(
    async (format: 'json' | 'csv') => {
      if (!window.shelf?.exportReceipts) return { saved: false as const }
      return window.shelf.exportReceipts({
        format,
        toolId: opts.toolId,
        outcomes: opts.outcomes,
        query: opts.query,
      })
    },
    [opts.toolId, outcomesKey, opts.query],
  )

  return { receipts, loading, refresh, clear, exportReceipts }
}
