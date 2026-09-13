/**
 * Appearance / layout preferences shared across the desktop shell.
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
import type { AppearanceMode, ShortcutStatus, UiPrefs } from '../types'

import { DEFAULT_UI_PREFS } from '../../shared/types'

interface PrefsContextValue {
  prefs: UiPrefs
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
  updatePrefs: (patch: Partial<UiPrefs>) => Promise<void>
  resolvedTheme: 'light' | 'dark'
  /** Latest global hotkey registration result (null until main reports). */
  shortcutStatus: ShortcutStatus | null
}

const PrefsContext = createContext<PrefsContextValue | null>(null)

function resolveTheme(mode: AppearanceMode): 'light' | 'dark' {
  if (mode === 'light') return 'light'
  if (mode === 'dark') return 'dark'
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

export function PrefsProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<UiPrefs>(DEFAULT_UI_PREFS)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [shortcutStatus, setShortcutStatus] = useState<ShortcutStatus | null>(null)
  const [systemLight, setSystemLight] = useState(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-color-scheme: light)').matches,
  )

  const refresh = useCallback(async () => {
    if (!window.shelf) { setLoading(false); return }
    try { const [next, shortcut] = await Promise.all([window.shelf.getPrefs(), window.shelf.getShortcutStatus()]); setPrefs(next); setShortcutStatus(shortcut); setError(null) }
    catch { setError('Could not read preferences. Retry before changing settings.') }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { void refresh() }, [refresh])

  useEffect(() => {
    if (!window.shelf?.onShortcutStatus) return
    return window.shelf.onShortcutStatus(setShortcutStatus)
  }, [])

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: light)')
    const onChange = () => setSystemLight(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const resolvedTheme: 'light' | 'dark' =
    prefs.appearance === 'system'
      ? systemLight
        ? 'light'
        : 'dark'
      : prefs.appearance === 'light'
        ? 'light'
        : 'dark'

  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme
    document.documentElement.style.colorScheme = resolvedTheme
  }, [resolvedTheme])

  useEffect(() => {
    document.documentElement.style.setProperty(
      '--sidebar-width',
      prefs.sidebarCollapsed ? '64px' : `${prefs.sidebarWidth}px`,
    )
  }, [prefs.sidebarCollapsed, prefs.sidebarWidth])

  const updatePrefs = useCallback(async (patch: Partial<UiPrefs>) => {
    if (!window.shelf) {
      setPrefs((prev) => ({ ...prev, ...patch }))
      return
    }
    try {
      const result = await window.shelf.updatePrefs(patch)
      setPrefs(result.prefs)
      if (result.shortcutStatus) setShortcutStatus(result.shortcutStatus)
      setError(null)
    } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
  }, [])

  const value = useMemo(
    () => ({ prefs, loading, error, refresh, updatePrefs, resolvedTheme, shortcutStatus }),
    [prefs, loading, error, refresh, updatePrefs, resolvedTheme, shortcutStatus],
  )

  return <PrefsContext.Provider value={value}>{children}</PrefsContext.Provider>
}

export function usePrefs(): PrefsContextValue {
  const ctx = useContext(PrefsContext)
  if (!ctx) throw new Error('usePrefs must be used within PrefsProvider')
  return ctx
}

// Keep resolveTheme available for tests / non-hook callers.
export { resolveTheme }
