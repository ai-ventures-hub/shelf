/** Isolated desktop launch/idle probe. Run after build with Electron; never installs the app. */
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs'),
  os = require('node:os'),
  path = require('node:path')
const cp = require('node:child_process')
const { performance } = require('node:perf_hooks')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shelf-benchmark-'))
process.env.SHELF_DATA_ROOT = root
const { LibraryStore } = require('../dist-electron/shared/library-store')
const { DEFAULT_UI_PREFS } = require('../dist-electron/shared/types')
fs.writeFileSync(
  path.join(root, 'prefs.json'),
  JSON.stringify({
    ...DEFAULT_UI_PREFS,
    globalShortcutEnabled: false,
    menuBarEnabled: false,
    closeToMenuBar: false,
    launchAtLogin: false,
    onboardingCompletedVersion: 'benchmark',
  }),
)
const store = new LibraryStore(root)
for (let i = 0; i < 16; i++)
  store.save({
    name: `Benchmark ${i}`,
    launchCommand: 'node app.js',
    projectPath: root,
    port: 61000 + i,
    iconLucide: i % 2 ? 'Box' : 'Wrench',
  })
const probes = { lsof: 0, ps: 0 }
const execFile = cp.execFile
cp.execFile = function (file, ...args) {
  const name = path.basename(file)
  if (name in probes) probes[name]++
  return execFile.call(this, file, ...args)
}
// Preserve Node's custom promisify implementation; otherwise instrumentation changes return types.
const { promisify } = require('node:util')
cp.execFile[promisify.custom] = function (file, ...args) {
  const name = path.basename(file)
  if (name in probes) probes[name]++
  return execFile[promisify.custom].call(this, file, ...args)
}
app.setAsDefaultProtocolClient = () => true
const start = performance.now()
app.on('browser-window-created', (_event, win) => {
  win.webContents.once('did-finish-load', async () => {
    try {
      await win.webContents.executeJavaScript(
        `new Promise(resolve => { const check=()=>{if(document.querySelectorAll('.tool-card').length===16) requestAnimationFrame(()=>requestAnimationFrame(resolve)); else setTimeout(check,10)};check() })`,
      )
      const launchMs = Math.round(performance.now() - start)
      const initialProbes = { ...probes }
      setTimeout(() => {
        const result = {
          launchMs,
          initialProbes,
          idle15sProbes: {
            lsof: probes.lsof - initialProbes.lsof,
            ps: probes.ps - initialProbes.ps,
          },
          note: 'Process entry to populated renderer after two animation frames; warm OS cache, isolated 16-tool library.',
        }
        console.log(JSON.stringify(result))
        for (const w of BrowserWindow.getAllWindows()) w.destroy()
        fs.rmSync(root, { recursive: true, force: true })
        app.exit(0)
      }, 15_000)
    } catch (error) {
      console.error(error)
      app.exit(1)
    }
  })
})
setTimeout(() => {
  console.error('Benchmark timed out')
  app.exit(1)
}, 60_000).unref()
require('../dist-electron/electron/main')
