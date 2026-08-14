import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { AddToolButton } from '../components/StudioShell'
import {
  ReceiptHistory,
  outcomesForFilter,
  type ReceiptOutcomeFilter,
} from '../components/ReceiptHistory'
import {
  SuggestionGridCard,
  SuggestionListRow,
} from '../components/SuggestionGridCard'
import { ToolCard, ToolListRow } from '../components/ToolCard'
import { useGapSuggestions } from '../hooks/useGapSuggestions'
import { useLibrary } from '../hooks/useLibrary'
import { usePrefs } from '../hooks/usePrefs'
import { useReceipts } from '../hooks/useReceipts'
import { useUiMode } from '../hooks/useUiMode'
import type { ToolStatus } from '../types'

export type LibraryMode =
  | 'all'
  | 'favorites'
  | 'running'
  | 'recent'
  | 'collection'
  | 'tag'

export function LibraryPage({
  mode = 'all',
}: {
  mode?: LibraryMode
}) {
  const { tools, collections, states, health, loading, error, startTool, stopTool, saveTool } =
    useLibrary()
  const { prefs, updatePrefs } = usePrefs()
  const { isDeveloper } = useUiMode()
  const { suggestions } = useGapSuggestions()
  const [receiptFilter, setReceiptFilter] = useState<ReceiptOutcomeFilter>('all')
  const [receiptExporting, setReceiptExporting] = useState(false)
  const {
    receipts: recentReceipts,
    exportReceipts,
  } = useReceipts({
    limit: 40,
    outcomes: outcomesForFilter(receiptFilter),
  })
  const { tag, collectionId } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const [query, setQuery] = useState(searchParams.get('q') || '')
  const [filterOpen, setFilterOpen] = useState(false)
  const [tagFilter, setTagFilter] = useState<string[]>(
    searchParams.get('tags')?.split(',').filter(Boolean) || [],
  )
  const [statusFilter, setStatusFilter] = useState<ToolStatus | 'all'>(
    (searchParams.get('status') as ToolStatus | 'all') || 'all',
  )
  const searchRef = useRef<HTMLInputElement>(null)
  const filterRef = useRef<HTMLDivElement>(null)

  // Suggestions render as standalone cards in the grid (home view only,
  // never inside an active search/filter) — uniform silhouette, not attached
  // to the tool — linking to the Capability gaps page for the decision.
  const shownSuggestions = useMemo(() => {
    const browsing =
      mode === 'all' &&
      !query.trim() &&
      tagFilter.length === 0 &&
      statusFilter === 'all'
    if (!browsing) return []
    // One card per tool (best coverage wins) — a tool matching several gaps
    // must not flood the grid with identical cards. Cap keeps tools primary.
    const byTool = new Map<string, (typeof suggestions)[number]>()
    for (const suggestion of suggestions) {
      const existing = byTool.get(suggestion.toolId)
      if (!existing || suggestion.matched.length > existing.matched.length) {
        byTool.set(suggestion.toolId, suggestion)
      }
    }
    return Array.from(byTool.values()).slice(0, 3)
  }, [mode, query, tagFilter, statusFilter, suggestions])

  // Redirect legacy /tags/:tag into filter tokens on the main library.
  useEffect(() => {
    if (mode === 'tag' && tag) {
      setTagFilter([tag])
    }
  }, [mode, tag])

  useEffect(() => {
    if (!window.shelf) return
    return window.shelf.onFocusSearch(() => {
      searchRef.current?.focus()
      searchRef.current?.select()
    })
  }, [])

  useEffect(() => {
    if (!filterOpen) return
    const onDoc = (e: MouseEvent) => {
      if (!filterRef.current?.contains(e.target as Node)) setFilterOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [filterOpen])

  const collection = collectionId
    ? collections.find((c) => c.id === collectionId)
    : undefined

  const tagCounts = useMemo(() => {
    const map = new Map<string, number>()
    for (const tool of tools) {
      for (const t of tool.tags) {
        const key = t.trim()
        if (!key) continue
        map.set(key, (map.get(key) || 0) + 1)
      }
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]))
  }, [tools])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    let list = tools.filter((tool) => {
      if (mode === 'favorites' && !tool.favorite) return false
      if (mode === 'running' && states[tool.id]?.status !== 'running') return false
      if (mode === 'recent' && !tool.lastLaunchedAt) return false
      if (mode === 'collection') {
        if (!collection || !collection.toolIds.includes(tool.id)) return false
      }
      if (tagFilter.length > 0) {
        const lower = tool.tags.map((t) => t.toLowerCase())
        if (!tagFilter.every((t) => lower.includes(t.toLowerCase()))) return false
      }
      if (statusFilter !== 'all') {
        const status = states[tool.id]?.status || 'stopped'
        if (status !== statusFilter) return false
      }
      if (!q) return true
      const haystack = [
        tool.name,
        tool.description,
        tool.launchCommand,
        ...tool.tags,
        ...tool.capabilities,
        ...tool.agentAccess.flatMap((access) => [
          access.kind,
          access.transport,
          access.entrypoint,
          access.notes,
        ]),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return haystack.includes(q)
    })

    if (mode === 'recent' || prefs.sort === 'recent') {
      list = list.slice().sort((a, b) => {
        const at = a.lastLaunchedAt ? Date.parse(a.lastLaunchedAt) : 0
        const bt = b.lastLaunchedAt ? Date.parse(b.lastLaunchedAt) : 0
        return bt - at
      })
    } else if (prefs.sort === 'status') {
      const rank = { running: 0, starting: 1, error: 2, stopped: 3 } as const
      list = list.slice().sort((a, b) => {
        const as = states[a.id]?.status || 'stopped'
        const bs = states[b.id]?.status || 'stopped'
        return rank[as] - rank[bs] || a.name.localeCompare(b.name)
      })
    } else {
      list = list.slice().sort((a, b) => a.name.localeCompare(b.name))
    }
    return list
  }, [
    tools,
    states,
    mode,
    collection,
    tagFilter,
    statusFilter,
    query,
    prefs.sort,
  ])

  const title =
    mode === 'favorites'
      ? 'Favorites'
      : mode === 'running'
        ? 'Running'
        : mode === 'recent'
          ? 'Recent'
          : mode === 'collection'
            ? collection?.name || 'Collection'
            : mode === 'tag'
              ? `Tag · ${tag}`
              : 'Library'

  const activeFilters: { key: string; label: string; clear: () => void }[] = []
  for (const t of tagFilter) {
    activeFilters.push({
      key: `tag:${t}`,
      label: `Tag: ${t}`,
      clear: () => setTagFilter((prev) => prev.filter((x) => x !== t)),
    })
  }
  if (statusFilter !== 'all') {
    activeFilters.push({
      key: `status:${statusFilter}`,
      label: `Status: ${statusFilter}`,
      clear: () => setStatusFilter('all'),
    })
  }

  // Keep URL query in sync for shareable filter state.
  useEffect(() => {
    const next = new URLSearchParams()
    if (query.trim()) next.set('q', query.trim())
    if (tagFilter.length) next.set('tags', tagFilter.join(','))
    if (statusFilter !== 'all') next.set('status', statusFilter)
    setSearchParams(next, { replace: true })
  }, [query, tagFilter, statusFilter, setSearchParams])

  const emptyBecauseFilters =
    tools.length > 0 && filtered.length === 0
  // True zero-library welcome — hide search/filter chrome until there is something to find.
  const isFirstRun = !loading && tools.length === 0 && mode === 'all'

  const emptyCopy = emptyBecauseFilters
    ? {
        title: 'No matching tools',
        lede: 'Try clearing filters or broadening your search.',
      }
    : mode === 'favorites'
      ? {
          title: 'No favorites yet',
          lede: 'Mark a tool as favorite from its detail page to pin it here.',
        }
      : mode === 'running'
        ? {
            title: 'Nothing running',
            lede: 'Launch a tool from the library and it will show up here.',
          }
        : mode === 'recent'
          ? {
              title: 'No recent launches',
              lede: 'Tools you launch will appear here by last-run time.',
            }
          : mode === 'collection'
            ? {
                title: 'No tools in this collection',
                lede: 'Open a tool and add it to this collection, or pick another shelf.',
              }
            : {
                title: 'No tools yet',
                lede: 'Add a project Shelf can launch, stop, and remember.',
              }

  return (
    <>
      <header className="page-header page-header-compact">
        <div className="page-header-copy">
          <h1 className="page-title">{title}</h1>
          <p className="page-meta">
            {filtered.length} tool{filtered.length === 1 ? '' : 's'}
            {collection?.description ? ` · ${collection.description}` : ''}
          </p>
        </div>
        <AddToolButton />
      </header>

      {error ? (
        <div className="warning-card" role="alert" style={{ marginBottom: '1rem' }}>
          {error}
        </div>
      ) : null}

      {!isFirstRun ? (
      <div className="toolbar">
        <input
          ref={searchRef}
          className="search-input"
          type="search"
          placeholder="Search name, tags, or command"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search tools"
        />

        <div className="filter-anchor" ref={filterRef}>
          <button
            type="button"
            className={`btn btn-quiet${activeFilters.length ? ' is-active-filter' : ''}`}
            aria-expanded={filterOpen}
            aria-haspopup="dialog"
            onClick={() => setFilterOpen((v) => !v)}
          >
            Filter{activeFilters.length ? ` (${activeFilters.length})` : ''}
          </button>
          {filterOpen ? (
            <div className="filter-popover" role="dialog" aria-label="Filter tools">
              <div className="field">
                <label className="field-label" htmlFor="status-filter">
                  Status
                </label>
                <select
                  id="status-filter"
                  className="field-input"
                  value={statusFilter}
                  onChange={(e) =>
                    setStatusFilter(e.target.value as ToolStatus | 'all')
                  }
                >
                  <option value="all">All</option>
                  <option value="running">Running</option>
                  <option value="starting">Starting</option>
                  <option value="stopped">Stopped</option>
                  <option value="error">Error</option>
                </select>
              </div>
              <div className="field" style={{ marginTop: '0.75rem' }}>
                <div className="field-label">Tags</div>
                <div className="filter-tag-list">
                  {tagCounts.length === 0 ? (
                    <p className="field-hint">No tags yet.</p>
                  ) : (
                    tagCounts.map(([name, count]) => {
                      const checked = tagFilter.includes(name)
                      return (
                        <label key={name} className="filter-tag-row">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => {
                              setTagFilter((prev) =>
                                checked
                                  ? prev.filter((t) => t !== name)
                                  : [...prev, name],
                              )
                            }}
                          />
                          <span>{name}</span>
                          <span className="nav-count">{count}</span>
                        </label>
                      )
                    })
                  )}
                </div>
              </div>
            </div>
          ) : null}
        </div>

        <label className="sort-control">
          <span className="field-hint">Sort</span>
          <select
            className="field-input sort-select"
            value={prefs.sort}
            onChange={(e) =>
              void updatePrefs({ sort: e.target.value as typeof prefs.sort })
            }
            aria-label="Sort tools"
          >
            <option value="name">Name</option>
            <option value="recent">Recent</option>
            <option value="status">Status</option>
          </select>
        </label>

        <div className="view-toggle" role="group" aria-label="View mode">
          <button
            type="button"
            className={`btn btn-quiet btn-sm${prefs.viewMode === 'grid' ? ' is-selected' : ''}`}
            aria-pressed={prefs.viewMode === 'grid'}
            onClick={() => void updatePrefs({ viewMode: 'grid' })}
          >
            Grid
          </button>
          <button
            type="button"
            className={`btn btn-quiet btn-sm${prefs.viewMode === 'list' ? ' is-selected' : ''}`}
            aria-pressed={prefs.viewMode === 'list'}
            onClick={() => void updatePrefs({ viewMode: 'list' })}
          >
            List
          </button>
        </div>
      </div>
      ) : null}

      {!isFirstRun && activeFilters.length > 0 ? (
        <div className="active-filters" aria-label="Active filters">
          {activeFilters.map((f) => (
            <button
              key={f.key}
              type="button"
              className="filter-token"
              onClick={f.clear}
            >
              {f.label} ×
            </button>
          ))}
          <button
            type="button"
            className="btn btn-quiet btn-sm"
            onClick={() => {
              setTagFilter([])
              setStatusFilter('all')
            }}
          >
            Clear all
          </button>
        </div>
      ) : null}

      {mode === 'recent' ? (
        <section className="panel" style={{ marginBottom: '1rem' }}>
          <div className="panel-header">
            <h2 className="panel-title">{isDeveloper ? 'Launch receipts' : 'History'}</h2>
          </div>
          <div className="panel-body">
            <ReceiptHistory
              receipts={recentReceipts}
              showToolName
              filter={receiptFilter}
              onFilterChange={setReceiptFilter}
              exporting={receiptExporting}
              onExport={(format) => {
                setReceiptExporting(true)
                void exportReceipts(format)
                  .then((result) => {
                    if (result.saved && result.path) {
                      window.alert(`Saved receipts to ${result.path}`)
                    }
                  })
                  .finally(() => setReceiptExporting(false))
              }}
              emptyLabel="No launches yet. Start a tool to begin recording history."
            />
          </div>
        </section>
      ) : null}

      {loading ? (
        <p style={{ color: 'var(--muted)' }}>Loading library…</p>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <div>
            {isFirstRun ? (
              <>
                <h2>Your shelf is empty</h2>
                <p>
                  Drop a project folder anywhere in this window — Shelf figures
                  out how to run it.
                </p>
                <div className="empty-state-actions">
                  <AddToolButton />
                  <Link className="btn btn-quiet" to="/mcp">
                    {isDeveloper ? 'Connect agents' : 'Connect AI apps'}
                  </Link>
                </div>
                <p className="empty-state-hint">
                  Press <kbd>⌘N</kbd> to add a tool
                </p>
              </>
            ) : (
              <>
                <h2>{emptyCopy.title}</h2>
                <p>{emptyCopy.lede}</p>
                {emptyBecauseFilters ? (
                  <button
                    type="button"
                    className="btn btn-quiet"
                    onClick={() => {
                      setQuery('')
                      setTagFilter([])
                      setStatusFilter('all')
                    }}
                  >
                    Clear filters
                  </button>
                ) : null}
              </>
            )}
          </div>
        </div>
      ) : prefs.viewMode === 'list' ? (
        <div className="tool-list-wrap">
          <table className="tool-list">
            <thead>
              <tr>
                <th>Name</th>
                <th>Status</th>
                <th>Port</th>
                <th>Tags</th>
                <th>Last run</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {shownSuggestions.map((suggestion) => (
                <SuggestionListRow
                  key={`suggestion:${suggestion.gapId}:${suggestion.toolId}`}
                  suggestion={suggestion}
                />
              ))}
              {filtered.map((tool) => (
                <ToolListRow
                  key={tool.id}
                  tool={tool}
                  state={states[tool.id]}
                  health={health[tool.id]}
                  onLaunch={() => void startTool(tool.id)}
                  onStop={() => void stopTool(tool.id)}
                />
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="tool-grid">
          {shownSuggestions.map((suggestion) => (
            <SuggestionGridCard
              key={`suggestion:${suggestion.gapId}:${suggestion.toolId}`}
              suggestion={suggestion}
            />
          ))}
          {filtered.map((tool) => (
            <ToolCard
              key={tool.id}
              tool={tool}
              state={states[tool.id]}
              health={health[tool.id]}
              hideChips={!isDeveloper}
              onLaunch={() => void startTool(tool.id)}
              onStop={() => void stopTool(tool.id)}
              onOpenUrl={
                tool.url
                  ? () => void window.shelf.openUrl(tool.url!)
                  : undefined
              }
              onToggleFavorite={() =>
                void saveTool({ ...tool, favorite: !tool.favorite })
              }
            />
          ))}
        </div>
      )}
    </>
  )
}
