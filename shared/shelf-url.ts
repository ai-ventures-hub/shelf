/**
 * Parse OS-level shelf:// URLs (not MCP resource URIs).
 *
 * Examples:
 * - shelf://open
 * - shelf://quick-open
 * - shelf://tools/{id}
 * - shelf://tools/{id}/launch
 * - shelf://tools/{id}/stop
 * - shelf://launch?name=Image%20Prepper
 * - shelf://add?repo=https%3A%2F%2Fgithub.com%2Forg%2Ftool   (Tool Sharing)
 *
 * `add` carries ONLY the repo URL. There is deliberately no parameter that
 * could pre-fill consent (folder, env, "run setup") — the sheet the GUI
 * shows is the only place those are decided.
 */

export type ShelfUrlAction =
  | 'open'
  | 'quick-open'
  | 'navigate'
  | 'launch'
  | 'stop'
  | 'restart'
  | 'add'
  | 'unknown'

export interface ParsedShelfUrl {
  action: ShelfUrlAction
  route?: string
  toolId?: string
  toolName?: string
  /** Repository URL for `add` (unvalidated here; the share engine allow-lists it). */
  repo?: string
}

export function parseShelfUrl(raw: string): ParsedShelfUrl {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return { action: 'unknown' }
  }
  if (url.protocol !== 'shelf:') return { action: 'unknown' }

  const host = url.hostname || ''
  const parts = url.pathname.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean)

  // shelf://open | shelf://quick-open | shelf://settings …
  // Note: empty host also covers path-led forms like shelf:///tools/… — don't
  // treat those as bare "open" before the tools/ path branch runs.
  if (!host || host === 'open') {
    if (parts[0] === 'quick-open') return { action: 'quick-open' }
    if (parts[0] === 'settings') return { action: 'navigate', route: '/settings' }
    if (parts[0] === 'mcp') return { action: 'navigate', route: '/mcp' }
    if (parts[0] === 'library' || host === 'open' || parts.length === 0) {
      return { action: 'open', route: '/' }
    }
  }

  if (host === 'quick-open') return { action: 'quick-open' }
  if (host === 'settings') return { action: 'navigate', route: '/settings' }
  if (host === 'mcp') return { action: 'navigate', route: '/mcp' }
  if (host === 'library') return { action: 'navigate', route: '/' }

  // shelf://launch?id=… or ?name=…
  if (host === 'launch') {
    return {
      action: 'launch',
      toolId: url.searchParams.get('id') || undefined,
      toolName: url.searchParams.get('name') || undefined,
    }
  }

  // shelf://add?repo=… — open the Add-from-URL consent flow (never auto-confirms).
  if (host === 'add') {
    const repo = (url.searchParams.get('repo') || '').trim()
    return repo ? { action: 'add', repo, route: '/' } : { action: 'open', route: '/' }
  }

  // shelf://tools/{id}[/launch|stop|restart]
  if (host === 'tools' && parts[0]) {
    const toolId = parts[0]
    const verb = parts[1]
    if (verb === 'launch') return { action: 'launch', toolId, route: `/tools/${toolId}` }
    if (verb === 'stop') return { action: 'stop', toolId, route: `/tools/${toolId}` }
    if (verb === 'restart') return { action: 'restart', toolId, route: `/tools/${toolId}` }
    return { action: 'navigate', toolId, route: `/tools/${toolId}` }
  }

  // shelf:///tools/{id}/… (empty hostname, path-led)
  if (parts[0] === 'tools' && parts[1]) {
    const toolId = parts[1]
    const verb = parts[2]
    if (verb === 'launch') return { action: 'launch', toolId, route: `/tools/${toolId}` }
    if (verb === 'stop') return { action: 'stop', toolId, route: `/tools/${toolId}` }
    if (verb === 'restart') return { action: 'restart', toolId, route: `/tools/${toolId}` }
    return { action: 'navigate', toolId, route: `/tools/${toolId}` }
  }

  return { action: 'open' }
}
