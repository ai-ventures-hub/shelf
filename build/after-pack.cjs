/**
 * electron-builder afterPack hook (runs before signing).
 *
 * `electron-builder --mac dir` (npm run package:mac → install:desktop) skips
 * app-update.yml because no distributable target is built, so a locally
 * installed Shelf has no update feed and electron-updater fails every check
 * with ENOENT ("Update failed" in the sidebar). Release builds (dmg + zip)
 * already get the file from electron-builder; this writes the same file
 * when it is missing so a dir build updates like a released one.
 */
const fs = require('node:fs')
const path = require('node:path')

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return
  const publish = context.packager.config.publish
  if (!publish || Array.isArray(publish) || publish.provider !== 'github') return
  const resources = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
  const target = path.join(resources, 'app-update.yml')
  if (fs.existsSync(target)) return
  const name = context.packager.appInfo.name.toLowerCase()
  const lines = [
    `owner: ${publish.owner}`,
    `repo: ${publish.repo}`,
    `provider: ${publish.provider}`,
    ...(publish.releaseType ? [`releaseType: ${publish.releaseType}`] : []),
    `updaterCacheDirName: ${name}-updater`,
    '',
  ]
  fs.writeFileSync(target, lines.join('\n'))
  console.log(`  • wrote ${path.relative(context.appOutDir, target)} (dir build has no update feed by default)`)
}
