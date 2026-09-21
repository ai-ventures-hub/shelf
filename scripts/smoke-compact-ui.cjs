/** Real renderer regression checks in an isolated Electron profile. Run after build.
 * Processes and external navigation are fixture IPC; no tools actually execute.
 * SHELF_UI_CAPTURE_DIR optionally retains screenshots for visual review.
 */
const { app, ipcMain } = require('electron')
const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shelf-compact-ui-'))
process.env.SHELF_DATA_ROOT = root
app.setPath('userData', path.join(root, 'electron'))
app.setAsDefaultProtocolClient = () => true
app.setLoginItemSettings = () => {}
const { LibraryStore } = require('../dist-electron/shared/library-store')
const { DEFAULT_UI_PREFS } = require('../dist-electron/shared/types')
fs.writeFileSync(path.join(root, 'prefs.json'), JSON.stringify({ ...DEFAULT_UI_PREFS, viewMode: 'compact', appearance: 'dark', uiMode: 'simple', globalShortcutEnabled: false, menuBarEnabled: false, closeToMenuBar: false, launchAtLogin: false, onboardingCompletedVersion: '2.0.0', windowBounds: { width: 1800, height: 910 } }))
const names = ['AI Movie Studio', 'AI Ventures Brand', 'Asset Engine', 'Audio Transcriber', 'Client Onboarding', 'Codex MCP Viewer', 'Image Prepper', 'Image Studio', 'Lunch Planner', 'MCP Claude Setup', 'MCP Codex Setup', 'Render Bay', 'SEO/AEO Auditor', 'Suds Work Queue', 'Two Fit Journey', 'Vertical Onboarder', 'WordPress Fleet']
const icons = ['Clapperboard', 'Palette', 'Sparkles', 'AudioLines', 'ClipboardList', 'Cable', 'Image', 'Images', 'Utensils', 'Settings', 'Terminal', 'Box', 'Search', 'List', 'Dumbbell', 'Layers', 'PanelsTopLeft']
const store = new LibraryStore(root)
names.forEach((name, i) => store.save({ id: `compact-${i}`, name, projectPath: root, launchCommand: 'echo fixture', url: 'http://127.0.0.1:4408', port: 4408, description: 'A local tool for your daily work.', iconLucide: icons[i], favorite: i === 1, iconBackground: i === 15 ? '#dc1238' : ['#7895ff', '#a34bfa', '#30b8d4'][i % 3], tags: [] }))
const states = [4, 13, 16].map(i => ({ toolId: `compact-${i}`, status: 'running' }))
let health = [{ toolId: 'compact-15', launchable: false, problems: ['Port 4408 is in use by another process.'] }]
let suggestions = []
const calls = []
const errors = []
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
async function run(win) {
  const js = code => win.webContents.executeJavaScript(code, true)
  async function press(keyCode) {
    app.focus({ steal: true })
    win.focus()
    win.webContents.focus()
    await pause(30)
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode })
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode })
  }
  async function until(code) {
    for (let i = 0; i < 100; i++) { if (await js(code)) return; await pause(50) }
    throw Error(`Timed out: ${code}`)
  }
  async function capture(name) {
    if (!process.env.SHELF_UI_CAPTURE_DIR) return
    await pause(150)
    fs.mkdirSync(process.env.SHELF_UI_CAPTURE_DIR, { recursive: true })
    fs.writeFileSync(path.join(process.env.SHELF_UI_CAPTURE_DIR, `${name}.png`), (await win.webContents.capturePage()).toPNG())
  }
  async function click(selector) {
    await js(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'nearest'})`)
    await js(`document.querySelector(${JSON.stringify(selector)}).click()`)
    await pause(100)
  }
  async function mode(label) { await js(`[...document.querySelectorAll('.view-toggle button')].find(b=>b.textContent==='${label}').click()`); await pause(150) }
  async function fit() {
    const problems = await js(`(() => {
      const problems=[];
      for(const card of document.querySelectorAll('.tool-card-compact')) {
        const r=card.getBoundingClientRect();
        if(r.width < 219) problems.push('narrow tile');
        const buttons=[...card.querySelectorAll('.tool-card-controls button')];
        for(const b of buttons) { const q=b.getBoundingClientRect(); if(q.width<32 || q.height<32 || q.right>r.right || q.left<r.left) problems.push('clipped action'); }
        const status=card.querySelector('.status-pill').getBoundingClientRect();
        if(buttons.length && status.right+6>buttons[0].getBoundingClientRect().left) problems.push('status overlaps controls');
        const title=card.querySelector('.tool-name').getBoundingClientRect();
        const warning=card.querySelector('.health-warning-trigger');
        if(warning) { const w=warning.getBoundingClientRect(); if(w.top<title.bottom+7 || w.bottom+7>card.querySelector('.tool-card-footer').getBoundingClientRect().top) problems.push('warning cramped'); }
      }
      if(document.documentElement.scrollWidth>innerWidth) problems.push('page horizontal overflow');
      return problems;
    })()`)
    assert.deepEqual(problems, [])
  }
  await until(`document.querySelectorAll('.tool-card-compact').length===17 && !!document.querySelector('.health-warning-trigger')`)
  await until(`document.querySelectorAll('.tool-card-compact .tool-icon svg').length===17`)
  await fit()
  await capture('compact-dark-wide')
  assert.equal(await js(`getComputedStyle(document.querySelector('.tool-card-compact .tool-icon')).width`), '24px')
  assert.equal(await js(`getComputedStyle(document.querySelector('.tool-card-compact .tool-name')).fontSize`), '13px')
  await click('.health-warning-trigger')
  await until(`!!document.querySelector('.health-warning-popover:popover-open')`)
  assert.equal(await js(`location.hash`), '#/')
  assert.match(await js(`document.querySelector('.health-warning-popover:popover-open').innerText`), /Port 4408 is busy/)
  await capture('warning-dark-wide')
  await press('Escape')
  await until(`!document.querySelector(':popover-open') && document.querySelector('.health-warning-trigger').getAttribute('aria-expanded')==='false'`)
  assert.equal(await js(`document.activeElement.className`), 'health-warning-trigger')
  await press('Space')
  await until(`!!document.querySelector(':popover-open') && document.activeElement.classList.contains('health-warning-popover')`)
  await press('Tab')
  await pause(100)
  assert.equal(await js(`document.activeElement.getAttribute('aria-label')`), 'Close warning', await js(`document.activeElement.outerHTML`))
  await click('.health-warning-popover a')
  await until(`location.hash==='#/tools/compact-15'`)
  await js(`location.hash='#/'`)
  await until(`!!document.querySelector('.tool-card-compact')`)
  await click('[aria-label="Launch AI Movie Studio"]')
  assert.deepEqual(calls.at(-1), ['start', 'compact-0'])
  await click('[aria-label="Stop Client Onboarding"]')
  assert.deepEqual(calls.at(-1), ['stop', 'compact-4'])
  await click('[aria-label="Open WordPress Fleet in browser"]')
  assert.equal(calls.at(-1)[0], 'open')
  await click('[aria-label="Add AI Movie Studio to favorites"]')
  await until(`document.querySelector('[aria-label="Remove AI Movie Studio from favorites"]')?.getAttribute('aria-pressed')==='true'`)
  await mode('Grid')
  assert.equal(await js(`document.querySelectorAll('.tool-card-compact').length`), 0)
  await click('.health-warning-trigger')
  await until(`!!document.querySelector(':popover-open')`)
  await capture('warning-grid')
  await click('[aria-label="Close warning"]')
  await mode('List')
  await click('.health-warning-trigger')
  await until(`!!document.querySelector(':popover-open')`)
  await capture('warning-list')
  await click('[aria-label="Close warning"]')
  await mode('Compact')
  win.webContents.reload()
  await until(`document.querySelectorAll('.tool-card-compact').length===17`)
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'prefs.json'))).viewMode, 'compact')
  const long = store.get('compact-15')
  store.save({ ...long, name: 'Vertical Onboarder with an exceptionally long project name that must remain inside its tile' })
  win.webContents.reload()
  await until(`document.querySelectorAll('.tool-card-compact').length===17`)
  win.setSize(900, 600)
  await pause(250)
  await fit()
  await capture('compact-dark-small')
  await click('.health-warning-trigger')
  await until(`!!document.querySelector(':popover-open')`)
  assert.equal(await js(`(() => { const r=document.querySelector(':popover-open').getBoundingClientRect(); return r.left>=0 && r.top>=0 && r.right<=innerWidth && r.bottom<=innerHeight })()`), true)
  await capture('warning-dark-small')
  await click('[aria-label="Close warning"]')
  await js(`window.shelf.updatePrefs({appearance:'light'})`)
  win.webContents.reload()
  await until(`document.documentElement.dataset.theme==='light' && document.querySelectorAll('.tool-card-compact').length===17`)
  await fit()
  await capture('compact-light-small')
  await click('.health-warning-trigger')
  await until(`!!document.querySelector(':popover-open')`)
  await capture('warning-light-small')
  await click('[aria-label="Close warning"]')
  win.setSize(1800, 910)
  await pause(200)
  await fit()
  await capture('compact-light-wide')
  await js(`location.hash='#/settings?section=general'`)
  await until(`!!document.querySelector('option[value="compact"]')`)
  // Multiple blockers, live tools, and suggestions must remain usable together.
  health = [
    { toolId: 'compact-15', launchable: false, problems: ['Project folder is missing — moved or deleted?', 'No launch command is set.', 'Port 4408 is in use by another process.'] },
    { toolId: 'compact-4', launchable: false, problems: ['Port 4408 is in use by another process.'] },
  ]
  suggestions = [{ gapId: 'fixture-gap', toolId: 'compact-0', toolName: 'AI Movie Studio', matched: ['Render a preview'], total: 1 }]
  await js(`location.hash='#/'`)
  win.webContents.reload()
  await until(`!!document.querySelector('.tool-card-compact[data-suggestion]') && !!document.querySelector('.health-warning-trigger')`)
  assert.equal(await js(`document.querySelectorAll('.health-warning-trigger').length`), 1)
  await fit()
  await click('.health-warning-trigger')
  await until(`!!document.querySelector(':popover-open')`)
  assert.equal(await js(`document.querySelector(':popover-open').querySelectorAll('li').length`), 3)
  await capture('multiple-blockers-and-suggestion')
  const header = await js(`(() => { const r=document.querySelector('.page-title').getBoundingClientRect(); return {x:Math.round(r.x+5),y:Math.round(r.y+5)} })()`)
  win.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,...header})
  win.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,...header})
  await until(`!document.querySelector(':popover-open')`)
  assert.equal(errors.length, 0, errors.join('\n'))
  console.log('OK: compact sizing, warning keyboard access, details route, actions, Grid/List, preference reload, long names, dark/light and narrow/wide renderer checks')
}
app.on('browser-window-created', (_event, win) => {
  win.webContents.on('console-message', (event) => { if (event.level === 'error') errors.push(event.message) })
  win.webContents.once('did-finish-load', () => run(win).then(() => finish(0)).catch(error => { console.error(error); finish(1) }))
})
function finish(code) {
  app.once('quit', () => fs.rmSync(root, { recursive: true, force: true }))
  app.exit(code)
}
require('../dist-electron/electron/main')
app.whenReady().then(() => {
  const handlers = {
    'tools:health': () => health,
    'process:states': () => states,
    'capabilityGaps:suggestions': () => suggestions,
    'process:start': (_e, id) => { calls.push(['start', id]); return { toolId: id, status: 'stopped' } },
    'process:stop': (_e, id) => { calls.push(['stop', id]); return { toolId: id, status: 'stopped' } },
    'system:openUrl': (_e, url) => { calls.push(['open', url]) },
  }
  for (const [channel, handler] of Object.entries(handlers)) { ipcMain.removeHandler(channel); ipcMain.handle(channel, handler) }
})
setTimeout(() => { console.error('Compact UI smoke timed out'); finish(1) }, 60000).unref()
