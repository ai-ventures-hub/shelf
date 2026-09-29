import { lazy, type ComponentType } from 'react'
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
export function loadIconLoaders(): Promise<Map<string, IconLoader>> {
  loadingLoaders ??= import('lucide-react/dynamicIconImports').then((module) => {
    loaders = new Map(
      Object.entries(module.default).map(([name, loader]) => [normalize(name), loader as IconLoader]),
    )
    return loaders
  })
  return loadingLoaders
}

const Missing: ComponentType<LucideProps> = () => <span>◆</span>
const cache = new Map<string, ComponentType<LucideProps>>()

export function selectedIcon(name?: string): ComponentType<LucideProps> | null {
  if (!name) return null
  const key = normalize(name)
  // Once the map is known, an unknown name falls back to the image or letter.
  if (loaders && !loaders.has(key)) return null
  let icon = cache.get(key)
  if (!icon) {
    icon = lazy<ComponentType<LucideProps>>(async () => {
      const loader = (await loadIconLoaders()).get(key)
      if (!loader) return { default: Missing }
      return loader().catch(() => ({ default: Missing }))
    })
    cache.set(key, icon)
  }
  return icon
}
