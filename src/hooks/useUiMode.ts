/**
 * The single seam for reading the presentation mode. Components gate whole
 * panels/items on `isDeveloper`; shared leaf components stay mode-blind.
 */
import { usePrefs } from './usePrefs'
import type { UiMode } from '../types'

export function useUiMode() {
  const { prefs, updatePrefs } = usePrefs()
  const mode: UiMode = prefs.uiMode ?? 'developer'
  return {
    mode,
    isDeveloper: mode === 'developer',
    setMode: (next: UiMode) => updatePrefs({ uiMode: next }),
  }
}
