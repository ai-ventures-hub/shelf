import { normalizeHex } from '../lib/color'

/**
 * Swatch + hex text field matching the Lucide icon color controls.
 */
export function ColorField({
  id,
  label,
  value,
  onChange,
}: {
  id: string
  label: string
  value: string
  onChange: (hex: string) => void
}) {
  // Only hex-like values get the '#' treatment — agent/JSON-authored tokens
  // may hold rgb()/color-mix() strings, which must display verbatim.
  const hexLike = !value || /^#?[0-9a-fA-F]{3,8}$/.test(value)
  const display = !hexLike || value?.startsWith('#') ? value || '' : value ? `#${value}` : ''
  const preview = normalizeHex(display) || '#000000'

  return (
    <label className="field color-field" htmlFor={id}>
      <span className="field-label">{label}</span>
      <div className="color-field-control">
        <input
          type="color"
          className="color-field-swatch"
          value={preview}
          aria-label={`${label} swatch`}
          onChange={(e) => onChange(e.target.value)}
        />
        <input
          id={id}
          className="field-input color-field-hex"
          value={display}
          spellCheck={false}
          placeholder="#ffffff"
          onChange={(e) => {
            const next = e.target.value
            // Allow free typing; only normalize when the value becomes valid.
            const normalized = normalizeHex(next)
            onChange(normalized || next)
          }}
          onBlur={() => {
            const normalized = normalizeHex(display)
            if (normalized) onChange(normalized)
          }}
        />
      </div>
    </label>
  )
}
