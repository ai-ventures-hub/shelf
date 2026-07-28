import { useId } from 'react'

/**
 * Official Shelf mark — Brand Standard v1.0. Ink glyph (two interlocked shelf
 * brackets drawing an S) on the indigo gradient tile. A single sealed unit:
 * geometry and gradient ship exactly as specified; size via the className.
 */
export function ShelfMark({
  className = 'shelf-mark',
}: {
  className?: string
}) {
  const gradientId = useId()
  return (
    <svg
      viewBox="0 0 100 100"
      fill="none"
      className={className}
      aria-hidden
      focusable="false"
    >
      <rect width="100" height="100" rx="22" fill={`url(#${gradientId})`} />
      <path
        fill="#081021"
        d="M20 18h60v18H40v14H20V18zM20 82h60V50H58v14H20V82z"
      />
      <defs>
        <linearGradient
          id={gradientId}
          x1="10"
          y1="10"
          x2="90"
          y2="90"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#9aafff" />
          <stop offset="1" stopColor="#526fdd" />
        </linearGradient>
      </defs>
    </svg>
  )
}
