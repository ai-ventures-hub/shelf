/** Icon names are metadata; SVG code loads only for icons actually rendered. */
import { selectedIcon } from './selectedIcon'

let names: Promise<string[]> | null = null

/** All Lucide icon names (PascalCase), fetched the first time the picker opens. */
export function loadLucideNames(): Promise<string[]> {
  names ??= import('lucide-react/dynamicIconImports').then((module) =>
    [
      ...new Map(
        Object.keys(module.default)
          .map((name) =>
            name
              .split('-')
              .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
              .join(''),
          )
          .map((name) => [name.toLowerCase(), name]),
      ).values(),
    ].sort((a, b) => a.localeCompare(b)),
  ).catch((err: unknown) => {
    // Let the next open retry instead of caching the failure.
    names = null
    throw err
  })
  return names
}

export const getLucideIcon = selectedIcon

/** "ArrowUpRight" → "Arrow Up Right" for picker labels. */
export function humanizeLucideName(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
}

/** Case-insensitive substring filter for the picker search box. */
export function filterLucideNames(all: readonly string[], query: string, limit = 180): string[] {
  const q = query.trim().toLowerCase()
  if (!q) return all.slice(0, limit)
  const matched = all.filter((name) => {
    const label = humanizeLucideName(name).toLowerCase()
    return name.toLowerCase().includes(q) || label.includes(q)
  })
  return matched.slice(0, limit)
}
