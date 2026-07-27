'use client'

import { useEffect } from 'react'

/**
 * Once-only scroll reveals for [data-reveal] elements (MOTION.md moment 4).
 * The hidden state is gated on html[data-reveal-ready], set here on mount —
 * if JS never runs, nothing is ever hidden. Fires once per element, then
 * unobserves; already-visible elements reveal immediately.
 */
export function ScrollReveals() {
  useEffect(() => {
    const els = Array.from(document.querySelectorAll<HTMLElement>('[data-reveal]'))
    if (els.length === 0) return
    document.documentElement.dataset.revealReady = 'true'
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible')
            io.unobserve(entry.target)
          }
        }
      },
      { threshold: 0.15, rootMargin: '0px 0px -10% 0px' },
    )
    for (const el of els) io.observe(el)
    return () => {
      io.disconnect()
      delete document.documentElement.dataset.revealReady
    }
  }, [])
  return null
}
