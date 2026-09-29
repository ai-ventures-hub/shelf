/** Renderer UX regression checks in an isolated Electron profile. Run after build.
 * Same isolation as smoke-compact-ui.cjs: a temp SHELF_DATA_ROOT and userData,
 * protocol/login-item registration stubbed, and process actions, logs, drafts,
 * and external navigation answered by fixture IPC. No tools actually execute.
 * SHELF_UI_CAPTURE_DIR optionally retains screenshots for visual review.
 */
const { app, ipcMain } = require('electron')
const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shelf-renderer-ux-'))
process.env.SHELF_DATA_ROOT = root
app.setPath('userData', path.join(root, 'electron'))
app.setAsDefaultProtocolClient = () => true
app.setLoginItemSettings = () => {}
const { LibraryStore } = require('../dist-electron/shared/library-store')
const { DEFAULT_UI_PREFS } = require('../dist-electron/shared/types')
fs.writeFileSync(path.join(root, 'prefs.json'), JSON.stringify({ ...DEFAULT_UI_PREFS, viewMode: 'grid', appearance: 'dark', uiMode: 'developer', globalShortcutEnabled: false, menuBarEnabled: false, closeToMenuBar: false, launchAtLogin: false, onboardingCompletedVersion: '2.0.0', windowBounds: { width: 1440, height: 900 } }))
const store = new LibraryStore(root)
const URL = 'http://127.0.0.1:4412'
store.save({ id: 'ux-0', name: 'Alpha Server', projectPath: root, launchCommand: 'echo fixture', url: URL, port: 4412, description: 'Serves a local page.', tags: [] })
store.save({ id: 'ux-1', name: 'Beta Script', projectPath: root, launchCommand: 'echo fixture', description: 'Runs once and exits.', tags: [] })
store.save({ id: 'ux-2', name: 'Gamma Broken', projectPath: root, launchCommand: 'echo fixture', description: 'Fails to launch.', tags: [] })

let states = [{ toolId: 'ux-0', status: 'running', startedBy: { kind: 'gui' } }]
let drafts = [{ id: 'draft-1', name: 'Delta Draft', projectPath: root, launchCommand: 'npm run dev', envKeys: [], updatedAt: new Date().toISOString(), createdAt: new Date().toISOString() }]
let boardFails = true
const counts = { logs: 0, gaps: 0, suggestions: 0, receipts: 0 }
const calls = []
const errors = []
const fixtureLines = Array.from({ length: 30 }, (_, i) => ({ id: `l${i}`, toolId: 'ux-0', stream: 'stdout', text: `boot line ${i}`, at: new Date().toISOString() }))
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))

async function run(win) {
  const js = code => win.webContents.executeJavaScript(code, true)
  async function until(code, label = code) {
    for (let i = 0; i < 100; i++) { if (await js(code)) return; await pause(50) }
    throw Error(`Timed out: ${label}`)
  }
  async function press(keyCode, modifiers = []) {
    app.focus({ steal: true })
    win.focus()
    win.webContents.focus()
    await pause(30)
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers })
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers })
    await pause(60)
  }
  async function capture(name) {
    if (!process.env.SHELF_UI_CAPTURE_DIR) return
    await pause(150)
    fs.mkdirSync(process.env.SHELF_UI_CAPTURE_DIR, { recursive: true })
    fs.writeFileSync(path.join(process.env.SHELF_UI_CAPTURE_DIR, `${name}.png`), (await win.webContents.capturePage()).toPNG())
  }
  const click = selector => js(`document.querySelector(${JSON.stringify(selector)}).click()`)
  const active = () => js(`(() => { const a=document.activeElement; return a ? (a.getAttribute('aria-label') || a.id || a.textContent.trim()).slice(0,80) : '' })()`)

  // Library: title, sidebar names with counts.
  await until(`document.querySelectorAll('.tool-card').length===3`)
  await until(`document.title==='Library · Shelf'`, 'library document title')
  assert.equal(await js(`document.querySelector('.sidebar a[href="#/"]').getAttribute('aria-label')`), 'All tools, 3 tools')
  await until(`document.querySelector('.sidebar a[href="#/drafts"]')?.getAttribute('aria-label')==='Waiting for you, 1 draft'`, 'waiting count')
  await capture('library-dark')

  // Filter popover: focus moves in, Escape closes and returns focus.
  await js(`[...document.querySelectorAll('.filter-anchor > button')][0].click()`)
  await until(`document.activeElement?.id==='status-filter'`, 'filter focus')
  await js(`(() => { const el=document.getElementById('status-filter'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(el,'stopped'); el.dispatchEvent(new Event('change',{bubbles:true})) })()`)
  await press('Escape')
  await until(`!document.querySelector('.filter-popover') && document.activeElement?.closest('.filter-anchor')?.tagName==='DIV'`, 'filter closes to its button')
  assert.equal(await js(`!!document.querySelector('.active-filters')`), true)

  // Views start clean, and a route change focuses and names the new page.
  await click('.sidebar a[href="#/running"]')
  await until(`location.hash==='#/running' && document.title==='Running · Shelf'`, 'running title')
  await until(`document.activeElement?.tagName==='H1' && document.activeElement.textContent==='Running'`, 'h1 focus on route change')
  assert.equal(await js(`!!document.querySelector('.active-filters')`), false, 'a Stopped filter must not carry into Running')
  assert.equal(await js(`document.querySelectorAll('.tool-card').length`), 1)
  await click('.sidebar a[href="#/"]')
  await until(`location.hash.startsWith('#/') && document.querySelectorAll('.tool-card').length===3`)

  // Overflow menu keyboard: visible text is in the name; arrows, Home/End, Escape.
  const addFrom = `[...document.querySelectorAll('.overflow-menu-trigger')].find(b=>b.textContent.includes('Add from'))`
  assert.match(await js(`${addFrom}.getAttribute('aria-label')`), /^Add from/)
  await js(`${addFrom}.focus()`)
  await press('Down')
  await until(`document.activeElement?.getAttribute('role')==='menuitem'`, 'menu focus on open')
  assert.match(await active(), /Shared link/)
  await press('End')
  assert.match(await active(), /Bundle/)
  await press('Home')
  assert.match(await active(), /Shared link/)
  await press('Up')
  assert.match(await active(), /Bundle/, 'ArrowUp wraps to the last item')
  await press('Escape')
  await until(`!document.querySelector('[role=menu]') && document.activeElement?.classList.contains('overflow-menu-trigger')`, 'menu closes to trigger')

  // Card action failures are reported on the card; buttons are not stuck.
  await click('[aria-label="Launch Gamma Broken"]')
  await until(`[...document.querySelectorAll('.tool-card-error')].some(e=>e.textContent.includes('Could not launch Gamma Broken'))`, 'launch failure shown')
  assert.equal(await js(`document.querySelector('[aria-label="Launch Gamma Broken"]').disabled`), false)

  // A script that exits on its own says so and links to its output.
  win.webContents.send('process:update', { toolId: 'ux-1', status: 'stopped', exitCode: 0, message: 'Process exited cleanly.' })
  await until(`[...document.querySelectorAll('.tool-card')].some(c=>c.textContent.includes('Finished · exit 0') && c.querySelector('a[href="#/tools/ux-1/runs"]'))`, 'finished line')
  await capture('library-finished-and-error')

  // Idle Library makes no periodic reads (was 3 calls every 5 s).
  const before = { ...counts }
  await pause(6000)
  assert.deepEqual({ gaps: counts.gaps, suggestions: counts.suggestions, receipts: counts.receipts }, { gaps: before.gaps, suggestions: before.suggestions, receipts: before.receipts })
  assert.equal(counts.receipts, 0, 'receipts are read only on Recent')
  win.webContents.send('data:external-change', 'capability-gaps.json')
  await until(`true`)
  await pause(200)
  assert.ok(counts.gaps > before.gaps, 'a gaps file change refreshes the sidebar count')

  // Waiting count is shared: rejecting on the page updates the sidebar.
  await click('.sidebar a[href="#/drafts"]')
  await until(`[...document.querySelectorAll('.draft-card button')].some(b=>b.textContent==='Reject')`)
  await js(`[...document.querySelectorAll('.draft-card button')].find(b=>b.textContent==='Reject').click()`)
  await until(`!document.querySelector('.sidebar a[href="#/drafts"]')`, 'sidebar Waiting item disappears after reject')

  // Activity: an error is an error, not "Nothing recorded yet", and retry works.
  await js(`location.hash='#/activity'`)
  await until(`[...document.querySelectorAll('.warning-card')].some(e=>e.textContent.includes('Could not read activity'))`, 'activity error')
  assert.equal(await js(`document.body.textContent.includes('Nothing recorded yet')`), false)
  boardFails = false
  await js(`[...document.querySelectorAll('.warning-card button')].find(b=>b.textContent==='Try again').click()`)
  await until(`document.body.textContent.includes('Nothing recorded yet') && !document.querySelector('.warning-card')`, 'activity retry')

  // Run output: pushed lines append without re-reading or remounting rows.
  await js(`location.hash='#/tools/ux-0/runs'`)
  await until(`document.querySelectorAll('.log-panel .log-line').length===30`, 'initial log read')
  await until(`document.title==='Alpha Server · Shelf'`, 'tool title')
  const readsAfterLoad = counts.logs
  await js(`document.querySelector('.log-panel .log-line').dataset.mark='first'`)
  for (let i = 0; i < 40; i++) win.webContents.send('logs:line', { id: `p${i}`, toolId: 'ux-0', stream: i % 5 ? 'stdout' : 'stderr', text: `pushed ${i}`, at: new Date().toISOString() })
  await until(`document.querySelectorAll('.log-panel .log-line').length===70`, 'pushed lines appended')
  assert.equal(counts.logs, readsAfterLoad, 'log bursts must not re-read the run')
  assert.equal(await js(`!!document.querySelector('[data-mark="first"]')`), true, 'existing rows keep their DOM nodes')
  win.webContents.send('process:update', { toolId: 'ux-0', status: 'stopping' })
  win.webContents.send('process:update', { toolId: 'ux-0', status: 'running', startedBy: { kind: 'gui' } })
  await pause(200)
  assert.equal(await js(`document.querySelectorAll('.log-panel .log-line').length`), 70, 'a status change must not reset output')
  assert.equal(await js(`!!document.querySelector('[data-mark="first"]')`), true)
  for (let i = 40; i < 640; i++) win.webContents.send('logs:line', { id: `p${i}`, toolId: 'ux-0', stream: 'stdout', text: `pushed ${i}`, at: new Date().toISOString() })
  await until(`document.querySelector('.log-earlier')?.textContent.includes('170 lines')`, 'render cap with show-earlier control')
  assert.equal(await js(`document.querySelectorAll('.log-panel .log-line').length`), 500)
  await click('.log-earlier')
  await until(`document.querySelectorAll('.log-panel .log-line').length===670 && !document.querySelector('.log-earlier')`, 'show earlier output')
  await capture('runs-output')

  // Overview: live tail; confirm dialog uses verbs and keeps the tool on cancel.
  await js(`location.hash='#/tools/ux-0'`)
  await until(`!!document.querySelector('.log-tail') && document.querySelectorAll('.log-tail .log-line').length===8`, 'overview tail')
  await click('[aria-label="More actions"]')
  await until(`document.activeElement?.getAttribute('role')==='menuitem'`)
  await js(`[...document.querySelectorAll('[role=menuitem]')].find(b=>b.textContent==='Remove').click()`)
  await until(`!!document.querySelector('dialog[open][role=alertdialog]')`, 'confirm dialog')
  assert.deepEqual(await js(`[...document.querySelectorAll('dialog[open] .name-prompt-actions button')].map(b=>b.textContent)`), ['Keep tool', 'Remove'])
  assert.equal(await js(`document.activeElement.textContent`), 'Keep tool', 'the safe choice has initial focus')
  assert.equal(await js(`document.querySelector('dialog[open] .btn-danger')?.textContent`), 'Remove')
  await capture('confirm-remove')
  await js(`[...document.querySelectorAll('dialog[open] button')].find(b=>b.textContent==='Keep tool').click()`)
  await until(`!document.querySelector('dialog[open]')`)
  assert.equal(await js(`location.hash`), '#/tools/ux-0')
  assert.ok(store.get('ux-0'), 'cancel keeps the tool')

  // Quick Open: open a running tool in the browser; failures become toasts.
  win.webContents.send('app:quick-open')
  await until(`!!document.querySelector('.quick-open-input')`)
  await js(`(() => { const el=document.querySelector('.quick-open-input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,'browser'); el.dispatchEvent(new Event('input',{bubbles:true})) })()`)
  await until(`[...document.querySelectorAll('.quick-open-row')].some(r=>r.textContent.includes('Open Alpha Server in browser'))`, 'open-in-browser action')
  await js(`[...document.querySelectorAll('.quick-open-row')].find(r=>r.textContent.includes('Open Alpha Server in browser')).click()`)
  await until(`!document.querySelector('.quick-open-input')`)
  assert.deepEqual(calls.at(-1), ['open', URL])
  win.webContents.send('app:quick-open')
  await until(`!!document.querySelector('.quick-open-input')`)
  await js(`(() => { const el=document.querySelector('.quick-open-input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,'Gamma'); el.dispatchEvent(new Event('input',{bubbles:true})) })()`)
  await until(`document.querySelector('.quick-open-row.is-active')?.textContent.includes('Gamma Broken')`)
  await js(`document.querySelector('.quick-open-input').focus()`)
  await press('Enter', ['meta'])
  await until(`[...document.querySelectorAll('.toast[data-tone=error]')].some(t=>t.textContent.includes('Could not launch Gamma Broken'))`, 'quick open failure toast')
  await capture('toast-error')

  // Confirmed removal deletes and returns to the library.
  await click('[aria-label="More actions"]')
  await until(`!!document.querySelector('[role=menu]')`)
  await js(`[...document.querySelectorAll('[role=menuitem]')].find(b=>b.textContent==='Remove').click()`)
  await until(`!!document.querySelector('dialog[open][role=alertdialog]')`)
  await js(`[...document.querySelectorAll('dialog[open] button')].find(b=>b.textContent==='Remove').click()`)
  await until(`location.hash==='#/' && document.querySelectorAll('.tool-card').length===2`, 'confirmed removal')

  // Light theme renders the same views.
  await js(`window.shelf.updatePrefs({appearance:'light'})`)
  win.webContents.reload()
  await until(`document.documentElement.dataset.theme==='light' && document.querySelectorAll('.tool-card').length===2`)
  await capture('library-light')

  assert.equal(errors.length, 0, errors.join('\n'))
  console.log('OK: route focus and titles, filter and menu keyboard access, clean views, card failures, finished scripts, push refresh, shared drafts, activity errors, streamed output, confirm dialog, Quick Open actions and toasts')
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
    'tools:health': () => [],
    'process:states': () => states,
    'process:logs': () => { counts.logs++; return fixtureLines },
    'capabilityGaps:list': () => { counts.gaps++; return [] },
    'capabilityGaps:suggestions': () => { counts.suggestions++; return [] },
    'receipts:list': () => { counts.receipts++; return [] },
    'drafts:list': () => drafts,
    'drafts:reject': (_e, id) => { drafts = drafts.filter(d => d.id !== id) },
    'activity:board': () => { if (boardFails) throw new Error('Fixture board is unavailable.'); return [] },
    'process:start': (_e, id) => {
      calls.push(['start', id])
      if (id === 'ux-2') throw new Error('Fixture launch refused.')
      return { toolId: id, status: 'running' }
    },
    'process:stop': (_e, id) => { calls.push(['stop', id]); return { toolId: id, status: 'stopped' } },
    'system:openUrl': (_e, url) => { calls.push(['open', url]) },
  }
  for (const [channel, handler] of Object.entries(handlers)) { ipcMain.removeHandler(channel); ipcMain.handle(channel, handler) }
})
setTimeout(() => { console.error('Renderer UX smoke timed out'); finish(1) }, 90000).unref()
