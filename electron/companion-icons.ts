/**
 * Tool icons for the phone, rendered on the Mac so the Companion bundle
 * never ships the Lucide set. A Lucide glyph becomes a small inline SVG; a
 * custom image becomes a data URL read from inside the icons folder only.
 */
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { icons } from 'lucide-react'
import type { CompanionToolIcon } from '../shared/companion-contracts'
import { containedDataUrl, ICON_MIME_TYPES } from '../shared/contained-data-url'
import type { Tool } from '../shared/contracts'

/** Custom images above this are left out; the phone shows the letter instead. */
const MAX_IMAGE_BYTES = 256 * 1024

const svgCache = new Map<string, string>()

function lucideSvg(name: string): string | null {
  const cached = svgCache.get(name)
  if (cached) return cached
  const Icon = (icons as Record<string, unknown>)[name]
  if (typeof Icon !== 'function' && typeof Icon !== 'object') return null
  try {
    const markup = renderToStaticMarkup(createElement(Icon as never, { size: 24, strokeWidth: 2 }))
    svgCache.set(name, markup)
    return markup
  } catch {
    return null
  }
}

/** The icon a tool shows on the phone, or null for the letter fallback. */
export function companionToolIcon(tool: Tool, iconsDir: string): CompanionToolIcon | null {
  if (tool.iconLucide) {
    const svg = lucideSvg(tool.iconLucide)
    if (svg) return { kind: 'svg', svg }
  }
  if (tool.iconPath) {
    const dataUrl = containedDataUrl(iconsDir, tool.iconPath, ICON_MIME_TYPES)
    if (dataUrl && dataUrl.length <= MAX_IMAGE_BYTES * 1.4) return { kind: 'image', dataUrl }
  }
  return null
}
