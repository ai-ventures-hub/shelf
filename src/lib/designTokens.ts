/**
 * Renderer-side DTCG token utilities for the Design editor. The renderer
 * cannot import shared/, so isDesignToken/flatten logic is mirrored here
 * (source of truth: shared/types.ts + shared/design-brief.ts).
 */
import type { DesignToken, DesignTokenGroup } from '../types'

export interface FlatToken {
  path: string
  value: string | number
  type?: string
}

export function isDesignToken(node: DesignToken | DesignTokenGroup): node is DesignToken {
  return typeof node === 'object' && node !== null && '$value' in node
}

/** Depth-first flatten into dot-path leaves. */
export function flattenGroup(group: DesignTokenGroup, prefix = ''): FlatToken[] {
  const out: FlatToken[] = []
  for (const [key, node] of Object.entries(group)) {
    // Skip nulls/primitives from hand-edited or agent-written files — the
    // editor must render whatever the store tolerates.
    if (!node || typeof node !== 'object' || Array.isArray(node)) continue
    const tokenPath = prefix ? `${prefix}.${key}` : key
    if (isDesignToken(node)) {
      out.push({ path: tokenPath, value: node.$value, type: node.$type })
    } else {
      out.push(...flattenGroup(node, tokenPath))
    }
  }
  return out
}

/** Leaves under one group path (e.g. 'color' or 'typography.font-family'). */
export function leavesOf(tokens: DesignTokenGroup, groupPath: string): FlatToken[] {
  let node: DesignToken | DesignTokenGroup | undefined = tokens
  for (const key of groupPath.split('.')) {
    if (!node || isDesignToken(node)) return []
    node = node[key]
  }
  if (!node || isDesignToken(node)) return []
  return flattenGroup(node, groupPath)
}

export function colorLeaves(tokens: DesignTokenGroup): FlatToken[] {
  return leavesOf(tokens, 'color')
}

/** Immutable set of a leaf at a dot-path; creates intermediate groups. */
export function setToken(
  group: DesignTokenGroup,
  path: string,
  value: string | number,
  type?: string,
): DesignTokenGroup {
  const [head, ...rest] = path.split('.')
  const existing = group[head]
  if (rest.length === 0) {
    const prior = existing && isDesignToken(existing) ? existing : undefined
    return { ...group, [head]: { ...prior, $value: value, ...(type ? { $type: type } : {}) } }
  }
  const child = existing && !isDesignToken(existing) ? existing : {}
  return { ...group, [head]: setToken(child, rest.join('.'), value, type) }
}

/** Immutable delete of a leaf; prunes emptied intermediate groups. */
export function deleteToken(group: DesignTokenGroup, path: string): DesignTokenGroup {
  const [head, ...rest] = path.split('.')
  if (!(head in group)) return group
  const next = { ...group }
  if (rest.length === 0) {
    delete next[head]
    return next
  }
  const child = next[head]
  if (!child || isDesignToken(child)) return group
  const pruned = deleteToken(child, rest.join('.'))
  if (Object.keys(pruned).length === 0) delete next[head]
  else next[head] = pruned
  return next
}

/** 'font-family.app' → 'Font family app'; 'brand-strong' → 'Brand strong'. */
export function humanizeTokenName(name: string): string {
  const flat = name.replace(/[.\-_]/g, ' ').trim()
  return flat ? flat[0].toUpperCase() + flat.slice(1) : name
}

/** Base tokens overlaid with one mode's overrides, as a flat path→value map. */
export function resolveModeTokens(
  tokens: DesignTokenGroup,
  modeOverrides: DesignTokenGroup,
): Map<string, string | number> {
  const resolved = new Map<string, string | number>()
  for (const token of flattenGroup(tokens)) resolved.set(token.path, token.value)
  for (const token of flattenGroup(modeOverrides)) resolved.set(token.path, token.value)
  return resolved
}

/**
 * Seed for GUI-created profiles: canonical Shelf token names (so the editor,
 * preview, and brand brief all understand them) with a neutral palette the
 * user immediately replaces. An empty profile would open onto a dead editor.
 */
export const STARTER_TOKENS: DesignTokenGroup = {
  color: {
    ink: { $value: '#1b1d22', $type: 'color' },
    muted: { $value: '#5c6470', $type: 'color' },
    surface: { $value: '#f7f7f8', $type: 'color' },
    panel: { $value: '#ffffff', $type: 'color' },
    line: { $value: '#dcdfe5', $type: 'color' },
    brand: { $value: '#4459d8', $type: 'color' },
    danger: { $value: '#c4444c', $type: 'color' },
  },
  typography: {
    'font-family': {
      app: { $value: 'Inter, system-ui, sans-serif', $type: 'fontFamily' },
      display: { $value: 'Inter, system-ui, sans-serif', $type: 'fontFamily' },
      mono: { $value: 'ui-monospace, monospace', $type: 'fontFamily' },
    },
    'font-weight': {
      regular: { $value: 400, $type: 'fontWeight' },
      bold: { $value: 700, $type: 'fontWeight' },
    },
  },
  dimension: {
    'radius-card': { $value: '16px', $type: 'dimension' },
    'radius-control': { $value: '11px', $type: 'dimension' },
    'content-max': { $value: '1100px', $type: 'dimension' },
  },
}
