/**
 * Live brand preview — a miniature branded surface driven entirely by the
 * editor's draft tokens via inline --dp-* custom properties, so every
 * keystroke repaints it before anything is saved. Inert by design: it's a
 * picture of the brand, not a form.
 *
 * Token lookups use ordered aliases matching the app's canonical vocabulary
 * (surface = page canvas, panel = card) with hard fallbacks, so a missing
 * token can never break the preview. Declared font families render with the
 * profile's own imported font files when a font asset's filename matches a
 * declared family (registered under a dp-preview-* name so they can never
 * shadow the app's fonts); otherwise only locally installed fonts show and
 * fallback stacks apply.
 */
import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { flattenGroup, resolveModeTokens } from '../../lib/designTokens'
import type { DesignAsset, DesignTokenGroup } from '../../types'

interface DesignPreviewProps {
  name: string
  tokens: DesignTokenGroup
  modes: { light: DesignTokenGroup; dark: DesignTokenGroup }
  assets: DesignAsset[]
  /** Changes whenever the profile is saved — busts stale logo/font caches. */
  refreshKey: string
  mode: 'light' | 'dark'
  onModeChange: (mode: 'light' | 'dark') => void
}

function usePreviewLogo(assets: DesignAsset[], refreshKey: string): string | null {
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
    // refreshKey: same-basename re-import overwrites the file at this path.
  }, [logo?.path, refreshKey])
  return src
}

const FONT_EXT = /\.(woff2?|ttf|otf)$/i
const MAX_PREVIEW_FONTS = 8

const normalizeFamily = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, '')

/** Deterministic weight/style from the filename — a preview nicety, not metadata. */
function faceDescriptors(basename: string): { weight: string; style: string } {
  const b = basename.toLowerCase()
  const weight = /variable|\[wght\]|-vf\b/.test(b)
    ? '100 1000'
    : /black|heavy/.test(b)
      ? '900'
      : /extrabold|ultrabold/.test(b)
        ? '800'
        : /semibold|demibold/.test(b)
          ? '600'
          : /bold/.test(b)
            ? '700'
            : /medium/.test(b)
              ? '500'
              : /extralight|ultralight/.test(b)
                ? '200'
                : /light/.test(b)
                  ? '300'
                  : /thin|hairline/.test(b)
                    ? '100'
                    : '400'
  return { weight, style: /italic|oblique/.test(b) ? 'italic' : 'normal' }
}

/**
 * Register the profile's imported font files with the document under
 * prefixed dp-preview-* family names, matched to declared families by
 * filename. Returns normalized-family → preview-family for the matched set.
 */
function usePreviewFonts(
  assets: DesignAsset[],
  familyNames: string[],
  refreshKey: string,
): Map<string, string> {
  const [loaded, setLoaded] = useState<Map<string, string>>(new Map())
  const assetsKey = assets
    .filter((a) => FONT_EXT.test(a.path))
    .map((a) => a.path)
    .join('|')
  const familiesKey = familyNames.join('|')

  useEffect(() => {
    let cancelled = false
    const added: FontFace[] = []
    const fontPaths = assetsKey ? assetsKey.split('|') : []
    setLoaded(new Map())
    if (fontPaths.length === 0 || !window.shelf?.designAssetDataUrl) return

    void (async () => {
      const map = new Map<string, string>()
      for (const fontPath of fontPaths.slice(0, MAX_PREVIEW_FONTS)) {
        const basename = fontPath.split('/').pop() || fontPath
        const normBase = normalizeFamily(basename.replace(FONT_EXT, ''))
        const family = familyNames.find((f) => normBase.includes(normalizeFamily(f)))
        if (!family) continue
        try {
          const url = await window.shelf.designAssetDataUrl(fontPath)
          if (!url || cancelled) continue
          const previewName = `dp-preview-${normalizeFamily(family)}`
          const { weight, style } = faceDescriptors(basename)
          const face = new FontFace(previewName, `url(${url})`, {
            weight,
            style,
            display: 'swap',
          })
          await face.load()
          if (cancelled) return
          document.fonts.add(face)
          added.push(face)
          map.set(normalizeFamily(family), previewName)
          setLoaded(new Map(map))
        } catch {
          // Unloadable file — the fallback stack still renders.
        }
      }
    })()

    return () => {
      cancelled = true
      for (const face of added) document.fonts.delete(face)
    }
  }, [assetsKey, familiesKey, refreshKey])

  return loaded
}

export function DesignPreview({
  name,
  tokens,
  modes,
  assets,
  refreshKey,
  mode,
  onModeChange,
}: DesignPreviewProps) {
  const logoSrc = usePreviewLogo(assets, refreshKey)

  // First family name of every declared stack — the match targets for
  // imported font files.
  const familyNames = useMemo(
    () =>
      flattenGroup(tokens)
        .filter((leaf) => leaf.path.startsWith('typography.font-family.'))
        .map((leaf) => String(leaf.value).split(',')[0].trim().replace(/^['"]|['"]$/g, ''))
        .filter(Boolean),
    [tokens],
  )
  const previewFonts = usePreviewFonts(assets, familyNames, refreshKey)

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
      if (typeof v !== 'string' || !v) return fallback
      // Prepend the imported face (if one matched this stack's first family)
      // so the preview shows the profile's actual font, not just local ones.
      const first = v.split(',')[0].trim().replace(/^['"]|['"]$/g, '')
      const previewName = previewFonts.get(normalizeFamily(first))
      return previewName ? `"${previewName}", ${v}, ${fallback}` : `${v}, ${fallback}`
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
  }, [tokens, modes, mode, previewFonts])

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
