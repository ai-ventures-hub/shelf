import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'

/**
 * The view a path belongs to. Tool sections (/tools/x, /tools/x/runs) are one
 * view with tabs, so switching tabs keeps focus on the tab the user chose.
 */
function viewOf(pathname: string): string {
  return pathname.split('/').filter(Boolean).slice(0, 2).join('/')
}

const WAIT_FOR_HEADING_MS = 5000

/**
 * Route-change accessibility: names the window after the page's <h1>
 * ("Library · Shelf", or the tool name on a tool page) and, when the view
 * changes, moves focus to that heading so screen readers announce the new
 * page and keyboard users continue from the top of it. Lazy pages render
 * their heading after a loading state, so this waits for it briefly.
 */
export function RouteFocus() {
  const { pathname } = useLocation()
  const previous = useRef<string | null>(null)

  useEffect(() => {
    const before = previous.current
    previous.current = pathname
    const moveFocus = before !== null && viewOf(before) !== viewOf(pathname)

    const apply = (): boolean => {
      const heading = document.querySelector<HTMLElement>('.content h1')
      if (!heading) return false
      const name = heading.textContent?.trim()
      document.title = name ? `${name} · Shelf` : 'Shelf'
      // Never pull focus out of an open dialog (Quick Open, confirmations).
      if (moveFocus && !document.querySelector('dialog[open]')) {
        if (!heading.hasAttribute('tabindex')) heading.tabIndex = -1
        heading.focus({ preventScroll: true })
      }
      return true
    }

    if (apply()) return
    // Until the new heading renders, do not keep the previous page's name.
    document.title = 'Shelf'
    const root = document.querySelector('.content') ?? document.body
    const observer = new MutationObserver(() => {
      if (apply()) observer.disconnect()
    })
    observer.observe(root, { childList: true, subtree: true })
    const timer = window.setTimeout(() => observer.disconnect(), WAIT_FOR_HEADING_MS)
    return () => {
      observer.disconnect()
      window.clearTimeout(timer)
    }
  }, [pathname])

  return null
}
