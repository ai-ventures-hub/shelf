/**
 * Official client brand marks, resolved by filename convention from
 * src/assets/clients/ (see the README there for the drop spec). Missing files
 * simply return null and the UI falls back to lettermarks, so the folder can
 * be empty without breaking the build.
 */
import type { McpClientKind } from './mcpConnectionStatus'

const LOGO_FILES = import.meta.glob('../assets/clients/*.{svg,png}', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>

function lookup(name: string): string | undefined {
  return (
    LOGO_FILES[`../assets/clients/${name}.svg`] ||
    LOGO_FILES[`../assets/clients/${name}.png`]
  )
}

export function clientLogoUrl(
  kind: McpClientKind,
  theme: 'light' | 'dark',
): string | null {
  if (theme === 'dark') {
    const dark = lookup(`${kind}-dark`)
    if (dark) return dark
  }
  return lookup(kind) || null
}
