/** Geometric Shelf mark — two offset L-blocks forming an S (matches Dock icon). */
export function ShelfMark({ className = 'brand-mark' }: { className?: string }) {
  return (
    <div className={className} aria-hidden>
      <svg viewBox="0 0 100 100" className="brand-mark-svg" focusable="false">
        {/* Top ⌐ : full top bar + left stem */}
        <path fill="currentColor" d="M20 18h60v18H40v14H20V18z" />
        {/* Bottom L : right stem + full bottom bar, with a clear center gap */}
        <path fill="currentColor" d="M20 82h60V50H58v14H20V82z" />
      </svg>
    </div>
  )
}
