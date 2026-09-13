/** Browser-safe DTCG traversal shared by the editor and agent briefs. */
import type { DesignToken, DesignTokenGroup } from './contracts'

export function isDesignToken(node: DesignToken | DesignTokenGroup): node is DesignToken {
  return typeof node === 'object' && node !== null && '$value' in node
}

export interface FlatToken {
  path: string
  value: string | number
  type?: string
}

/** Depth-first flatten of a DTCG group into dot-path leaves. */
export function flattenTokens(group: DesignTokenGroup, prefix = ''): FlatToken[] {
  const out: FlatToken[] = []
  for (const [key, node] of Object.entries(group)) {
    // Hand-edited files can hold nulls/primitives where groups belong — skip,
    // never throw (agents read these through briefs).
    if (!node || typeof node !== 'object' || Array.isArray(node)) continue
    const tokenPath = prefix ? `${prefix}.${key}` : key
    if (isDesignToken(node)) {
      out.push({ path: tokenPath, value: node.$value, type: node.$type })
    } else {
      out.push(...flattenTokens(node, tokenPath))
    }
  }
  return out
}
