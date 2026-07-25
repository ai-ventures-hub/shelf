/**
 * Smoke the Quick Open ranking helpers without spinning up Electron.
 * Mirrors src/lib/quickOpenSearch.ts — keep asserts aligned when scoring changes.
 */
import assert from 'node:assert/strict'

function scoreQuickOpenItem(item, query) {
  const q = query.trim().toLowerCase()
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

  const tokens = q.split(/\s+/).filter(Boolean)
  if (tokens.length > 1 && tokens.every((t) => title.includes(t) || hay.includes(t))) {
    return 300 + boost
  }
  return null
}

function rankQuickOpenItems(items, query) {
  const scored = []
  for (const item of items) {
    const score = scoreQuickOpenItem(item, query)
    if (score == null) continue
    scored.push({ item, score })
  }
  scored.sort(
    (a, b) =>
      b.score - a.score ||
      a.item.title.localeCompare(b.item.title),
  )
  return scored.map((s) => s.item)
}

const items = [
  {
    id: 'tool:alpha',
    kind: 'tool',
    title: 'Alpha Board',
    keywords: ['kanban', 'npm run dev'],
    boost: 10,
  },
  {
    id: 'tool:beta',
    kind: 'tool',
    title: 'Beta Sync',
    keywords: ['sync'],
    boost: 50,
  },
  {
    id: 'action:settings',
    kind: 'action',
    title: 'Settings',
    keywords: ['preferences', 'appearance'],
    boost: 5,
  },
]

const empty = rankQuickOpenItems(items, '')
assert.equal(empty[0].id, 'tool:beta', 'empty query prefers higher boost')

const prefix = rankQuickOpenItems(items, 'alpha')
assert.equal(prefix[0].id, 'tool:alpha')
assert.equal(prefix.length, 1)

const keyword = rankQuickOpenItems(items, 'appearance')
assert.equal(keyword[0].id, 'action:settings')

const multi = rankQuickOpenItems(items, 'alpha board')
assert.equal(multi[0].id, 'tool:alpha')

const miss = rankQuickOpenItems(items, 'zzzz')
assert.equal(miss.length, 0)

console.log('OK: quick open ranking smoke passed')
