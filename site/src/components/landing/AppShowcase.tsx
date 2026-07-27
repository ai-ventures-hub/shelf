'use client'

import { useState } from 'react'
import Image, { type StaticImageData } from 'next/image'
import capabilityGaps from '@/assets/app/capability-gaps.jpg'
import library from '@/assets/app/library.jpg'
import mcpConnections from '@/assets/app/mcp-connections.jpg'
import register from '@/assets/app/register.jpg'

type Screen = {
  id: string
  label: string
  caption: string
  image: StaticImageData
  alt: string
}

const SCREENS: Screen[] = [
  {
    id: 'library',
    label: 'Library',
    caption: 'Every tool on one calm home screen — status at a glance.',
    image: library,
    alt: 'Shelf Library — a grid of tool cards with icons, tags, ports, and process status',
  },
  {
    id: 'capability-gaps',
    label: 'Capability gaps',
    caption: 'Unmet agent needs, recorded and planned — never silently dropped.',
    image: capabilityGaps,
    alt: 'Shelf Capability gaps inbox — an open gap with recurrence, last request, and actions',
  },
  {
    id: 'register',
    label: 'Register a tool',
    caption: 'Point at a folder — Shelf scans and suggests the whole registration.',
    image: register,
    alt: 'Shelf Register a tool form — project folder, name, launch command, URL, and port',
  },
  {
    id: 'mcp-connections',
    label: 'MCP Connections',
    caption: 'Claude Desktop, Cursor, and Codex — connected in one click.',
    image: mcpConnections,
    alt: 'Shelf MCP Connections — Claude Desktop, Cursor, and OpenAI Codex all connected',
  },
]

/**
 * Beat 06.5 — the real macOS app. All four screens render stacked in one
 * grid cell (identical dimensions), so tab switches crossfade without any
 * layout shift.
 */
export function AppShowcase() {
  const [activeId, setActiveId] = useState('library')
  const active = SCREENS.find((s) => s.id === activeId) ?? SCREENS[0]

  return (
    <section id="app" className="section" aria-labelledby="app-heading">
      <div className="section-inner">
        <div className="section-head section-head--center" data-reveal>
          <p className="eyebrow">The app</p>
          <h2 id="app-heading">This is Shelf.</h2>
          <p className="section-lead">
            The real macOS app — the same library, gaps, and connections your agents
            see over MCP.
          </p>
        </div>
        <div
          className="app-showcase"
          data-reveal
          style={{ '--reveal-order': 1 } as React.CSSProperties}
        >
          <div className="app-tabs" role="group" aria-label="App screens">
            {SCREENS.map((screen) => (
              <button
                key={screen.id}
                type="button"
                className="app-tab"
                data-active={screen.id === activeId ? 'true' : undefined}
                aria-pressed={screen.id === activeId}
                onClick={() => setActiveId(screen.id)}
              >
                {screen.label}
              </button>
            ))}
          </div>
          <div className="app-frame">
            {SCREENS.map((screen) => (
              <Image
                key={screen.id}
                src={screen.image}
                alt={screen.alt}
                sizes="(max-width: 1000px) 100vw, 1236px"
                placeholder="blur"
                data-active={screen.id === activeId ? 'true' : 'false'}
                aria-hidden={screen.id !== activeId}
              />
            ))}
          </div>
          <p className="app-caption">{active.caption}</p>
        </div>
      </div>
    </section>
  )
}
