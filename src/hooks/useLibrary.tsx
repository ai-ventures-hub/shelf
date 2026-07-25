import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type { Collection, LogLine, Tool, ToolRuntimeState } from '../types'

interface LibraryContextValue {
  tools: Tool[]
  collections: Collection[]
  states: Record<string, ToolRuntimeState>
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
  saveTool: (tool: Tool) => Promise<Tool>
  deleteTool: (id: string) => Promise<void>
  saveCollection: (collection: Collection) => Promise<Collection>
  deleteCollection: (id: string) => Promise<void>
  startTool: (id: string) => Promise<void>
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
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

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
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
    if (!hasShelfApi()) return

    const offRuntime = window.shelf.onRuntimeUpdate((state) => {
      setStates((prev) => ({ ...prev, [state.toolId]: state }))
    })
    return () => offRuntime()
  }, [refresh])

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

  const startTool = useCallback(async (id: string) => {
    const state = await window.shelf.startTool(id)
    setStates((prev) => ({ ...prev, [id]: state }))
    const nextTools = await window.shelf.listTools()
    setTools(nextTools)
  }, [])

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
