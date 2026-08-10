/**
 * Color tokens panel. The segmented control switches the EDIT TARGET:
 * Base writes tokens.color, Light/Dark write modes.<mode>.color overrides.
 * On a mode tab, un-overridden tokens show the base value with an
 * "Inherited" chip; editing creates the override, × removes it.
 */
import { ColorField } from '../ColorField'
import { colorLeaves, humanizeTokenName, type FlatToken } from '../../lib/designTokens'
import type { DesignTokenGroup } from '../../types'

export type ColorEditTarget = 'base' | 'light' | 'dark'

interface ColorTokensSectionProps {
  tokens: DesignTokenGroup
  modes: { light: DesignTokenGroup; dark: DesignTokenGroup }
  editTarget: ColorEditTarget
  onEditTargetChange: (target: ColorEditTarget) => void
  onChangeToken: (path: string, value: string) => void
  onClearOverride: (path: string) => void
  onAddColor: () => void
}

const TARGET_LABELS: Record<ColorEditTarget, string> = {
  base: 'Base',
  light: 'Light',
  dark: 'Dark',
}

export function ColorTokensSection({
  tokens,
  modes,
  editTarget,
  onEditTargetChange,
  onChangeToken,
  onClearOverride,
  onAddColor,
}: ColorTokensSectionProps) {
  const baseLeaves = colorLeaves(tokens)
  const overrideLeaves =
    editTarget === 'base' ? [] : colorLeaves(modes[editTarget])
  const overrides = new Map(overrideLeaves.map((leaf) => [leaf.path, leaf]))

  // Union keeps mode-only tokens visible even without a base entry.
  const rows: Array<{ leaf: FlatToken; overridden: boolean }> =
    editTarget === 'base'
      ? baseLeaves.map((leaf) => ({ leaf, overridden: false }))
      : [
          ...baseLeaves.map((leaf) => {
            const override = overrides.get(leaf.path)
            return { leaf: override ?? leaf, overridden: Boolean(override) }
          }),
          ...overrideLeaves
            .filter((leaf) => !baseLeaves.some((base) => base.path === leaf.path))
            .map((leaf) => ({ leaf, overridden: true })),
        ]

  return (
    <section className="panel">
      <header className="panel-header">
        <h2 className="panel-title">Colors</h2>
        <div className="design-mode-toggle" role="group" aria-label="Color edit target">
          {(Object.keys(TARGET_LABELS) as ColorEditTarget[]).map((target) => (
            <button
              key={target}
              type="button"
              className={editTarget === target ? 'is-active' : ''}
              aria-pressed={editTarget === target}
              onClick={() => onEditTargetChange(target)}
            >
              {TARGET_LABELS[target]}
            </button>
          ))}
        </div>
      </header>
      <div className="panel-body stack">
        <p className="field-hint" style={{ margin: 0 }}>
          {editTarget === 'base'
            ? 'Base colors apply in both modes; the Light and Dark tabs add per-mode overrides.'
            : `${TARGET_LABELS[editTarget]} mode overrides — inherited colors follow Base until you change them here. The × returns a color to Base.`}
        </p>
        {rows.length === 0 ? (
          <p className="field-hint" style={{ margin: 0 }}>
            No colors yet. Add your first brand color below.
          </p>
        ) : null}
        <div className="token-grid">
          {rows.map(({ leaf, overridden }) => {
            const name = leaf.path.replace(/^color\./, '')
            return (
              <div key={leaf.path} className="token-row">
                <ColorField
                  id={`color-${editTarget}-${name}`}
                  label={humanizeTokenName(name)}
                  value={String(leaf.value)}
                  onChange={(hex) => onChangeToken(leaf.path, hex)}
                />
                {editTarget !== 'base' ? (
                  // Fixed-width slot — chip↔button swaps must not reflow the row.
                  <span className="token-trailing">
                    {overridden ? (
                      <button
                        type="button"
                        className="token-clear-btn"
                        title="Remove override (inherit from Base)"
                        aria-label={`Remove ${TARGET_LABELS[editTarget]} override for ${name}`}
                        onClick={() => onClearOverride(leaf.path)}
                      >
                        ×
                      </button>
                    ) : (
                      <span className="token-inherited">Inherited</span>
                    )}
                  </span>
                ) : null}
              </div>
            )
          })}
        </div>
        {editTarget === 'base' ? (
          <div className="action-row" style={{ margin: 0 }}>
            <button type="button" className="btn btn-quiet btn-sm" onClick={onAddColor}>
              Add color
            </button>
          </div>
        ) : null}
      </div>
    </section>
  )
}
