'use client'

import { useState, type CSSProperties } from 'react'
import { BRAND_PRESETS, type BrandPresetId } from '@/lib/landing-demos'

/**
 * #design — segmented brand-profile control + the mock window it repaints.
 * Fragment like ModeToggle: the server section supplies copy as children
 * in the left cell; the window fills the right cell.
 *
 * The mini page mirrors the app's live preview mechanism: the active
 * preset's tokens land as inline custom properties on `.be-body`, and the
 * page's elements consume them. The page subtree is NOT keyed (colors
 * transition in place); the profile card IS keyed (fadeUp replays).
 * No [data-reveal] inside the keyed subtree — ScrollReveals observes only
 * the initial DOM, so a remounted reveal node would stay invisible.
 */
export function BrandSwitcher({ children }: { children: React.ReactNode }) {
  const [id, setId] = useState<BrandPresetId>('shelf')
  const active = BRAND_PRESETS.find((preset) => preset.id === id) ?? BRAND_PRESETS[0]

  return (
    <>
      <div className="be-copy">
        {children}
        <div className="mode-switch be-switch" role="group" aria-label="Brand profile">
          {BRAND_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              aria-pressed={id === preset.id}
              data-active={id === preset.id ? 'true' : 'false'}
              onClick={() => setId(preset.id)}
            >
              {preset.name}
            </button>
          ))}
        </div>
        <p className="mode-foot">Same page every time — only the profile changes.</p>
      </div>
      <div
        className="mock-window be-window"
        data-reveal
        style={{ '--reveal-order': 1 } as CSSProperties}
      >
        <div className="mode-titlebar">Shelf — Design · {active.name}</div>
        <div className="be-body" style={active.cssVars as CSSProperties}>
          <div className="be-profile" key={active.id}>
            <div className="be-profile-head">
              <strong className="be-profile-name">{active.name}</strong>
              <span className="pill" data-tone={active.id === 'shelf' ? 'accent' : 'success'}>
                {active.badge}
              </span>
            </div>
            <div className="be-swatches">
              {active.swatches.map((hex) => (
                <span key={hex} className="be-swatch" style={{ background: hex }} title={hex} />
              ))}
            </div>
            <span className="be-font">{active.fontLabel}</span>
            <span className="be-voice">“{active.voiceLine}”</span>
            <span className="be-source">{active.source}</span>
          </div>
          {/* A rendering, not an interface — same stance as the app's preview. */}
          <div className="be-page" aria-hidden="true">
            <header className="be-nav">
              <span className="be-monogram">{active.name[0]}</span>
              <strong>{active.name}</strong>
            </header>
            <h3 className="be-display">The next thing you build</h3>
            <p className="be-bodycopy">
              Already in the right typeface.
              <span className="be-muted"> Already the right shade of everything.</span>
            </p>
            <div className="be-buttons">
              <span className="be-btn be-btn-primary">Primary</span>
              <span className="be-btn be-btn-quiet">Quiet</span>
            </div>
            <div className="be-minicard">
              <strong>Card title</strong>
              <span className="be-mono">npx create-anything</span>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
