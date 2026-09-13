/** Icon names are metadata; SVG code loads only for icons actually rendered. */
import dynamicIconImports from 'lucide-react/dynamicIconImports'
import { selectedIcon } from './selectedIcon'

export const LUCIDE_ICON_NAMES = [
  ...new Map(
    Object.keys(dynamicIconImports)
      .map((name) =>
        name
          .split('-')
          .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
          .join(''),
      )
      .map((name) => [name.toLowerCase(), name]),
  ).values(),
].sort((a, b) => a.localeCompare(b))

export const getLucideIcon = selectedIcon

/** "ArrowUpRight" → "Arrow Up Right" for picker labels. */
export function humanizeLucideName(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
}

/** Case-insensitive substring filter for the picker search box. */
export function filterLucideNames(query: string, limit = 180): string[] {
  const q = query.trim().toLowerCase()
  if (!q) return LUCIDE_ICON_NAMES.slice(0, limit)
  const matched = LUCIDE_ICON_NAMES.filter((name) => {
    const label = humanizeLucideName(name).toLowerCase()
    return name.toLowerCase().includes(q) || label.includes(q)
  })
  return matched.slice(0, limit)
}
