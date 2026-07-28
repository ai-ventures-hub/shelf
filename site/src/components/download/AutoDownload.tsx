'use client'

import { useEffect, useRef } from 'react'
import { DOWNLOAD_DMG_URL } from '@/lib/download'

/** Kicks off the DMG download shortly after the page renders. */
export function AutoDownload() {
  const fired = useRef(false)

  useEffect(() => {
    if (fired.current) return
    fired.current = true
    const timer = window.setTimeout(() => {
      // Navigating to a binary triggers the download without leaving the page.
      window.location.assign(DOWNLOAD_DMG_URL)
    }, 800)
    return () => window.clearTimeout(timer)
  }, [])

  return null
}
