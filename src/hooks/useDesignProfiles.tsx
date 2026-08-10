/**
 * Design profiles context (useLibrary model). One provider because the shell
 * (nav count, QuickOpen), both /design pages, and the collection binding
 * picker all read the same list; mutations follow "IPC → await refresh()".
 * Live updates ride the main process's data-root watcher — agents never
 * write profiles, but the seed script and hand edits do.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import type {
  DesignAsset,
  DesignAssetKind,
  DesignProfile,
  SaveDesignProfileInput,
} from '../types'

interface DesignProfilesContextValue {
  profiles: DesignProfile[]
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
  saveProfile: (input: SaveDesignProfileInput) => Promise<DesignProfile>
  deleteProfile: (id: string) => Promise<void>
  setDefaultProfile: (id: string) => Promise<DesignProfile>
  pickAsset: (profileId: string, kind: DesignAssetKind) => Promise<DesignAsset | null>
  importAsset: (
    profileId: string,
    sourcePath: string,
    kind: DesignAssetKind,
  ) => Promise<DesignAsset>
  removeAsset: (profileId: string, assetPath: string) => Promise<void>
}

const DesignProfilesContext = createContext<DesignProfilesContextValue | null>(null)

function hasShelfApi(): boolean {
  return typeof window !== 'undefined' && Boolean(window.shelf?.listDesignProfiles)
}

export function DesignProfilesProvider({ children }: { children: ReactNode }) {
  const [profiles, setProfiles] = useState<DesignProfile[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!hasShelfApi()) {
      setLoading(false)
      return
    }
    try {
      setProfiles(await window.shelf.listDesignProfiles())
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
    if (!window.shelf?.onExternalDataChange) return
    return window.shelf.onExternalDataChange((filename) => {
      if (filename === 'design-profiles.json') void refresh()
    })
  }, [refresh])

  const saveProfile = useCallback(
    async (input: SaveDesignProfileInput) => {
      const saved = await window.shelf.saveDesignProfile(input)
      await refresh()
      return saved
    },
    [refresh],
  )

  const deleteProfile = useCallback(
    async (id: string) => {
      await window.shelf.deleteDesignProfile(id)
      await refresh()
    },
    [refresh],
  )

  const setDefaultProfile = useCallback(
    async (id: string) => {
      const saved = await window.shelf.setDefaultDesignProfile(id)
      await refresh()
      return saved
    },
    [refresh],
  )

  const pickAsset = useCallback(
    async (profileId: string, kind: DesignAssetKind) => {
      const asset = await window.shelf.pickDesignAsset(profileId, kind)
      if (asset) await refresh()
      return asset
    },
    [refresh],
  )

  const importAsset = useCallback(
    async (profileId: string, sourcePath: string, kind: DesignAssetKind) => {
      const asset = await window.shelf.importDesignAsset(profileId, sourcePath, kind)
      await refresh()
      return asset
    },
    [refresh],
  )

  const removeAsset = useCallback(
    async (profileId: string, assetPath: string) => {
      await window.shelf.removeDesignAsset(profileId, assetPath)
      await refresh()
    },
    [refresh],
  )

  const value = useMemo(
    () => ({
      profiles,
      loading,
      error,
      refresh,
      saveProfile,
      deleteProfile,
      setDefaultProfile,
      pickAsset,
      importAsset,
      removeAsset,
    }),
    [
      profiles,
      loading,
      error,
      refresh,
      saveProfile,
      deleteProfile,
      setDefaultProfile,
      pickAsset,
      importAsset,
      removeAsset,
    ],
  )

  return (
    <DesignProfilesContext.Provider value={value}>{children}</DesignProfilesContext.Provider>
  )
}

export function useDesignProfiles(): DesignProfilesContextValue {
  const ctx = useContext(DesignProfilesContext)
  if (!ctx) throw new Error('useDesignProfiles must be used within DesignProfilesProvider')
  return ctx
}
