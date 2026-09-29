import { useCallback, useEffect, useRef, useState } from 'react'
import { useLibrary } from './useLibrary'
import type { LogLine } from '../types'

/** Lines kept in memory per view; the main process retains its own copy. */
export const LOG_BUFFER_LIMIT = 3000

function lineKey(line: LogLine): string | null {
  return line.id || null
}

/** Append without duplicates (ids repeat when a fetch overlaps pushed lines). */
function appendBounded(prev: LogLine[], incoming: LogLine[]): LogLine[] {
  if (incoming.length === 0) return prev
  const seen = new Set<string>()
  // Only the tail can overlap with a fetch that just completed.
  for (let i = Math.max(0, prev.length - incoming.length - 200); i < prev.length; i++) {
    const key = lineKey(prev[i])
    if (key) seen.add(key)
  }
  const fresh = incoming.filter((line) => {
    const key = lineKey(line)
    if (!key) return true
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  if (fresh.length === 0) return prev
  const next = prev.concat(fresh)
  return next.length > LOG_BUFFER_LIMIT ? next.slice(-LOG_BUFFER_LIMIT) : next
}

/**
 * Output for one tool run. The first read comes from disk; after that, pushed
 * log lines are appended to a bounded buffer instead of re-reading the whole
 * run on every burst. Appends are batched per animation frame, which also
 * pauses rendering while the window is hidden. The buffer resets only when the
 * tool or the selected run changes, never on a status change.
 */
export function useToolLogs(
  toolId: string | undefined,
  runId: string | undefined,
  { enabled = true, pollExternal = false }: { enabled?: boolean; pollExternal?: boolean } = {},
) {
  const { getLogs, subscribeLogs } = useLibrary()
  const [lines, setLines] = useState<LogLine[]>([])
  const [error, setError] = useState<string | null>(null)
  const reloadRef = useRef<() => void>(() => {})

  useEffect(() => {
    if (!toolId || !enabled) return
    let active = true
    let loading = false
    let reloadAgain = false
    let queue: LogLine[] = []
    /** Everything pushed since a read began, so the read cannot drop it. */
    let duringRead: LogLine[] | null = null
    let frame: number | undefined
    setLines([])
    setError(null)

    const flush = () => {
      frame = undefined
      if (!active || queue.length === 0) return
      const batch = queue
      queue = []
      setLines((prev) => appendBounded(prev, batch))
    }

    const reload = async () => {
      if (loading) { reloadAgain = true; return }
      loading = true
      reloadAgain = false
      duringRead = [...queue]
      try {
        const fetched = await getLogs(toolId, runId)
        if (!active) return
        // Lines pushed during the read are kept if the read missed them.
        const pushed = duringRead ?? []
        queue = []
        setLines(appendBounded(fetched.slice(-LOG_BUFFER_LIMIT), pushed))
        setError(null)
      } catch {
        if (active) setError('Could not read this run’s logs.')
      } finally {
        duringRead = null
        loading = false
        if (active && reloadAgain) void reload()
      }
    }
    reloadRef.current = () => void reload()
    void reload()

    // A selected past run is fixed; only live output takes pushed lines.
    const offLine = runId
      ? () => {}
      : subscribeLogs(toolId, (line) => {
          queue.push(line)
          if (queue.length > LOG_BUFFER_LIMIT) queue = queue.slice(-LOG_BUFFER_LIMIT)
          if (duringRead) {
            duringRead.push(line)
            if (duringRead.length > LOG_BUFFER_LIMIT) duringRead = duringRead.slice(-LOG_BUFFER_LIMIT)
          }
          if (frame === undefined) frame = window.requestAnimationFrame(flush)
        })
    // A receipt marks a run starting or ending: re-read so a new run replaces
    // the previous run's output.
    const offReceipt = window.shelf?.onReceiptUpdate
      ? window.shelf.onReceiptUpdate((receipt) => {
          if (receipt.toolId === toolId) void reload()
        })
      : () => {}
    return () => {
      active = false
      reloadRef.current = () => {}
      if (frame !== undefined) window.cancelAnimationFrame(frame)
      offLine()
      offReceipt()
    }
  }, [toolId, runId, enabled, getLogs, subscribeLogs])

  // Tools adopted from another Shelf process do not push lines to this
  // window, so their output is read from disk while visible.
  useEffect(() => {
    if (!toolId || !enabled || !pollExternal) return
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') reloadRef.current()
    }, 3000)
    return () => {
      window.clearInterval(timer)
      // Polling ends when the other host's run stops; read once more so its
      // last lines (often the crash) are shown. A no-op after unmount.
      reloadRef.current()
    }
  }, [toolId, enabled, pollExternal])

  const reload = useCallback(() => reloadRef.current(), [])
  return { lines, error, reload }
}
