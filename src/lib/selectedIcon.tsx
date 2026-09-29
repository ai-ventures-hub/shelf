import { lazy, useSyncExternalStore, type ComponentType } from 'react'
import type { LucideProps } from 'lucide-react'

type IconModule = { default: ComponentType<LucideProps> }
type IconLoader = () => Promise<IconModule>

const normalize = (name: string) =>
  name
    .replace(/Icon$/, '')
    .replace(/[^a-z0-9]/gi, '')
    .toLowerCase()

/**
 * The name → loader map is ~160 kB on its own, so it is fetched on the first
 * icon render instead of shipping in the entry bundle. Until it arrives,
 * ToolIcon's Suspense fallback (the tool's initial) is shown.
 */
let loaders: Map<string, IconLoader> | null = null
let loadingLoaders: Promise<Map<string, IconLoader>> | null = null
let loadFailed = false
const listeners = new Set<() => void>()
const notify = () => listeners.forEach((listener) => listener())

export function loadIconLoaders(): Promise<Map<string, IconLoader>> {
  loadingLoaders ??= import('lucide-react/dynamicIconImports').then(
    (module) => {
      loaders = new Map(
        Object.entries(module.default).map(([name, loader]) => [normalize(name), loader as IconLoader]),
      )
      loadFailed = false
      notify()
      return loaders
    },
    (error) => {
      // Letters stand in until a later call (the picker's retry) succeeds.
      loadingLoaders = null
      loadFailed = true
      notify()
      throw error
    },
  )
  return loadingLoaders
}

/**
 * Re-render when the icon map arrives or fails, so a memoized card swaps a
 * placeholder for its real icon, or an unknown name for its letter.
 */
export function useIconLoaderState(): 'loading' | 'ready' | 'failed' {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => (loaders ? 'ready' : loadFailed ? 'failed' : 'loading'),
  )
}

const Missing: ComponentType<LucideProps> = () => <span>◆</span>
const cache = new Map<string, ComponentType<LucideProps>>()

export function selectedIcon(name?: string): ComponentType<LucideProps> | null {
  if (!name) return null
  const key = normalize(name)
  // Once the map is known, an unknown name falls back to the image or letter;
  // if it could not load, every icon does.
  if ((loaders && !loaders.has(key)) || loadFailed) return null
  let icon = cache.get(key)
  if (!icon) {
    icon = lazy<ComponentType<LucideProps>>(async () => {
      // Never throw into the router's error page over an icon.
      const loader = (await loadIconLoaders().catch(() => null))?.get(key)
      if (!loader) {
        cache.delete(key)
        return { default: Missing }
      }
      return loader().catch(() => ({ default: Missing }))
    })
    cache.set(key, icon)
  }
  return icon
}
