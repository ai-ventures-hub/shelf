/**
 * Human label for launch provenance (mirror of launchOriginLabel in
 * shared/types.ts — the renderer compile unit cannot import shared/).
 * Client names are self-reported by MCP clients, so map known ids (most
 * specific first) and fall back to the raw name.
 */
import type { LaunchOrigin } from '../types'

const MCP_CLIENT_LABELS: Array<[string, string]> = [
  ['claude-code', 'Claude Code'],
  ['claude-desktop', 'Claude Desktop'],
  ['claude-ai', 'Claude'],
  ['claude', 'Claude'],
  ['cursor', 'Cursor'],
  ['codex', 'Codex'],
  ['windsurf', 'Windsurf'],
  ['vscode', 'VS Code'],
  ['zed', 'Zed'],
]

export function launchOriginLabel(
  origin?: LaunchOrigin,
  opts: { externalUnknown?: boolean } = {},
): string | null {
  if (!origin) return opts.externalUnknown ? 'Another agent' : null
  if (origin.kind === 'gui' || origin.kind === 'tray') return 'You'
  const raw = (origin.client || '').trim()
  if (!raw) return 'Agent'
  const key = raw.toLowerCase()
  for (const [id, label] of MCP_CLIENT_LABELS) {
    if (key === id || key.includes(id)) return label
  }
  return raw
}
