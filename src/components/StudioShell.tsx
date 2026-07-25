import { Link, NavLink, useNavigate } from 'react-router-dom'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useLibrary } from '../hooks/useLibrary'
import { usePrefs } from '../hooks/usePrefs'
import { NamePromptDialog } from './NamePromptDialog'
import { QuickOpen } from './QuickOpen'
import { ShelfMark } from './ShelfMark'

/** Compact SVG marks used when the sidebar is collapsed to an icon rail. */
function NavIcon({ name }: { name: string }) {
  const common = {
    width: 18,
    height: 18,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  }

  switch (name) {
    case 'all':
      return (
        <svg {...common}>
          <rect x="3" y="3" width="7" height="7" rx="1.5" />
          <rect x="14" y="3" width="7" height="7" rx="1.5" />
          <rect x="3" y="14" width="7" height="7" rx="1.5" />
          <rect x="14" y="14" width="7" height="7" rx="1.5" />
        </svg>
      )
    case 'favorites':
      return (
        <svg {...common}>
          <path d="M12 3.5 14.6 9l6 .9-4.3 4.2 1 5.9L12 17.2 6.7 20l1-5.9L3.4 9.9l6-.9L12 3.5z" />
        </svg>
      )
    case 'running':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8" />
          <circle cx="12" cy="12" r="3" fill="currentColor" stroke="none" />
        </svg>
      )
    case 'recent':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8" />
          <path d="M12 7v5l3 2" />
        </svg>
      )
    case 'collection':
      return (
        <svg {...common}>
          <path d="M4 7h16M4 12h16M4 17h10" />
        </svg>
      )
    case 'new':
      return (
        <svg {...common}>
          <path d="M12 5v14M5 12h14" />
        </svg>
      )
    case 'mcp':
      // Plug / connector — clearer than the old rack glyph at small sizes.
      return (
        <svg {...common}>
          <path d="M9 2v5M15 2v5" />
          <path d="M7 7h10v4a5 5 0 0 1-10 0V7z" />
          <path d="M12 16v6" />
        </svg>
      )
    case 'settings':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3" />
          <path d="M12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21M5.6 5.6l1.6 1.6M16.8 16.8l1.6 1.6M18.4 5.6l-1.6 1.6M7.2 16.8l-1.6 1.6" />
        </svg>
      )
    default:
      return null
  }
}

function NavLabel({
  collapsed,
  children,
}: {
  collapsed: boolean
  children: ReactNode
}) {
  return collapsed ? null : <span className="nav-label-text">{children}</span>
}

function NavCount({ collapsed, value }: { collapsed: boolean; value: number }) {
  if (collapsed) return null
  return <span className="nav-count">{value}</span>
}

export function StudioShell({ children }: { children: ReactNode }) {
  const navigate = useNavigate()
  const { tools, collections, states, saveCollection } = useLibrary()
  const { prefs, updatePrefs } = usePrefs()
  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null)
  const collapsed = prefs.sidebarCollapsed
  // Electron has no window.prompt — use an in-app dialog instead.
  const [collectionPromptOpen, setCollectionPromptOpen] = useState(false)

  const favorites = tools.filter((t) => t.favorite).length
  const running = Object.values(states).filter((s) => s.status === 'running').length
  const recent = tools.filter((t) => t.lastLaunchedAt).length

  useEffect(() => {
    if (!window.shelf) return
    const offNav = window.shelf.onNavigate((route) => navigate(route))
    return () => offNav()
  }, [navigate])

  function onResizeStart(e: React.MouseEvent) {
    if (collapsed) return
    dragRef.current = { startX: e.clientX, startWidth: prefs.sidebarWidth }
    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return
      const next = dragRef.current.startWidth + (ev.clientX - dragRef.current.startX)
      void updatePrefs({ sidebarWidth: Math.min(280, Math.max(210, next)) })
    }
    const onUp = () => {
      dragRef.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  async function createCollection(name: string) {
    const now = new Date().toISOString()
    const saved = await saveCollection({
      id: crypto.randomUUID(),
      name: name.trim(),
      toolIds: [],
      createdAt: now,
      updatedAt: now,
    })
    setCollectionPromptOpen(false)
    navigate(`/collections/${saved.id}`)
  }

  return (
    <div className={`app-shell${collapsed ? ' is-sidebar-collapsed' : ''}`}>
      <aside className="sidebar" aria-label="Shelf navigation">
        <div className="brand-row">
          {!collapsed ? <ShelfMark /> : null}
          {!collapsed ? (
            <div className="brand-copy">
              <div className="brand-name">Shelf</div>
              <div className="brand-sub">Local tools</div>
            </div>
          ) : null}
          <button
            type="button"
            className="btn btn-quiet btn-sm sidebar-toggle"
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            onClick={() => void updatePrefs({ sidebarCollapsed: !collapsed })}
          >
            {collapsed ? '›' : '‹'}
          </button>
        </div>

        <nav className="nav" aria-label="Primary">
          {!collapsed ? <p className="nav-label">Library</p> : null}
          <NavLink
            to="/"
            end
            className={({ isActive }) => `nav-item${isActive ? ' is-active' : ''}`}
            title="All tools"
            aria-label="All tools"
          >
            <NavIcon name="all" />
            <NavLabel collapsed={collapsed}>All tools</NavLabel>
            <NavCount collapsed={collapsed} value={tools.length} />
          </NavLink>
          <NavLink
            to="/favorites"
            className={({ isActive }) => `nav-item${isActive ? ' is-active' : ''}`}
            title="Favorites"
            aria-label="Favorites"
          >
            <NavIcon name="favorites" />
            <NavLabel collapsed={collapsed}>Favorites</NavLabel>
            <NavCount collapsed={collapsed} value={favorites} />
          </NavLink>
          <NavLink
            to="/running"
            className={({ isActive }) => `nav-item${isActive ? ' is-active' : ''}`}
            title="Running"
            aria-label="Running"
          >
            <NavIcon name="running" />
            <NavLabel collapsed={collapsed}>Running</NavLabel>
            <NavCount collapsed={collapsed} value={running} />
          </NavLink>
          <NavLink
            to="/recent"
            className={({ isActive }) => `nav-item${isActive ? ' is-active' : ''}`}
            title="Recent"
            aria-label="Recent"
          >
            <NavIcon name="recent" />
            <NavLabel collapsed={collapsed}>Recent</NavLabel>
            <NavCount collapsed={collapsed} value={recent} />
          </NavLink>

          {!collapsed ? <p className="nav-label">Collections</p> : <div className="nav-divider" />}
          {collections.map((c) => (
            <NavLink
              key={c.id}
              to={`/collections/${c.id}`}
              className={({ isActive }) => `nav-item${isActive ? ' is-active' : ''}`}
              title={c.name}
              aria-label={c.name}
            >
              <NavIcon name="collection" />
              <NavLabel collapsed={collapsed}>{c.name}</NavLabel>
              <NavCount collapsed={collapsed} value={c.toolIds.length} />
            </NavLink>
          ))}
          <button
            type="button"
            className="nav-item"
            onClick={() => setCollectionPromptOpen(true)}
            title="New collection"
            aria-label="New collection"
          >
            <NavIcon name="new" />
            <NavLabel collapsed={collapsed}>New collection</NavLabel>
          </button>

          {/* System: MCP + Settings once each — never duplicate Connect chrome. */}
          {!collapsed ? <p className="nav-label">System</p> : <div className="nav-divider" />}
          <NavLink
            to="/mcp"
            className={({ isActive }) => `nav-item${isActive ? ' is-active' : ''}`}
            title="MCP Connections"
            aria-label="MCP Connections"
          >
            <NavIcon name="mcp" />
            <NavLabel collapsed={collapsed}>MCP Connections</NavLabel>
          </NavLink>
          <NavLink
            to="/settings"
            className={({ isActive }) => `nav-item${isActive ? ' is-active' : ''}`}
            title="Settings"
            aria-label="Settings"
          >
            <NavIcon name="settings" />
            <NavLabel collapsed={collapsed}>Settings</NavLabel>
          </NavLink>
        </nav>
        {/* Settings lives under System above — no duplicate foot link. */}
      </aside>

      {!collapsed ? (
        <div
          className="sidebar-resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          onMouseDown={onResizeStart}
        />
      ) : (
        <div className="sidebar-resizer is-disabled" aria-hidden />
      )}

      <main className="content">
        <div className="content-inner">{children}</div>
      </main>

      {/* Global ⌘K palette — mounted once so it works from every route. */}
      <QuickOpen onRequestNewCollection={() => setCollectionPromptOpen(true)} />

      <NamePromptDialog
        open={collectionPromptOpen}
        title="New collection"
        label="Collection name"
        placeholder="e.g. Client tools"
        confirmLabel="Create"
        onCancel={() => setCollectionPromptOpen(false)}
        onConfirm={createCollection}
      />
    </div>
  )
}

/** Shared header action used on library empty/list states. */
export function AddToolButton({ compact = false }: { compact?: boolean }) {
  return (
    <Link
      className={`btn btn-primary${compact ? ' btn-icon' : ''}`}
      to="/tools/new"
      aria-label="Add tool"
      title="Add tool"
    >
      {compact ? '+' : 'Add tool'}
    </Link>
  )
}
