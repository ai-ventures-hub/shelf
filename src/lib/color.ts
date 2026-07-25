/** Normalize user hex input to #rrggbb when valid; otherwise null. */
export function normalizeHex(input: string): string | null {
  const raw = input.trim()
  const match = raw.match(/^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/)
  if (!match) return null
  let hex = match[1]
  if (hex.length === 3) {
    hex = hex
      .split('')
      .map((c) => c + c)
      .join('')
  }
  return `#${hex.toLowerCase()}`
}

export function isHexColor(input: string): boolean {
  return normalizeHex(input) != null
}
