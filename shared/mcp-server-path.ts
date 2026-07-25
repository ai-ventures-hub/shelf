import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** Packaged MCP bundle path inside Shelf.app (electron-builder extraResources → mcp/). */
export const MCP_SERVER_REL = path.join(
  'Contents',
  'Resources',
  'mcp',
  'mcp',
  'server.js',
)

/** Older / alternate layout if Resources/mcp/server.js is used without nested mcp/. */
export const MCP_SERVER_REL_ALT = path.join(
  'Contents',
  'Resources',
  'mcp',
  'server.js',
)

export interface ResolveMcpServerPathOpts {
  home?: string
  /** Electron `process.resourcesPath` when packaged. */
  resourcesPath?: string
  /** Electron `app.getAppPath()` or project root (dev `dist-mcp`). */
  appPath?: string
  /** Extra fallbacks (e.g. `__dirname`-relative dist-mcp). */
  extraCandidates?: string[]
  /** Injected for smoke tests. */
  existsSync?: (candidate: string) => boolean
}

/** Absolute MCP server.js path for a given Shelf.app bundle. */
export function packagedMcpServerPath(appBundle: string): string {
  return path.join(appBundle, MCP_SERVER_REL)
}

/**
 * Resolve the absolute MCP `server.js` path written into Claude/Cursor/Codex.
 * Prefer `/Applications/Shelf.app` over `~/Desktop/Shelf.app` when both exist
 * so Connect configs survive deleting the Desktop copy.
 */
export function resolveMcpServerPath(opts: ResolveMcpServerPathOpts = {}): string {
  const home = opts.home ?? os.homedir()
  const exists = opts.existsSync ?? ((p: string) => fs.existsSync(p))

  const applicationsApp = path.join('/Applications', 'Shelf.app')
  const desktopApp = path.join(home, 'Desktop', 'Shelf.app')

  const candidates: string[] = [
    // Soft-launch preference: durable install location first.
    path.join(applicationsApp, MCP_SERVER_REL),
    path.join(applicationsApp, MCP_SERVER_REL_ALT),
  ]

  // Currently running packaged app (Applications or Desktop).
  if (opts.resourcesPath) {
    candidates.push(
      path.join(opts.resourcesPath, 'mcp', 'mcp', 'server.js'),
      path.join(opts.resourcesPath, 'mcp', 'server.js'),
    )
  }

  // Desktop install after Applications / running app.
  candidates.push(
    path.join(desktopApp, MCP_SERVER_REL),
    path.join(desktopApp, MCP_SERVER_REL_ALT),
  )

  if (opts.appPath) {
    candidates.push(path.join(opts.appPath, 'dist-mcp', 'mcp', 'server.js'))
  }

  if (opts.extraCandidates?.length) {
    candidates.push(...opts.extraCandidates)
  }

  for (const candidate of candidates) {
    if (candidate && exists(candidate)) return path.resolve(candidate)
  }

  // Documented default when nothing is installed yet (UI can show MCP missing).
  return path.resolve(path.join(applicationsApp, MCP_SERVER_REL))
}

/**
 * Hint when a client still points at the Desktop copy but Connect prefers Applications.
 */
export function mcpPathMigrationHint(
  preferredPath: string,
  configuredPath: string | undefined,
): string | null {
  if (!configuredPath) return null
  const preferred = path.resolve(preferredPath)
  const configured = path.resolve(configuredPath)
  if (preferred === configured) return null

  const appsMarker = `${path.sep}Applications${path.sep}Shelf.app${path.sep}`
  const desktopMarker = `${path.sep}Desktop${path.sep}Shelf.app${path.sep}`
  if (preferred.includes(appsMarker) && configured.includes(desktopMarker)) {
    return 'Shelf prefers /Applications/Shelf.app for MCP. Connect again to update the path.'
  }
  return null
}
