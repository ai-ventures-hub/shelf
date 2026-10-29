/**
 * Tool icons for the phone, rendered on the Mac so the Companion bundle
 * never ships the Lucide set. A Lucide glyph becomes a small inline SVG; a
 * custom image becomes a data URL read from inside the icons folder only.
 */
import type { CompanionToolIcon } from '../shared/companion-contracts'
import { containedDataUrl, ICON_MIME_TYPES } from '../shared/contained-data-url'
import type { Tool } from '../shared/contracts'

/** Custom images above this are left out; the phone shows the letter instead. */
const MAX_IMAGE_BYTES = 256 * 1024

const svgCache = new Map<string, string>()

/**
 * React, its server renderer, and the Lucide set are required on first use,
 * not at launch: together they cost tens of milliseconds and a dozen
 * megabytes, and a Mac with Companion off never needs them.
 */
type Renderer = {
  createElement: typeof import('react').createElement
  renderToStaticMarkup: typeof import('react-dom/server').renderToStaticMarkup
  icons: Record<string, unknown>
}
let renderer: Renderer | null = null
function load(): Renderer {
  if (renderer) return renderer
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const react = require('react') as typeof import('react')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const server = require('react-dom/server') as typeof import('react-dom/server')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const lucide = require('lucide-react') as { icons: Record<string, unknown> }
  renderer = { createElement: react.createElement, renderToStaticMarkup: server.renderToStaticMarkup, icons: lucide.icons }
  return renderer
}

function lucideSvg(name: string): string | null {
  const cached = svgCache.get(name)
  if (cached) return cached
  const { createElement, renderToStaticMarkup, icons } = load()
  const Icon = icons[name]
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
