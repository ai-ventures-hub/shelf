/** Shared display math; callers own the wording for a missing timestamp. */
export function formatRelativeTime(iso?: string, empty = 'Unknown', dayAfterHours = 48, now = Date.now()): string {
  const then = iso ? Date.parse(iso) : NaN
  if (!Number.isFinite(then)) return empty
  const minutes = Math.round((now - then) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  return hours < dayAfterHours ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`
}
