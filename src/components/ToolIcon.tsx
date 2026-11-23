import { Suspense } from 'react'
import { selectedIcon, useIconLoaderState } from '../lib/selectedIcon'
import { useToolIcon } from '../hooks/useToolIcon'

/**
 * Restrained studio-calibrated tile gradients for letter fallbacks so a multi-tool
 * library has calm visual landmarks instead of a uniform wall of identical blue tiles.
 */
const LETTER_PALETTES: ReadonlyArray<{ bg: string; fg: string }> = [
  { bg: 'linear-gradient(145deg, #9aafff, #526fdd)', fg: '#081021' }, // indigo
  { bg: 'linear-gradient(145deg, #7ee3be, #2e9c76)', fg: '#061a14' }, // emerald
  { bg: 'linear-gradient(145deg, #c2a7ff, #7558d6)', fg: '#100824' }, // violet
  { bg: 'linear-gradient(145deg, #7dd3fc, #3383c7)', fg: '#071724' }, // sky
  { bg: 'linear-gradient(145deg, #f8cf86, #c6862e)', fg: '#211404' }, // amber
  { bg: 'linear-gradient(145deg, #fda4af, #c7536a)', fg: '#240810' }, // rose
]

/** Deterministic palette index derived from the tool name. */
function paletteForName(name: string): { bg: string; fg: string } {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0
  }
  return LETTER_PALETTES[hash % LETTER_PALETTES.length]
}

/** Shared tool mark: Lucide → custom image → letter fallback. */
export function ToolIcon({
  name,
  iconPath,
  iconLucide,
  iconColor,
  iconBackground,
  className = 'tool-icon',
}: {
  name: string
  iconPath?: string
  iconLucide?: string
  iconColor?: string
  iconBackground?: string
  className?: string
}) {
  const { src, failed } = useToolIcon(iconPath)
  const initial = name.trim().charAt(0).toUpperCase() || 'T'
  const fallback = paletteForName(name || 'Tool')
  // Subscribes this icon to the map loading, so unknown names settle on the
  // letter even inside a memoized card.
  useIconLoaderState()
  const Lucide = selectedIcon(iconLucide)

  if (Lucide) {
    return (
      <div
        className={`${className} is-lucide`}
        aria-hidden
        style={{
          background: iconBackground || fallback.bg,
          color: iconColor || fallback.fg,
        }}
      >
        <Suspense fallback={initial}><Lucide className="tool-icon-lucide-svg" strokeWidth={2} /></Suspense>
      </div>
    )
  }

  const tileStyle =
    src && !failed
      ? undefined
      : {
          background: iconBackground || fallback.bg,
          color: iconColor || fallback.fg,
        }

  return (
    <div className={className} style={tileStyle} aria-hidden>
      {src && !failed ? (
        <img
          src={src}
          alt=""
          onError={(event) => {
            event.currentTarget.style.display = 'none'
            event.currentTarget.parentElement!.textContent = initial
          }}
        />
      ) : (
        initial
      )}
    </div>
  )
}
