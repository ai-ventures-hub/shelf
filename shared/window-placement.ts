/**
 * Where to reopen the main window. Saved geometry can outlive the display it
 * was on (an unplugged monitor, a changed arrangement, a smaller laptop
 * screen), so it is checked against the displays connected right now.
 */

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface SavedWindowBounds {
  width: number
  height: number
  x?: number
  y?: number
  maximized?: boolean
  fullScreen?: boolean
}

export interface WindowPlacement {
  width: number
  height: number
  /** Absent when the saved position is unusable; Electron then centers. */
  x?: number
  y?: number
}

/** Height of the strip that must stay reachable so the window can be dragged. */
const TITLE_BAR_HEIGHT = 28
/** Minimum visible title-bar width that still counts as grabbable. */
const MIN_VISIBLE_TITLE = 80

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function overlap(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x)
  const y = Math.max(a.y, b.y)
  const right = Math.min(a.x + a.width, b.x + b.width)
  const bottom = Math.min(a.y + a.height, b.y + b.height)
  if (right <= x || bottom <= y) return null
  return { x, y, width: right - x, height: bottom - y }
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), Math.max(low, high))
}

/**
 * Fit saved bounds onto the current displays' work areas (menu bar and Dock
 * excluded). The window keeps its saved display when its title bar is still
 * reachable there, shrinks to fit that display, and is pulled fully inside
 * it. A window whose title bar is on no display drops its position so
 * Electron centers it on the primary display.
 */
export function placeWindow(
  saved: Partial<SavedWindowBounds> | undefined,
  workAreas: Rect[],
  defaults: { width: number; height: number },
  minimum: { width: number; height: number },
): WindowPlacement {
  const wantWidth = finite(saved?.width) && saved.width > 0 ? saved.width : defaults.width
  const wantHeight = finite(saved?.height) && saved.height > 0 ? saved.height : defaults.height
  const primary = workAreas[0]

  let target: Rect | undefined
  if (finite(saved?.x) && finite(saved?.y)) {
    const titleBar = { x: saved.x, y: saved.y, width: wantWidth, height: TITLE_BAR_HEIGHT }
    let best = 0
    for (const area of workAreas) {
      const visible = overlap(titleBar, area)
      if (visible && visible.width >= Math.min(MIN_VISIBLE_TITLE, wantWidth) && visible.width > best) {
        best = visible.width
        target = area
      }
    }
  }

  const fitIn = target ?? primary
  const width = fitIn ? clamp(wantWidth, minimum.width, fitIn.width) : wantWidth
  const height = fitIn ? clamp(wantHeight, minimum.height, fitIn.height) : wantHeight
  if (!target || !finite(saved?.x) || !finite(saved?.y)) return { width, height }

  return {
    width,
    height,
    x: Math.round(clamp(saved.x, target.x, target.x + target.width - width)),
    y: Math.round(clamp(saved.y, target.y, target.y + target.height - height)),
  }
}
