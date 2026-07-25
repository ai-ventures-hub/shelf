/**
 * Copy the packaged Shelf.app to Desktop / Applications without rewriting
 * Framework relative symlinks (Node fs.cpSync turns them into absolute links
 * and breaks Electron's GPU/ICU sandbox on macOS).
 */
import { existsSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const release = path.join(root, 'release')

const candidates = [
  path.join(release, 'mac-arm64', 'Shelf.app'),
  path.join(release, 'mac', 'Shelf.app'),
  path.join(release, 'mac-x64', 'Shelf.app'),
]

const appPath = candidates.find((p) => existsSync(p))
if (!appPath) {
  console.error('Shelf.app not found under release/. Run npm run package:mac first.')
  process.exit(1)
}

function installCopy(source, destination) {
  if (existsSync(destination)) {
    rmSync(destination, { recursive: true, force: true })
  }
  // ditto preserves macOS resource forks and relative symlinks inside .app bundles.
  const result = spawnSync('ditto', [source, destination], { encoding: 'utf8' })
  if (result.status !== 0) {
    throw new Error(result.stderr || `ditto failed for ${destination}`)
  }
  spawnSync('xattr', ['-cr', destination], { encoding: 'utf8' })
}

// Prefer /Applications as the durable install (MCP Connect writes that path when present).
const applicationsTarget = path.join('/Applications', 'Shelf.app')
const desktopTarget = path.join(os.homedir(), 'Desktop', 'Shelf.app')
let applicationsInstalled = false

try {
  installCopy(appPath, applicationsTarget)
  applicationsInstalled = true
  console.log(`Installed: ${applicationsTarget}`)
} catch (err) {
  console.warn(
    `Skipped /Applications copy (${err instanceof Error ? err.message : String(err)}).`,
  )
}

installCopy(appPath, desktopTarget)
console.log(`Installed: ${desktopTarget}`)

// Sanity: Framework Resources must be a relative symlink, not an absolute path.
const verifyRoot = applicationsInstalled ? applicationsTarget : desktopTarget
const resourcesLink = spawnSync(
  'readlink',
  [
    path.join(
      verifyRoot,
      'Contents/Frameworks/Electron Framework.framework/Resources',
    ),
  ],
  { encoding: 'utf8' },
)
const linkTarget = (resourcesLink.stdout || '').trim()
if (linkTarget.startsWith('/')) {
  console.error(
    `Broken install: Framework Resources symlink is absolute (${linkTarget}).`,
  )
  process.exit(1)
}
console.log(`OK: Framework Resources -> ${linkTarget}`)
if (applicationsInstalled) {
  console.log(
    'Open Shelf from /Applications (preferred). MCP Connect uses that path when both copies exist.',
  )
  console.log(
    'Desktop copy is optional — first launch may require right-click → Open (unsigned prototype).',
  )
} else {
  console.log(
    'Open Shelf from Desktop — first launch may require right-click → Open (unsigned prototype).',
  )
}
