import { Suspense } from 'react'
import { selectedIcon, useIconLoaderState } from '../lib/selectedIcon'
import { useToolIcon } from '../hooks/useToolIcon'

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
          background: iconBackground || 'linear-gradient(145deg, #9aafff, #526fdd)',
          color: iconColor || '#081021',
        }}
      >
        <Suspense fallback={initial}><Lucide className="tool-icon-lucide-svg" strokeWidth={2} /></Suspense>
      </div>
    )
  }

  return (
    <div className={className} aria-hidden>
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
