import { ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { Link, NavLink, useNavigate } from 'react-router-dom'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useLibrary } from '../hooks/useLibrary'
import { useCapabilityGaps } from '../hooks/useCapabilityGaps'
import { useDesignProfiles } from '../hooks/useDesignProfiles'
import { STARTER_TOKENS } from '../lib/designTokens'
import { usePrefs } from '../hooks/usePrefs'
import { useUiMode } from '../hooks/useUiMode'
import { NamePromptDialog } from './NamePromptDialog'
import { QuickOpen } from './QuickOpen'
import { AddSharedToolDialog } from './sharing/AddSharedToolDialog'
import { onAddSharedRequest, type AddSharedRequest } from '../lib/sharingEvents'
import { ShelfMark } from './ShelfMark'
import { UpdateBanner } from './UpdateBanner'

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
    case 'gaps':
      return (
        <svg {...common}>
          <path d="M12 3 2.8 20h18.4L12 3z" />
          <path d="M12 9v5M12 17.2h.01" />
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
    case 'design':
      // Overlapping swatch circles — a palette without the painter's kitsch.
      return (
        <svg {...common}>
          <circle cx="9" cy="9" r="5.5" />
          <circle cx="15" cy="13" r="5.5" />
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
  const { tools, collections, states, saveCollection, refresh } = useLibrary()
  const { prefs, updatePrefs } = usePrefs()
  const { isDeveloper } = useUiMode()
  const mcpLabel = isDeveloper ? 'MCP Connections' : 'AI Connections'
  const { gaps: openGaps } = useCapabilityGaps({ status: 'open', limit: 200 })
  const { profiles: designProfiles, saveProfile: saveDesignProfile } = useDesignProfiles()
  const dragRef = useRef<{
    startX: number
    startWidth: number
    currentWidth: number
  } | null>(null)
  const collapsed = prefs.sidebarCollapsed
  // Electron has no window.prompt — use an in-app dialog instead.
  const [collectionPromptOpen, setCollectionPromptOpen] = useState(false)
  const [designPromptOpen, setDesignPromptOpen] = useState(false)
  // Status line while a dropped folder is being registered/launched.
  const [dropBusy, setDropBusy] = useState<string | null>(null)
  // Add-shared-tool sheet (Tool Sharing): opened by the Library page buttons
  // or a shelf://add link; hosted here so it works from every route.
  const [addShared, setAddShared] = useState<AddSharedRequest | null>(null)
  // Highlight the window as a drop target while files are dragged over it.
  // Counter, not boolean: dragenter/dragleave fire per child element.
  const dragDepth = useRef(0)
  const [dragActive, setDragActive] = useState(false)

  const favorites = tools.filter((t) => t.favorite).length
  const running = Object.values(states).filter((s) => s.status === 'running').length
  const recent = tools.filter((t) => t.lastLaunchedAt).length

  useEffect(() => {
    if (!window.shelf) return
    const offNav = window.shelf.onNavigate((route) => navigate(route))
    return () => offNav()
  }, [navigate])

  useEffect(() => {
    const offLocal = onAddSharedRequest((detail) => setAddShared({ ...detail }))
    const offLink = window.shelf?.onAddShared
      ? window.shelf.onAddShared((info) => setAddShared({ repo: info.repo }))
      : () => {}
    return () => {
      offLocal()
      offLink()
    }
  }, [])

  function onResizeStart(e: React.MouseEvent) {
    if (collapsed) return
    dragRef.current = {
      startX: e.clientX,
      startWidth: prefs.sidebarWidth,
      currentWidth: prefs.sidebarWidth,
    }
    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return
      const next = dragRef.current.startWidth + (ev.clientX - dragRef.current.startX)
      dragRef.current.currentWidth = Math.min(280, Math.max(210, next))
      document.documentElement.style.setProperty(
        '--sidebar-width',
        `${dragRef.current.currentWidth}px`,
      )
    }
    const onUp = () => {
      const width = dragRef.current?.currentWidth
      dragRef.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      if (width !== undefined) void updatePrefs({ sidebarWidth: width })
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  /** Drop a project folder anywhere on the window → register + launch. */
  async function handleDroppedFolder(file: File) {
    if (!window.shelf?.registerProject || !window.shelf.getPathForFile) return
    const dropped = window.shelf.getPathForFile(file)
    if (!dropped) return
    setDropBusy('Looking at that folder…')
    try {
      let result = await window.shelf.registerProject(dropped)
      if (result.outcome === 'invalid_folder') {
        window.alert(
          result.issues[0]?.message ||
            "Shelf can't use that item — drop a project folder.",
        )
        return
      }
      if (result.outcome === 'needs_setup') {
        const docker = result.issues.find((i) => i.code === 'docker_not_running')
        const steps = result.setupNeeds.map((s) => s.label).join(', ')
        if (docker) {
          window.alert(
            `${docker.message} Start it, then launch the tool from its page.`,
          )
        } else if (
          steps &&
          window.confirm(`${steps} and run? This can take a few minutes.`)
        ) {
          setDropBusy('Installing — watch progress in Live logs…')
          result = await window.shelf.registerProject(dropped, { runSetup: true })
        }
      }
      await refresh()
      if (result.tool) {
        navigate(
          result.outcome === 'saved_needs_review'
            ? `/tools/${result.tool.id}/edit`
            : `/tools/${result.tool.id}`,
        )
      }
    } finally {
      setDropBusy(null)
    }
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

  async function createDesignProfile(name: string) {
    const saved = await saveDesignProfile({ name: name.trim(), tokens: STARTER_TOKENS })
    setDesignPromptOpen(false)
    navigate(`/design/${saved.id}`)
  }

  return (
    <div
      className={`app-shell${collapsed ? ' is-sidebar-collapsed' : ''}`}
      onDragEnter={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return
        dragDepth.current += 1
        setDragActive(true)
      }}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1)
        if (dragDepth.current === 0) setDragActive(false)
      }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) e.preventDefault()
      }}
      onDrop={(e) => {
        dragDepth.current = 0
        setDragActive(false)
        const file = e.dataTransfer.files[0]
        if (!file || dropBusy) return
        e.preventDefault()
        void handleDroppedFolder(file)
      }}
    >
      <UpdateBanner />
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
            className="btn btn-quiet btn-sm btn-icon sidebar-toggle"
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            onClick={() => void updatePrefs({ sidebarCollapsed: !collapsed })}
          >
            {collapsed ? (
              <ChevronRight size={15} aria-hidden />
            ) : (
              <ChevronLeft size={15} aria-hidden />
            )}
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
          {isDeveloper ? (
            <NavLink
              to="/gaps"
              className={({ isActive }) => `nav-item${isActive ? ' is-active' : ''}`}
              title="Capability gaps"
              aria-label="Capability gaps"
            >
              <NavIcon name="gaps" />
              <NavLabel collapsed={collapsed}>Capability gaps</NavLabel>
              <NavCount collapsed={collapsed} value={openGaps.length} />
            </NavLink>
          ) : null}

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

          {/* Design: brand profiles — headline feature, visible in both modes. */}
          {!collapsed ? <p className="nav-label">Design</p> : <div className="nav-divider" />}
          <NavLink
            to="/design"
            className={({ isActive }) => `nav-item${isActive ? ' is-active' : ''}`}
            title="Design profiles"
            aria-label="Design profiles"
          >
            <NavIcon name="design" />
            <NavLabel collapsed={collapsed}>Profiles</NavLabel>
            <NavCount collapsed={collapsed} value={designProfiles.length} />
          </NavLink>

          {/* System: MCP + Settings once each — never duplicate Connect chrome. */}
          {!collapsed ? <p className="nav-label">System</p> : <div className="nav-divider" />}
          <NavLink
            to="/mcp"
            className={({ isActive }) => `nav-item${isActive ? ' is-active' : ''}`}
            title={mcpLabel}
            aria-label={mcpLabel}
          >
            <NavIcon name="mcp" />
            <NavLabel collapsed={collapsed}>{mcpLabel}</NavLabel>
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

      {dragActive && !dropBusy ? (
        <div className="drop-overlay" aria-hidden>
          <div className="drop-overlay-label">
            Drop a project folder to add it
          </div>
        </div>
      ) : null}

      {dropBusy ? (
        <div className="drop-progress" role="status" aria-live="polite">
          {dropBusy}
        </div>
      ) : null}

      {/* Global ⌘K palette — mounted once so it works from every route. */}
      <QuickOpen
        onRequestNewCollection={() => setCollectionPromptOpen(true)}
        onRequestNewDesignProfile={() => setDesignPromptOpen(true)}
      />

      <AddSharedToolDialog
        open={addShared !== null}
        initialRepo={addShared?.repo}
        initialBundlePath={addShared?.bundlePath}
        onClose={() => setAddShared(null)}
      />

      <NamePromptDialog
        open={collectionPromptOpen}
        title="New collection"
        label="Collection name"
        placeholder="e.g. Client tools"
        confirmLabel="Create"
        onCancel={() => setCollectionPromptOpen(false)}
        onConfirm={createCollection}
      />
      <NamePromptDialog
        open={designPromptOpen}
        title="New design profile"
        label="Profile name"
        placeholder="e.g. Acme Studio"
        confirmLabel="Create"
        onCancel={() => setDesignPromptOpen(false)}
        onConfirm={createDesignProfile}
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
      {compact ? <Plus size={17} aria-hidden /> : 'Add tool'}
    </Link>
  )
}
