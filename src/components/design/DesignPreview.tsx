/**
 * Live brand preview — a miniature branded surface driven entirely by the
 * editor's draft tokens via inline --dp-* custom properties, so every
 * keystroke repaints it before anything is saved. Inert by design: it's a
 * picture of the brand, not a form.
 *
 * Token lookups use ordered aliases matching the app's canonical vocabulary
 * (surface = page canvas, panel = card) with hard fallbacks, so a missing
 * token can never break the preview. Declared font families render only if
 * installed on this Mac — fallback stacks are appended, nothing is fetched.
 */
import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { resolveModeTokens } from '../../lib/designTokens'
import type { DesignAsset, DesignTokenGroup } from '../../types'

interface DesignPreviewProps {
  name: string
  tokens: DesignTokenGroup
  modes: { light: DesignTokenGroup; dark: DesignTokenGroup }
  assets: DesignAsset[]
  mode: 'light' | 'dark'
  onModeChange: (mode: 'light' | 'dark') => void
}

function usePreviewLogo(assets: DesignAsset[]): string | null {
  const logo =
    assets.find((a) => a.kind === 'logo') ??
    assets.find((a) => a.kind === 'wordmark') ??
    assets.find((a) => a.kind === 'icon')
  const [src, setSrc] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    if (!logo || !window.shelf?.designAssetDataUrl) {
      setSrc(null)
      return
    }
    window.shelf
      .designAssetDataUrl(logo.path)
      .then((url) => {
        if (!cancelled) setSrc(url)
      })
      .catch(() => {
        if (!cancelled) setSrc(null)
      })
    return () => {
      cancelled = true
    }
  }, [logo?.path])
  return src
}

export function DesignPreview({
  name,
  tokens,
  modes,
  assets,
  mode,
  onModeChange,
}: DesignPreviewProps) {
  const logoSrc = usePreviewLogo(assets)

  const { cssVars, colorChips } = useMemo(() => {
    const resolved = resolveModeTokens(tokens, mode === 'light' ? modes.light : modes.dark)
    const color = (...names: string[]): string | undefined => {
      for (const n of names) {
        const v = resolved.get(`color.${n}`)
        if (typeof v === 'string' && v) return v
      }
      return undefined
    }
    const dimension = (...names: string[]): string | undefined => {
      for (const n of names) {
        const v = resolved.get(`dimension.${n}`)
        if (v !== undefined) return String(v)
      }
      return undefined
    }
    const font = (slot: string, fallback: string): string => {
      const v = resolved.get(`typography.font-family.${slot}`)
      return typeof v === 'string' && v ? `${v}, ${fallback}` : fallback
    }

    const dark = mode === 'dark'
    const bg = color('background', 'bg', 'surface') ?? (dark ? '#101216' : '#f7f7f8')
    const fg = color('ink', 'text', 'foreground') ?? (dark ? '#e8eaef' : '#1b1d22')
    const vars: Record<string, string> = {
      '--dp-bg': bg,
      '--dp-fg': fg,
      '--dp-surface':
        color('panel', 'card', 'panel-raised') ?? (dark ? '#181b21' : '#ffffff'),
      '--dp-muted': color('muted', 'secondary') ?? `color-mix(in srgb, ${fg} 60%, ${bg})`,
      '--dp-brand': color('brand', 'primary', 'accent') ?? '#4459d8',
      '--dp-danger': color('danger', 'error') ?? '#e5484d',
      '--dp-line': color('line', 'border') ?? `color-mix(in srgb, ${fg} 18%, ${bg})`,
      '--dp-on-brand': color('on-brand') ?? '#ffffff',
      '--dp-radius': dimension('radius-card', 'radius') ?? '12px',
      '--dp-radius-sm': dimension('radius-control', 'radius-sm') ?? '8px',
      '--dp-font-app': font('app', 'Inter, system-ui, sans-serif'),
      '--dp-font-mono': font('mono', 'ui-monospace, monospace'),
    }
    vars['--dp-font-display'] = font('display', vars['--dp-font-app'])

    const chips = [...resolved.entries()]
      .filter(([path, value]) => path.startsWith('color.') && typeof value === 'string')
      .map(([path, value]) => ({ name: path.slice('color.'.length), value: String(value) }))

    return { cssVars: vars as CSSProperties, colorChips: chips }
  }, [tokens, modes, mode])

  const monogram = (name.trim()[0] || '?').toUpperCase()

  return (
    <aside className="design-preview-pane">
      <section className="panel">
        <header className="panel-header">
          <h2 className="panel-title">Preview</h2>
          <div className="design-mode-toggle" role="group" aria-label="Preview mode">
            {(['light', 'dark'] as const).map((m) => (
              <button
                key={m}
                type="button"
                className={mode === m ? 'is-active' : ''}
                aria-pressed={mode === m}
                onClick={() => onModeChange(m)}
              >
                {m === 'light' ? 'Light' : 'Dark'}
              </button>
            ))}
          </div>
        </header>
        {/* The surface is a rendering, not an interface. */}
        <div className="design-preview" style={cssVars} aria-hidden="true">
          <header className="dp-nav">
            {logoSrc ? (
              <img className="dp-logo" src={logoSrc} alt="" />
            ) : (
              <span className="dp-monogram">{monogram}</span>
            )}
            <strong>{name.trim() || 'Untitled'}</strong>
          </header>
          <h3 className="dp-display">Make it feel like yours</h3>
          <p className="dp-body">
            Body copy set in the app font. <span className="dp-muted">Muted text carries the
            secondary voice.</span>
          </p>
          <div className="dp-buttons">
            <span className="dp-btn dp-btn-primary">Primary</span>
            <span className="dp-btn dp-btn-quiet">Quiet</span>
            <span className="dp-btn dp-btn-danger">Danger</span>
          </div>
          <div className="dp-card">
            <strong>Card title</strong>
            <span className="dp-mono">npx create-anything</span>
          </div>
          <div className="dp-palette-row">
            {colorChips.map((chip) => (
              <span
                key={chip.name}
                className="dp-chip"
                title={chip.name}
                style={{ background: chip.value }}
              />
            ))}
          </div>
        </div>
      </section>
    </aside>
  )
}
