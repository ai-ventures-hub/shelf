/**
 * Pure ranking for Quick Open (⌘K).
 * Kept free of React/Electron so scoring stays easy to reason about.
 * Contract mirrored by scripts/smoke-quick-open.mjs — update both when scoring changes.
 */

export type QuickOpenKind = 'tool' | 'collection' | 'receipt' | 'action'

export interface QuickOpenCandidate {
  id: string
  kind: QuickOpenKind
  title: string
  subtitle?: string
  /** Extra searchable text (tags, commands, aliases). */
  keywords?: string[]
  /** Prefer when the query is empty (favorites / recent / pinned actions). */
  boost?: number
}

/**
 * Score one candidate against a query.
 * @returns null when the item should be hidden for this query
 */
export function scoreQuickOpenItem(
  item: QuickOpenCandidate,
  query: string,
): number | null {
  const q = query.trim().toLowerCase()
  // Empty query: keep everything, sorted by boost then title at the call site.
  if (!q) return item.boost ?? 0

  const title = item.title.toLowerCase()
  const hay = [item.subtitle, ...(item.keywords || [])]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
  const boost = item.boost ?? 0

  if (title === q) return 1000 + boost
  if (title.startsWith(q)) return 800 + boost
  if (title.includes(q)) return 600 + boost
  if (hay.includes(q)) return 400 + boost

  // Multi-word: every token must appear in title or haystack.
  const tokens = q.split(/\s+/).filter(Boolean)
  if (tokens.length > 1 && tokens.every((t) => title.includes(t) || hay.includes(t))) {
    return 300 + boost
  }

  return null
}

/** Rank candidates; drops non-matches when a query is present. */
export function rankQuickOpenItems(
  items: QuickOpenCandidate[],
  query: string,
): QuickOpenCandidate[] {
  const scored: { item: QuickOpenCandidate; score: number }[] = []
  for (const item of items) {
    const score = scoreQuickOpenItem(item, query)
    if (score == null) continue
    scored.push({ item, score })
  }

  scored.sort(
    (a, b) =>
      b.score - a.score ||
      // Stable group preference when scores tie: tools → collections → actions.
      kindRank(a.item.kind) - kindRank(b.item.kind) ||
      a.item.title.localeCompare(b.item.title),
  )
  return scored.map((s) => s.item)
}

function kindRank(kind: QuickOpenKind): number {
  if (kind === 'tool') return 0
  if (kind === 'collection') return 1
  if (kind === 'receipt') return 2
  return 3
}

/** Group a flat ranked list for section headers in the palette. */
export function groupQuickOpenItems(
  items: QuickOpenCandidate[],
): { kind: QuickOpenKind; label: string; items: QuickOpenCandidate[] }[] {
  const order: QuickOpenKind[] = ['tool', 'collection', 'receipt', 'action']
  const labels: Record<QuickOpenKind, string> = {
    tool: 'Tools',
    collection: 'Collections',
    receipt: 'Recent runs',
    action: 'Actions',
  }
  return order
    .map((kind) => ({
      kind,
      label: labels[kind],
      items: items.filter((i) => i.kind === kind),
    }))
    .filter((g) => g.items.length > 0)
}
