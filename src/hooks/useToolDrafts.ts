import { useSyncExternalStore } from 'react'
import { subscribeDataRefresh } from '../lib/refreshTriggers'
import type { ToolDraft } from '../types'

/**
 * Pending agent registrations, shared by every caller (sidebar count, Library
 * banner, Waiting page) so accepting or rejecting a draft updates all of them
 * at once. Re-reads when tool-drafts.json changes on disk, when the window
 * regains focus, and whenever a caller runs refresh().
 */
interface DraftsSnapshot {
  drafts: ToolDraft[]
  error: string | null
  loading: boolean
}

let snapshot: DraftsSnapshot = { drafts: [], error: null, loading: true }
const listeners = new Set<() => void>()
let detach: (() => void) | null = null
let inflight: Promise<void> | null = null
let readAgain = false

function publish(next: Partial<DraftsSnapshot>) {
  snapshot = { ...snapshot, ...next }
  for (const listener of listeners) listener()
}

async function readDrafts(): Promise<void> {
  if (!window.shelf?.listToolDrafts) {
    publish({ loading: false })
    return
  }
  try {
    publish({ drafts: await window.shelf.listToolDrafts(), error: null, loading: false })
  } catch (err) {
    publish({ error: err instanceof Error ? err.message : String(err), loading: false })
  }
}

/** Coalesces overlapping calls; a call during a read schedules one more read. */
export function refreshToolDrafts(): Promise<void> {
  if (inflight) {
    readAgain = true
    return inflight
  }
  inflight = readDrafts().finally(() => {
    inflight = null
    if (readAgain) {
      readAgain = false
      void refreshToolDrafts()
    }
  })
  return inflight
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  if (listeners.size === 1) {
    detach = subscribeDataRefresh(['tool-drafts.json'], () => void refreshToolDrafts())
    void refreshToolDrafts()
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) {
      detach?.()
      detach = null
    }
  }
}

const getSnapshot = () => snapshot

export function useToolDrafts() {
  const { drafts, error, loading } = useSyncExternalStore(subscribe, getSnapshot)
  return { drafts, error, loading, refresh: refreshToolDrafts }
}
