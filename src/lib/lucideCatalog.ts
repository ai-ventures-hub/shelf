/**
 * Lucide catalog helpers for the icon picker.
 * Uses the package `icons` map so the picker stays in sync with lucide-react.
 */
import { icons, type LucideIcon } from 'lucide-react'

/** PascalCase names without the redundant `*Icon` aliases. */
export const LUCIDE_ICON_NAMES: string[] = Object.keys(icons)
  .filter((name) => !name.endsWith('Icon'))
  .sort((a, b) => a.localeCompare(b))

/**
 * Resolve a Lucide component by stored PascalCase name.
 * Icons are React forwardRef objects (typeof === 'object'), not plain functions.
 */
export function getLucideIcon(name?: string): LucideIcon | null {
  if (!name) return null
  const Icon = icons[name as keyof typeof icons]
  if (!Icon || typeof Icon === 'string' || typeof Icon === 'boolean' || typeof Icon === 'number') {
    return null
  }
  return Icon as LucideIcon
}

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
