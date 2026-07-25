import { useEffect, useState } from 'react'

/**
 * Loads a local icon path through Electron IPC as a data URL.
 * Avoids custom-protocol + CSP pitfalls with absolute filesystem paths.
 */
export function useToolIcon(iconPath?: string): {
  src: string | null
  failed: boolean
} {
  const [src, setSrc] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    setSrc(null)
    setFailed(false)

    if (!iconPath) return

    if (typeof window === 'undefined' || !window.shelf?.getIconDataUrl) {
      setFailed(true)
      return
    }

    void window.shelf
      .getIconDataUrl(iconPath)
      .then((dataUrl) => {
        if (cancelled) return
        if (!dataUrl) {
          setFailed(true)
          return
        }
        setSrc(dataUrl)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })

    return () => {
      cancelled = true
    }
  }, [iconPath])

  return { src, failed }
}
