import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react'
import { useNavigate } from 'react-router-dom'
import { useLibrary } from '../hooks/useLibrary'
import { useReceipts } from '../hooks/useReceipts'
import { useUiMode } from '../hooks/useUiMode'
import {
  groupQuickOpenItems,
  rankQuickOpenItems,
  type QuickOpenCandidate,
} from '../lib/quickOpenSearch'
import type { ToolStatus } from '../types'

type Runnable = QuickOpenCandidate & {
  /** Primary: navigate / run action. */
  run: () => void | Promise<void>
  /** Secondary (⌘↵): launch or stop a tool when applicable. */
  runSecondary?: () => void | Promise<void>
  secondaryHint?: string
  status?: ToolStatus
}

interface QuickOpenProps {
  /** Electron has no window.prompt — parent owns the name dialog. */
  onRequestNewCollection?: () => void
}

/**
 * Command palette for tools, collections, and common nav actions.
 * Opened via View → Quick Open… (⌘K) from the Electron menu.
 */
export function QuickOpen({ onRequestNewCollection }: QuickOpenProps = {}) {
  const navigate = useNavigate()
  const { isDeveloper } = useUiMode()
  const { tools, collections, states, startTool, stopTool } = useLibrary()
  // Recent receipts for relaunch / jump-to-tool from the palette.
  const { receipts } = useReceipts({ limit: 8 })
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // Menu accelerator toggles the palette (second ⌘K closes).
  useEffect(() => {
    if (!window.shelf) return
    return window.shelf.onQuickOpen(() => {
      setOpen((prev) => !prev)
    })
  }, [])

  useEffect(() => {
    if (!open) {
      setQuery('')
      setActiveIndex(0)
      return
    }
    // Defer focus until the dialog is painted.
    const t = window.setTimeout(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    }, 0)
    return () => window.clearTimeout(t)
  }, [open])

  const candidates = useMemo((): Runnable[] => {
    const now = Date.now()
    const toolItems: Runnable[] = tools.map((tool) => {
      const status = states[tool.id]?.status || 'stopped'
      const recentMs = tool.lastLaunchedAt ? Date.parse(tool.lastLaunchedAt) : 0
      // Favorites and recently launched tools float when the query is empty.
      let boost = 0
      if (tool.favorite) boost += 40
      if (status === 'running') boost += 30
      if (recentMs) {
        const days = Math.max(0, (now - recentMs) / (1000 * 60 * 60 * 24))
        boost += Math.max(0, 25 - Math.min(days, 25))
      }

      const canToggle = status === 'running' || status === 'starting'
      return {
        id: `tool:${tool.id}`,
        kind: 'tool',
        title: tool.name,
        subtitle: [
          status === 'stopped' ? null : status,
          tool.port ? `:${tool.port}` : null,
          tool.tags.slice(0, 2).join(', ') || null,
        ]
          .filter(Boolean)
          .join(' · '),
        keywords: [
          tool.description || '',
          tool.launchCommand,
          tool.projectPath || '',
          ...tool.tags,
          ...tool.capabilities,
          ...tool.agentAccess.flatMap((access) => [
            access.kind,
            access.transport || '',
            access.entrypoint,
            access.notes || '',
          ]),
          'launch',
          'stop',
        ],
        boost,
        status,
        secondaryHint: canToggle ? '⌘↵ Stop' : '⌘↵ Launch',
        run: () => navigate(`/tools/${tool.id}`),
        runSecondary: async () => {
          if (canToggle) await stopTool(tool.id)
          else await startTool(tool.id)
        },
      }
    })

    const collectionItems: Runnable[] = collections.map((c) => ({
      id: `collection:${c.id}`,
      kind: 'collection',
      title: c.name,
      subtitle: `${c.toolIds.length} tool${c.toolIds.length === 1 ? '' : 's'}`,
      keywords: [c.description || '', 'collection'],
      boost: 10,
      run: () => navigate(`/collections/${c.id}`),
    }))

    // Deduplicate by tool — keep the newest receipt per tool for relaunch.
    const seenTools = new Set<string>()
    const receiptItems: Runnable[] = []
    for (const receipt of receipts) {
      if (seenTools.has(receipt.toolId)) continue
      seenTools.add(receipt.toolId)
      const status = states[receipt.toolId]?.status || 'stopped'
      const canToggle = status === 'running' || status === 'starting'
      receiptItems.push({
        id: `receipt:${receipt.id}`,
        kind: 'receipt',
        title: receipt.toolName,
        subtitle: [
          receipt.outcome,
          receipt.port ? `:${receipt.port}` : null,
          'recent run',
        ]
          .filter(Boolean)
          .join(' · '),
        keywords: [
          receipt.launchCommand,
          receipt.message || '',
          'receipt',
          'history',
          'relaunch',
        ],
        // Slightly below tools so empty-query still prefers live tools.
        boost: 18,
        status,
        secondaryHint: canToggle ? '⌘↵ Stop' : '⌘↵ Launch',
        run: () => navigate(`/tools/${receipt.toolId}`),
        runSecondary: async () => {
          if (canToggle) await stopTool(receipt.toolId)
          else await startTool(receipt.toolId)
        },
      })
    }

    const actions: Runnable[] = [
      {
        id: 'action:add-tool',
        kind: 'action',
        title: 'Add tool',
        subtitle: 'Register a local project',
        keywords: ['new', 'create', 'import'],
        boost: 20,
        run: () => navigate('/tools/new'),
      },
      {
        id: 'action:new-collection',
        kind: 'action',
        title: 'New collection',
        subtitle: 'Group tools into a shelf destination',
        keywords: ['folder', 'group'],
        boost: 8,
        run: () => {
          // Close palette first so the name dialog is not buried under it.
          setOpen(false)
          onRequestNewCollection?.()
        },
      },
      {
        id: 'action:library',
        kind: 'action',
        title: 'Go to Library',
        keywords: ['all', 'home', 'tools'],
        boost: 5,
        run: () => navigate('/'),
      },
      {
        id: 'action:favorites',
        kind: 'action',
        title: 'Go to Favorites',
        keywords: ['starred'],
        boost: 4,
        run: () => navigate('/favorites'),
      },
      {
        id: 'action:running',
        kind: 'action',
        title: 'Go to Running',
        keywords: ['live', 'processes'],
        boost: 4,
        run: () => navigate('/running'),
      },
      {
        id: 'action:recent',
        kind: 'action',
        title: 'Go to Recent',
        keywords: ['history'],
        boost: 4,
        run: () => navigate('/recent'),
      },
      ...(isDeveloper
        ? [
            {
              id: 'action:capability-gaps',
              kind: 'action' as const,
              title: 'Capability gaps',
              subtitle: 'Review unmet agent needs',
              keywords: ['missing tools', 'recommendations', 'capabilities', 'agent'],
              boost: 4,
              run: () => navigate('/gaps'),
            },
          ]
        : []),
      {
        id: 'action:mcp',
        kind: 'action',
        title: isDeveloper ? 'MCP Connections' : 'AI Connections',
        subtitle: 'Connect Claude, Cursor, or Codex',
        keywords: ['mcp', 'agent', 'cursor', 'claude', 'codex'],
        boost: 6,
        run: () => navigate('/mcp'),
      },
      {
        id: 'action:settings',
        kind: 'action',
        title: 'Settings',
        keywords: ['preferences', 'appearance', 'theme'],
        boost: 5,
        run: () => navigate('/settings'),
      },
    ]

    return [...toolItems, ...collectionItems, ...receiptItems, ...actions]
  }, [
    tools,
    collections,
    receipts,
    states,
    navigate,
    startTool,
    stopTool,
    onRequestNewCollection,
    isDeveloper,
  ])

  const ranked = useMemo(
    () => rankQuickOpenItems(candidates, query) as Runnable[],
    [candidates, query],
  )
  const groups = useMemo(() => groupQuickOpenItems(ranked), [ranked])

  // Flat index map for keyboard navigation across grouped rows.
  const flat = ranked

  useEffect(() => {
    setActiveIndex(0)
  }, [query, open])

  useEffect(() => {
    if (!open) return
    const el = listRef.current?.querySelector<HTMLElement>(
      `[data-qo-index="${activeIndex}"]`,
    )
    el?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, open])

  async function runPrimary(item: Runnable | undefined) {
    if (!item) return
    setOpen(false)
    await item.run()
  }

  async function runSecondary(item: Runnable | undefined) {
    if (!item?.runSecondary) return
    setOpen(false)
    await item.runSecondary()
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => Math.min(Math.max(flat.length - 1, 0), i + 1))
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => Math.max(0, i - 1))
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      const item = flat[activeIndex]
      if (e.metaKey || e.ctrlKey) void runSecondary(item)
      else void runPrimary(item)
    }
  }

  // Stable flat index per id so grouped rows stay keyboard-addressable.
  const indexById = useMemo(() => {
    const map = new Map<string, number>()
    flat.forEach((item, i) => map.set(item.id, i))
    return map
  }, [flat])

  if (!open) return null

  return (
    <div
      className="quick-open-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setOpen(false)
      }}
    >
      <div
        className="quick-open"
        role="dialog"
        aria-modal="true"
        aria-label="Quick Open"
        onKeyDown={onKeyDown}
      >
        <input
          ref={inputRef}
          className="quick-open-input"
          type="search"
          placeholder="Search tools, collections, recent runs…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-autocomplete="list"
          aria-controls="quick-open-list"
          aria-activedescendant={
            flat[activeIndex] ? `qo-${flat[activeIndex].id}` : undefined
          }
        />

        <div
          id="quick-open-list"
          ref={listRef}
          className="quick-open-list"
          role="listbox"
          aria-label="Results"
        >
          {flat.length === 0 ? (
            <p className="quick-open-empty">No matches</p>
          ) : (
            groups.map((group) => (
              <div key={group.kind} className="quick-open-group">
                <p className="quick-open-group-label">{group.label}</p>
                {(group.items as Runnable[]).map((item) => {
                  const index = indexById.get(item.id) ?? 0
                  const active = index === activeIndex
                  return (
                    <button
                      key={item.id}
                      id={`qo-${item.id}`}
                      type="button"
                      role="option"
                      aria-selected={active}
                      data-qo-index={index}
                      className={`quick-open-row${active ? ' is-active' : ''}`}
                      onMouseEnter={() => setActiveIndex(index)}
                      onClick={() => void runPrimary(item)}
                    >
                      <span className="quick-open-row-main">
                        <span className="quick-open-row-title">{item.title}</span>
                        {item.subtitle ? (
                          <span className="quick-open-row-sub">{item.subtitle}</span>
                        ) : null}
                      </span>
                      <span className="quick-open-row-meta">
                        {item.status && item.status !== 'stopped' ? (
                          <span className={`qo-status is-${item.status}`}>
                            {item.status}
                          </span>
                        ) : null}
                        {active && item.secondaryHint ? (
                          <kbd className="quick-open-kbd">{item.secondaryHint}</kbd>
                        ) : active ? (
                          <kbd className="quick-open-kbd">↵</kbd>
                        ) : null}
                      </span>
                    </button>
                  )
                })}
              </div>
            ))
          )}
        </div>

        <footer className="quick-open-foot">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> navigate
          </span>
          <span>
            <kbd>↵</kbd> open
          </span>
          <span>
            <kbd>⌘</kbd>
            <kbd>↵</kbd> launch / stop
          </span>
          <span>
            <kbd>esc</kbd> close
          </span>
        </footer>
      </div>
    </div>
  )
}
