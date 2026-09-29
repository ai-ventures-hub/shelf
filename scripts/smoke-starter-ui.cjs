/** Start a new tool, end to end in the real renderer, in an isolated Electron
 * profile. The folder dialog and agent launch are fixture IPC: nothing opens
 * Terminal, and files land in a temporary folder. Run after build.
 * SHELF_UI_CAPTURE_DIR optionally retains screenshots for visual review.
 */
const { app, ipcMain } = require('electron')
const assert = require('node:assert/strict')
const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shelf-starter-ui-'))
const parent = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'shelf-starter-ui-tools-')))
process.env.SHELF_DATA_ROOT = root
app.setPath('userData', path.join(root, 'electron'))
app.setAsDefaultProtocolClient = () => true
app.setLoginItemSettings = () => {}
const { DEFAULT_UI_PREFS } = require('../dist-electron/shared/types')
const { DesignProfileStore } = require('../dist-electron/shared/design-profile-store')
fs.writeFileSync(path.join(root, 'prefs.json'), JSON.stringify({ ...DEFAULT_UI_PREFS, appearance: process.env.SHELF_UI_APPEARANCE || 'dark', uiMode: 'simple', globalShortcutEnabled: false, menuBarEnabled: false, closeToMenuBar: false, launchAtLogin: false, onboardingCompletedVersion: '9.9.9', windowBounds: { width: 1280, height: 860 } }))
new DesignProfileStore(root).save({
  name: 'Acme', isDefault: true,
  tokens: { color: { brand: { $value: '#c2410c', $type: 'color' }, surface: { $value: '#12100d', $type: 'color' }, ink: { $value: '#f5f3ee', $type: 'color' } } },
  direction: 'Warm and direct.',
})
const calls = []
const errors = []
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))

async function run(win) {
  const js = code => win.webContents.executeJavaScript(code, true)
  async function until(code, label = code) {
    for (let i = 0; i < 120; i++) { if (await js(code)) return; await pause(50) }
    throw Error(`Timed out: ${label}\nOn screen (${await js('location.hash')}): ${(await js('document.body.innerText')).slice(0, 600)}`)
  }
  async function capture(name) {
    if (!process.env.SHELF_UI_CAPTURE_DIR) return
    await pause(200)
    fs.mkdirSync(process.env.SHELF_UI_CAPTURE_DIR, { recursive: true })
    fs.writeFileSync(path.join(process.env.SHELF_UI_CAPTURE_DIR, `${name}.png`), (await win.webContents.capturePage()).toPNG())
  }
  const setValue = (selector, value) => js(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)})
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)})
    el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }))
  })()`)
  const clickText = (text) => js(`(() => { const b = [...document.querySelectorAll('button, a')].find((el) => el.textContent.trim().startsWith(${JSON.stringify(text)})); if (!b) throw Error('No control: ' + ${JSON.stringify(text)}); b.click() })()`)

  // Entry point from Add tool, then the form.
  await until(`!!document.querySelector('.page-title')`, 'the shell renders')
  await js(`location.hash = '#/tools/new'`)
  await until(`[...document.querySelectorAll('a')].some((a) => a.textContent.includes('Start a new tool instead'))`, 'Add tool links to Start a new tool')
  await clickText('Start a new tool instead')
  await until(`document.querySelector('.page-title')?.textContent === 'Start a new tool'`)
  await until(`/^\\d+$/.test(document.querySelector('.starter-port input')?.value || '')`, 'a suggested port')
  const port = Number(await js(`document.querySelector('.starter-port input').value`))
  assert.ok(port >= 4400 && port <= 4999, `suggested port ${port}`)
  assert.equal(await js(`document.querySelector('button[type=submit]').disabled`), true, 'Create waits for a name and an idea')
  await setValue('textarea.field-textarea', 'Turn a folder of client photos into web-ready images.\nKeep originals untouched.')
  await setValue('input.field-input[maxlength="80"]', 'Photo Prepper')
  assert.match(await js(`document.querySelector('select.field-input').selectedOptions[0].textContent`), /Default \(Acme\)/)
  await clickText('Change folder')
  await until(`document.querySelector('.project-path code')?.textContent === ${JSON.stringify(`${parent}/Photo Prepper`)}`, 'folder preview follows the chosen folder')
  // Real primitives, not browser defaults (the 1.4.1 unstyled-field lesson).
  const styles = await js(`(() => {
    const cs = (el) => getComputedStyle(el)
    const input = cs(document.querySelector('input.field-input[maxlength="80"]'))
    const area = cs(document.querySelector('textarea.field-textarea'))
    const primary = cs(document.querySelector('button[type=submit]'))
    return { inputRadius: input.borderTopLeftRadius, inputBorder: input.borderTopStyle, areaRadius: area.borderTopLeftRadius, primaryBg: primary.backgroundColor, primaryHeight: primary.height }
  })()`)
  assert.notEqual(styles.inputRadius, '0px'); assert.notEqual(styles.areaRadius, '0px')
  assert.equal(styles.inputBorder, 'solid')
  assert.notEqual(styles.primaryBg, 'rgba(0, 0, 0, 0)')
  await capture('starter-form')

  await clickText('Create tool')
  await until(`document.querySelector('.page-title')?.textContent.includes('is ready for your agent')`, 'result page')
  const folder = path.join(parent, 'Photo Prepper')
  for (const file of ['AGENTS.md', 'CLAUDE.md', 'DESIGN.md', 'server.mjs', 'public/tokens.css'])
    assert.ok(fs.existsSync(path.join(folder, file)), `${file} exists`)
  assert.ok(fs.readFileSync(path.join(folder, 'public/tokens.css'), 'utf8').includes('--color-brand: #c2410c'))
  const { LibraryStore } = require('../dist-electron/shared/library-store')
  const saved = new LibraryStore(root).list().find((tool) => tool.name === 'Photo Prepper')
  assert.ok(saved && saved.projectPath === folder && saved.port === port, 'registered with the shown folder and port')
  assert.match(await js(`document.querySelector('.starter-done').textContent`), /Added to your library/)
  await capture('starter-result')

  // Agent hand-off goes through IPC (stubbed here); Copy prompt reports back.
  const agentButton = await js(`[...document.querySelectorAll('button')].find((b) => b.textContent.includes('Build with'))?.textContent || ''`)
  if (agentButton) {
    await clickText('Build with')
    await until(`!!document.querySelector('.starter-notice')`, 'agent notice')
    assert.ok(calls.some(([name, id]) => name === 'openAgent' && id === saved.id))
  }
  await clickText('Copy prompt')
  await until(`/Prompt copied|Copy this prompt/.test(document.querySelector('.starter-notice')?.textContent || '')`, 'copy notice')
  assert.equal(errors.length, 0, errors.join('\n'))
  console.log(`OK: Start a new tool creates, registers, and hands off in the real renderer${agentButton ? ` (${agentButton.trim()})` : ''}`)
}

app.on('browser-window-created', (_event, win) => {
  win.webContents.on('console-message', (event) => { if (event.level === 'error') errors.push(event.message) })
  win.webContents.once('did-finish-load', () => run(win).then(() => finish(0)).catch((error) => { console.error(error); finish(1) }))
})
function finish(code) {
  app.once('quit', () => { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(parent, { recursive: true, force: true }) })
  app.exit(code)
}
require('../dist-electron/electron/main')
app.whenReady().then(() => {
  const handlers = {
    'starter:chooseFolder': () => parent,
    'starter:openAgent': (_e, id, agent) => { calls.push(['openAgent', id, agent]); return { prompt: 'Read AGENTS.md and build the tool it describes. Keep the start command working after every change.' } },
    'system:openUrl': (_e, url) => { calls.push(['open', url]) },
  }
  for (const [channel, handler] of Object.entries(handlers)) { ipcMain.removeHandler(channel); ipcMain.handle(channel, handler) }
})
setTimeout(() => { console.error('Starter UI smoke timed out'); finish(1) }, 60000).unref()
