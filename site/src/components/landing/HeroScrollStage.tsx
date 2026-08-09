'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { HERO_FILENAMES, HERO_TILES } from '@/lib/landing-demos'

/** smoothstep of scroll progress p over [a, b] */
function seg(p: number, a: number, b: number) {
  const t = Math.min(1, Math.max(0, (p - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/**
 * The scroll-scrubbed pinned hero. Static-first: SSR/no-JS renders the fully
 * visible variant; `is-animated` is added on mount only when the viewport
 * qualifies (motion allowed, ≥760px wide, ≥560px tall — re-evaluated on
 * resize and on prefers-reduced-motion changes).
 *
 * The scrub writes pre-smoothstepped --p-* custom properties on the sticky
 * stage inside one rAF per scroll event; CSS derives every transform from
 * them. React never re-renders during scroll.
 */
export function HeroScrollStage() {
  const wrapRef = useRef<HTMLElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const textRef = useRef<HTMLDivElement>(null)
  const [animated, setAnimated] = useState(false)

  useLayoutEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const apply = () =>
      setAnimated(!mq.matches && window.innerWidth >= 760 && window.innerHeight >= 560)
    apply()
    mq.addEventListener('change', apply)
    window.addEventListener('resize', apply)
    return () => {
      mq.removeEventListener('change', apply)
      window.removeEventListener('resize', apply)
    }
  }, [])

  useEffect(() => {
    if (!animated) return
    const wrap = wrapRef.current
    const stage = stageRef.current
    if (!wrap || !stage) return

    let raf = 0
    let last = -1

    const frame = () => {
      raf = 0
      const vh = window.innerHeight
      const rect = wrap.getBoundingClientRect()
      const p = Math.min(1, Math.max(0, -rect.top / Math.max(1, rect.height - vh)))
      stage.style.setProperty(
        '--hero-scale',
        String(Math.min(1, Math.max(0.6, (vh - 70) / 700))),
      )
      if (Math.abs(p - last) <= 0.0015) return
      last = p

      const set = (name: string, value: number) =>
        stage.style.setProperty(name, value.toFixed(4))
      set('--p-hint', seg(p, 0.02, 0.1))
      set('--p-files', seg(p, 0.08, 0.3))
      const tOut = seg(p, 0.15, 0.42)
      set('--p-text', tOut)
      if (textRef.current) {
        textRef.current.style.pointerEvents = tOut > 0.5 ? 'none' : 'auto'
      }
      set('--p-shelf', seg(p, 0.38, 0.6))
      set('--p-shelf-rise', seg(p, 0.38, 0.75))
      set('--p-plank', 0.72 + 0.28 * seg(p, 0.38, 0.62))
      for (let i = 0; i < HERO_TILES.length; i++) {
        set(`--p-tile-${i}`, seg(p, 0.44 + i * 0.085, 0.6 + i * 0.085))
      }
      set('--p-shot', seg(p, 0.55, 0.82))
      set('--p-rise', seg(p, 0.55, 0.88))
      set('--p-caption', seg(p, 0.8, 0.92))
      stage.dataset.idle = p > 0.93 ? 'true' : 'false'
    }

    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(frame)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll, { passive: true })
    onScroll()
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [animated])

  return (
    <section
      ref={wrapRef}
      className={animated ? 'hero-stage is-animated' : 'hero-stage'}
      aria-label="Shelf keeps your builds alive"
    >
      <div ref={stageRef} className="hero-sticky">
        <div className="hero-files" aria-hidden>
          {HERO_FILENAMES.map((name) => (
            <span key={name}>{name}</span>
          ))}
        </div>
        <div ref={textRef} className="hero-text">
          <p className="eyebrow">Made for people who build with AI</p>
          <h1>
            You keep building things.{' '}
            <span className="hw-shelf">Shelf</span> keeps them{' '}
            <span className="hw-alive">alive</span>.
          </h1>
          <p className="hero-sub">
            Apps and tools made with AI don’t come with a place to live. Shelf
            is that place — they launch in a click and your AI tools can reach
            them.
          </p>
          <div className="hero-cta">
            <Link className="btn-primary" href="/download">
              Download — It’s free
            </Link>
            <a className="btn-ghost" href="#how">
              Watch it happen ↓
            </a>
          </div>
          <p className="hero-fine">
            macOS · Apple Silicon · free &amp; open source · no account
          </p>
        </div>
        <div className="hero-shot" aria-hidden>
          <Image
            src="/app-library.png"
            alt=""
            fill
            sizes="100vw"
            style={{ objectFit: 'cover', objectPosition: 'top center' }}
          />
          <div className="hero-shot-veil" />
        </div>
        <div className="hero-shelf">
          <div className="hero-tiles">
            {HERO_TILES.map((tile, i) => (
              <div
                key={tile.name}
                className="hero-tile"
                data-edge={tile.edge}
                style={{ '--breathe-dur': `${5 + i * 0.45}s` } as React.CSSProperties}
              >
                <span
                  className={'flat' in tile && tile.flat ? 'lt lt--flat' : 'lt'}
                  aria-hidden
                >
                  {tile.letter}
                </span>
                <div className="hero-tile-name">{tile.name}</div>
                <div className="hero-tile-state" data-tone={tile.tone}>
                  {tile.state}
                </div>
              </div>
            ))}
          </div>
          <div className="hero-plank" aria-hidden />
          <div className="hero-glow" aria-hidden />
          <p className="hero-caption">
            Hover a tool. One click and it’s running — today, next week, two
            clients from now.
          </p>
        </div>
        <div className="hero-hint" aria-hidden>
          Scroll<span>↓</span>
        </div>
      </div>
    </section>
  )
}
