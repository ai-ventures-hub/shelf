/**
 * Global show/hide shortcut presets shared by main process and Settings UI.
 * Keep accelerators in Electron syntax so register/unregister stay consistent.
 */

export const DEFAULT_GLOBAL_SHORTCUT = 'Command+Shift+Space'

export interface GlobalShortcutPreset {
  accelerator: string
  /** Compact macOS glyph label for chips. */
  label: string
}

/** Common alternatives when the default is already owned by Spotlight/other apps. */
export const GLOBAL_SHORTCUT_PRESETS: GlobalShortcutPreset[] = [
  { accelerator: 'Command+Shift+Space', label: '⌘⇧Space' },
  { accelerator: 'Alt+Space', label: '⌥Space' },
  { accelerator: 'Control+Shift+S', label: '⌃⇧S' },
  { accelerator: 'Command+Option+Space', label: '⌘⌥Space' },
]

export interface ShortcutStatus {
  ok: boolean
  accelerator: string
  /** Present when registration failed (usually another app owns the key). */
  error?: string
}
