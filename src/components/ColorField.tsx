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
  const display = value?.startsWith('#') ? value : value ? `#${value}` : ''
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
