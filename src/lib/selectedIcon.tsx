import { lazy, type ComponentType } from 'react'
import type { LucideProps } from 'lucide-react'
import dynamicIconImports from 'lucide-react/dynamicIconImports'

const normalize = (name: string) =>
  name
    .replace(/Icon$/, '')
    .replace(/[^a-z0-9]/gi, '')
    .toLowerCase()
const loaders = new Map(
  Object.entries(dynamicIconImports).map(([name, loader]) => [normalize(name), loader]),
)
const cache = new Map<string, ComponentType<LucideProps>>()
export function selectedIcon(name?: string): ComponentType<LucideProps> | null {
  if (!name) return null
  const key = normalize(name)
  const loader = loaders.get(key)
  if (!loader) return null
  if (!cache.has(key))
    cache.set(
      key,
      lazy<ComponentType<LucideProps>>(() =>
        loader().catch(() => ({ default: () => <span>◆</span> })),
      ),
    )
  return cache.get(key)!
}
