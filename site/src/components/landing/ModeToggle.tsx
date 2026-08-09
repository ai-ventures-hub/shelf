'use client'

import { useState } from 'react'
import { MODE_ROWS } from '@/lib/landing-demos'

type Mode = 'simple' | 'developer'

/**
 * #dev — segmented Simple/Developer control + the mock window it drives.
 * Renders as a fragment: the server section supplies the copy as children
 * inside the left grid cell; the window fills the right cell.
 */
export function ModeToggle({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState<Mode>('simple')

  return (
    <>
      <div className="mode-copy">
        {children}
        <div className="mode-switch" role="group" aria-label="Experience mode">
          <button
            type="button"
            data-active={mode === 'simple' ? 'true' : 'false'}
            onClick={() => setMode('simple')}
          >
            Simple
          </button>
          <button
            type="button"
            data-active={mode === 'developer' ? 'true' : 'false'}
            onClick={() => setMode('developer')}
          >
            Developer
          </button>
        </div>
        <p className="mode-foot">Switch anytime — it only changes what’s shown.</p>
      </div>
      <div className="mock-window mode-window">
        <div className="mode-titlebar">
          {mode === 'developer' ? 'Shelf — Developer mode' : 'Shelf — Simple mode'}
        </div>
        <div className="mode-rows" key={mode}>
          {MODE_ROWS[mode].map((row) => (
            <div
              className="mode-row"
              key={row.label}
              data-dim={'dim' in row && row.dim ? 'true' : undefined}
            >
              <span className="mode-row-label">{row.label}</span>
              <span className="mode-row-meta" data-tone={row.tone}>
                {row.meta}
              </span>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
