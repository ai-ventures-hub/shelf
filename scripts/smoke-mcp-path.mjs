/**
 * Smoke: MCP server path prefers /Applications/Shelf.app over ~/Desktop.
 */
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  mcpPathMigrationHint,
  packagedMcpServerPath,
  resolveMcpServerPath,
} from '../dist-electron/shared/mcp-server-path.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const home = '/tmp/shelf-mcp-path-home'
const appsServer = packagedMcpServerPath('/Applications/Shelf.app')
const desktopServer = packagedMcpServerPath(path.join(home, 'Desktop', 'Shelf.app'))
const distServer = path.join(root, 'dist-mcp', 'mcp', 'server.js')

function withExists(paths) {
  const set = new Set(paths.map((p) => path.resolve(p)))
  return (candidate) => set.has(path.resolve(candidate))
}

// Both Applications + Desktop → Applications wins.
{
  const resolved = resolveMcpServerPath({
    home,
    resourcesPath: path.join(home, 'Desktop', 'Shelf.app', 'Contents', 'Resources'),
    existsSync: withExists([appsServer, desktopServer]),
  })
  assert.equal(resolved, path.resolve(appsServer))
  console.log('OK: Applications preferred over Desktop')
}

// Desktop only → Desktop.
{
  const resolved = resolveMcpServerPath({
    home,
    resourcesPath: path.join(home, 'Desktop', 'Shelf.app', 'Contents', 'Resources'),
    existsSync: withExists([desktopServer]),
  })
  assert.equal(resolved, path.resolve(desktopServer))
  console.log('OK: Desktop used when Applications missing')
}

// Dev fallback when no packaged app.
{
  const resolved = resolveMcpServerPath({
    home,
    appPath: root,
    existsSync: withExists([distServer]),
  })
  assert.equal(resolved, path.resolve(distServer))
  console.log('OK: dist-mcp used in dev when no .app')
}

// Migration hint only for Desktop → Applications.
{
  const hint = mcpPathMigrationHint(appsServer, desktopServer)
  assert.match(hint || '', /Applications/)
  assert.equal(mcpPathMigrationHint(appsServer, appsServer), null)
  assert.equal(mcpPathMigrationHint(appsServer, distServer), null)
  console.log('OK: Desktop→Applications migration hint')
}

console.log('OK: mcp path smoke passed')
