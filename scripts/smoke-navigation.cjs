/** Real Electron navigation and redirect isolation, with throwaway local origins. */
const { app, BrowserWindow } = require('electron')
const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const http = require('node:http')
const { pathToFileURL } = require('node:url')
const { allowedRendererNavigation, installRendererNavigationGuard } = require('../dist-electron/electron/navigation-policy')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shelf-navigation-'))
app.setPath('userData', path.join(root, 'profile'))
let source, foreign, win
async function run() {
  let foreignHits = 0
  foreign = http.createServer((_req, res) => { foreignHits++; res.end('<title>Foreign</title>') })
  await new Promise(resolve => foreign.listen(0, '127.0.0.1', resolve))
  const target = `http://127.0.0.1:${foreign.address().port}/owned`
  source = http.createServer((req, res) => {
    if (req.url === '/redirect') res.writeHead(302, { location: target })
    else res.setHeader('content-type', 'text/html')
    res.end('<title>Shelf fixture</title>')
  })
  await new Promise(resolve => source.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${source.address().port}`
  const bundlePath = path.join(root, 'index.html')
  fs.writeFileSync(bundlePath, '<title>Bundle</title>')
  const policy = { bundlePath, devOrigin: origin }
  for (const bad of [`${origin}@127.0.0.1:${foreign.address().port}/owned`, `${origin}.evil/`, target, `${pathToFileURL(bundlePath).href}.evil`, 'javascript:alert(1)', 'not a URL']) {
    assert.equal(allowedRendererNavigation(bad, policy), false, bad)
  }
  assert.equal(allowedRendererNavigation(origin + '/src/main.tsx', policy), true)
  assert.equal(allowedRendererNavigation(pathToFileURL(bundlePath).href + '#/settings', { bundlePath }), true)
  assert.equal(allowedRendererNavigation(origin, { bundlePath }), false)
  const preload = path.join(root, 'preload.cjs')
  fs.writeFileSync(preload, "require('electron').contextBridge.exposeInMainWorld('fixturePreload',true)")
  win = new BrowserWindow({ show: false, webPreferences: { preload, sandbox: true, contextIsolation: true, nodeIntegration: false } })
  installRendererNavigationGuard(win.webContents, policy)
  await win.loadURL(origin)
  assert.equal(await win.webContents.executeJavaScript('window.fixturePreload'), true)
  const blocked = new Promise(resolve => win.webContents.once('will-navigate', event => resolve(event.defaultPrevented)))
  await win.webContents.executeJavaScript(`location.href=${JSON.stringify(`${origin}@127.0.0.1:${foreign.address().port}/owned`)};void 0`)
  assert.equal(await blocked, true, 'userinfo navigation is blocked by the installed guard')
  assert.equal(win.webContents.getURL(), origin + '/')
  const redirected = new Promise(resolve => win.webContents.once('will-redirect', event => resolve(event.defaultPrevented)))
  await assert.rejects(win.loadURL(origin + '/redirect'), 'initial-load redirects are guarded too')
  assert.equal(await redirected, true)
  assert.equal(foreignHits, 0, 'the foreign origin never receives a request or the preload')
  console.log('OK: normalized origins, userinfo refusal, exact bundle URL, and real dev redirect guard')
}
async function finish(code) {
  win?.destroy()
  for (const server of [source, foreign]) if (server) await new Promise(resolve => { server.closeAllConnections(); server.close(resolve) })
  fs.rmSync(root, { recursive: true, force: true })
  console.log(`SMOKE_RESULT ${code === 0 ? 'pass' : 'fail'}`)
  app.exit(code)
}
app.whenReady().then(run).then(() => finish(0), err => { console.error(err); return finish(1) })
setTimeout(() => { console.error('navigation smoke timed out'); void finish(1) }, 15000).unref()
