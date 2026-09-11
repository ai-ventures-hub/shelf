import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type {
  Collection,
  LogLine,
  StartOptions,
  Tool,
  ToolHealth,
  ToolRuntimeState,
} from '../types'

interface LibraryContextValue {
  tools: Tool[]
  collections: Collection[]
  states: Record<string, ToolRuntimeState>
  health: Record<string, ToolHealth>
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
  saveTool: (tool: Tool) => Promise<Tool>
  deleteTool: (id: string) => Promise<void>
  saveCollection: (collection: Collection) => Promise<Collection>
  deleteCollection: (id: string) => Promise<void>
  startTool: (id: string, options?: StartOptions) => Promise<void>
  stopTool: (id: string) => Promise<void>
  restartTool: (id: string) => Promise<void>
  getLogs: (id: string) => Promise<LogLine[]>
  subscribeLogs: (id: string, cb: (line: LogLine) => void) => () => void
}

const LibraryContext = createContext<LibraryContextValue | null>(null)

function hasShelfApi(): boolean {
  return typeof window !== 'undefined' && Boolean(window.shelf)
}

export function LibraryProvider({ children }: { children: ReactNode }) {
  const [tools, setTools] = useState<Tool[]>([])
  const [collections, setCollections] = useState<Collection[]>([])
  const [states, setStates] = useState<Record<string, ToolRuntimeState>>({})
  const [health, setHealth] = useState<Record<string, ToolHealth>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const healthTimerRef = useRef<number | null>(null)

  const refreshHealth = useCallback(async () => {
    if (!window.shelf?.getToolHealth) return
    try {
      const list = await window.shelf.getToolHealth()
      setHealth(Object.fromEntries(list.map((h) => [h.toolId, h])))
    } catch {
      // Glyphs are advisory — a failed scan must never break the library view.
    }
  }, [])

  const refresh = useCallback(async () => {
    if (!hasShelfApi()) {
      setError('Shelf is running outside Electron. Launch with npm run electron:dev.')
      setLoading(false)
      return
    }
    try {
      const [nextTools, nextStates, nextCollections] = await Promise.all([
        window.shelf.listTools(),
        window.shelf.getRuntimeStates(),
        window.shelf.listCollections(),
      ])
      setTools(nextTools)
      setCollections(nextCollections)
      setStates(Object.fromEntries(nextStates.map((s) => [s.toolId, s])))
      setError(await window.shelf.getLibraryRecovery())
      void refreshHealth()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [refreshHealth])

  // Agents add/edit tools through the MCP server (a separate process); the
  // main process watches the shared store and tells us to re-read.
  useEffect(() => {
    if (!window.shelf?.onExternalDataChange) return
    return window.shelf.onExternalDataChange((filename) => {
      if (filename === 'library.json') void refresh()
    })
  }, [refresh])

  useEffect(() => {
    void refresh()
    if (!hasShelfApi()) return

    const offRuntime = window.shelf.onRuntimeUpdate((state) => {
      setStates((prev) => ({ ...prev, [state.toolId]: state }))
      // Start/stop changes what counts as a port conflict — refresh the
      // launchability glyphs, debounced across bursts of updates.
      if (healthTimerRef.current !== null) window.clearTimeout(healthTimerRef.current)
      healthTimerRef.current = window.setTimeout(() => {
        healthTimerRef.current = null
        void refreshHealth()
      }, 400)
    })
    return () => {
      offRuntime()
      if (healthTimerRef.current !== null) window.clearTimeout(healthTimerRef.current)
    }
  }, [refresh, refreshHealth])

  const saveTool = useCallback(
    async (tool: Tool) => {
      const saved = await window.shelf.saveTool(tool)
      await refresh()
      return saved
    },
    [refresh],
  )

  const deleteTool = useCallback(
    async (id: string) => {
      await window.shelf.deleteTool(id)
      await refresh()
    },
    [refresh],
  )

  const saveCollection = useCallback(
    async (collection: Collection) => {
      const saved = await window.shelf.saveCollection(collection)
      await refresh()
      return saved
    },
    [refresh],
  )

  const deleteCollection = useCallback(
    async (id: string) => {
      await window.shelf.deleteCollection(id)
      await refresh()
    },
    [refresh],
  )

  // Port reassignment is an explicit recovery action in either presentation mode.
  const startTool = useCallback(
    async (id: string, options?: StartOptions) => {
      const state = await window.shelf.startTool(
        id,
        options,
      )
      setStates((prev) => ({ ...prev, [id]: state }))
      const nextTools = await window.shelf.listTools()
      setTools(nextTools)
    },
    [],
  )

  const stopTool = useCallback(async (id: string) => {
    const state = await window.shelf.stopTool(id)
    setStates((prev) => ({ ...prev, [id]: state }))
  }, [])

  const restartTool = useCallback(async (id: string) => {
    const state = await window.shelf.restartTool(id)
    setStates((prev) => ({ ...prev, [id]: state }))
  }, [])

  const getLogs = useCallback(async (id: string) => {
    return window.shelf.getLogs(id)
  }, [])

  const subscribeLogs = useCallback((id: string, cb: (line: LogLine) => void) => {
    return window.shelf.onLogLine((line) => {
      if (line.toolId === id) cb(line)
    })
  }, [])

  const value = useMemo(
    () => ({
      tools,
      collections,
      states,
      health,
      loading,
      error,
      refresh,
      saveTool,
      deleteTool,
      saveCollection,
      deleteCollection,
      startTool,
      stopTool,
      restartTool,
      getLogs,
      subscribeLogs,
    }),
    [
      tools,
      collections,
      states,
      health,
      loading,
      error,
      refresh,
      saveTool,
      deleteTool,
      saveCollection,
      deleteCollection,
      startTool,
      stopTool,
      restartTool,
      getLogs,
      subscribeLogs,
    ],
  )

  return <LibraryContext.Provider value={value}>{children}</LibraryContext.Provider>
}

export function useLibrary(): LibraryContextValue {
  const ctx = useContext(LibraryContext)
  if (!ctx) throw new Error('useLibrary must be used within LibraryProvider')
  return ctx
}
