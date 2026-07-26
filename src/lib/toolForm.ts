/**
 * Pure helpers for Add/Edit tool form state.
 */
import type { Tool, UiPrefs } from '../types'

export const TOOL_FORM_ADVANCED_KEY = 'shelf.toolForm.advancedOpen'

export function emptyTool(defaults?: {
  iconLucide?: string
  iconColor?: string
  iconBackground?: string
}): Tool {
  const now = new Date().toISOString()
  return {
    id: crypto.randomUUID(),
    name: '',
    description: '',
    tags: [],
    capabilities: [],
    agentAccess: [],
    favorite: false,
    launchCommand: '',
    iconLucide: defaults?.iconLucide,
    iconColor: defaults?.iconColor,
    iconBackground: defaults?.iconBackground,
    createdAt: now,
    updatedAt: now,
  }
}

export function envToText(env?: Record<string, string>): string {
  if (!env) return ''
  return Object.entries(env)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n')
}

export function textToEnv(text: string): Record<string, string> | undefined {
  // Join wrapped continuation lines (no `=`) onto the previous KEY=value entry.
  const entries: Array<[string, string]> = []
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trimEnd()
    if (!line.trim()) continue
    const idx = line.indexOf('=')
    const looksLikeKey = idx > 0 && /^[A-Za-z_][A-Za-z0-9_]*$/.test(line.slice(0, idx).trim())
    if (looksLikeKey) {
      entries.push([line.slice(0, idx).trim(), line.slice(idx + 1)])
      continue
    }
    if (entries.length > 0) {
      entries[entries.length - 1][1] += line.trim()
    }
  }

  if (entries.length === 0) return undefined
  return Object.fromEntries(entries)
}

/** True when edit should surface Advanced so existing power-user fields aren’t hidden. */
export function toolHasAdvancedContent(tool: Tool, prefs: UiPrefs): boolean {
  if (tool.stopCommand?.trim()) return true
  if (tool.tags.length > 0) return true
  if (tool.capabilities.length > 0) return true
  if (tool.agentAccess.length > 0) return true
  if (tool.env && Object.keys(tool.env).length > 0) return true
  if (tool.notes?.trim()) return true
  if (tool.iconPath?.trim()) return true
  if (tool.iconLucide && tool.iconLucide !== prefs.defaultIconLucide) return true
  if (tool.iconColor && tool.iconColor !== prefs.defaultIconColor) return true
  if (tool.iconBackground && tool.iconBackground !== prefs.defaultIconBackground) {
    return true
  }
  return false
}
