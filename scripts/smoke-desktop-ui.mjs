import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { updateNotice, updateDescription } = require('../dist-electron/shared/app-update-presentation')
const { toolSections, settingsSection } = require('../dist-electron/shared/ui-navigation')
const { nextAppUpdateState } = require('../dist-electron/shared/app-update-state')
const { healthWarning } = require('../dist-electron/shared/tool-health-presentation')

const health = (...problems) => ({ toolId: 'test', launchable: false, problems })
assert.deepEqual(healthWarning(health('Port 4408 is in use by another process.')), { label: 'Port busy', heading: 'Port 4408 is busy' })
assert.equal(healthWarning(health('Project folder is missing — moved or deleted?', 'Port 4408 is in use by another process.')).label, 'Folder missing')
assert.equal(healthWarning(health('No launch command is set.')).label, 'Setup needed')
assert.equal(healthWarning(health('An unknown future blocker')).label, 'Needs attention')
assert.equal(healthWarning(health()).label, 'Needs attention')
console.log('OK: compact warnings preserve blocker priority and tolerate absent or unfamiliar details')

const base = { currentVersion: '1.9.0' }
assert.equal(updateNotice(null, null, null), null)
assert.equal(updateNotice({ ...base, status: 'idle' }, null, null), null)
assert.equal(updateNotice({ ...base, status: 'unsupported' }, null, null), null)
assert.equal(updateNotice({ ...base, status: 'checking' }, null, null), 'Checking for updates…')
assert.equal(updateNotice({ ...base, status: 'downloading', version: '2.0.0', percent: 42 }, null, null), 'Downloading · 42%')
const ready = { ...base, status: 'ready', version: '2.0.0' }
assert.equal(updateNotice(ready, null, null), 'Update available')
assert.equal(updateNotice(ready, '2.0.0', null), null)
assert.equal(updateNotice({ ...ready, version: '2.0.1' }, '2.0.0', null), 'Update available')
assert.equal(updateNotice(ready, '2.0.0', 'Restart cancelled'), 'Update failed')
assert.match(updateDescription(ready), /ready to install/)
assert.deepEqual(nextAppUpdateState(ready, { status: 'error', error: 'offline' }), ready)
assert.match(updateDescription({ ...base, status: 'error', error: 'Offline. Retry.' }), /Offline/)
console.log('OK: downloads are not advertised as ready, version dismissal and retry errors remain accurate')

const links = toolSections('tool with spaces', 'run/a?b')
assert.deepEqual(links.map((item) => item.label), ['Overview', 'Runs', 'Verify', 'Memory & handoff'])
assert.equal(links[1].to, '/tools/tool%20with%20spaces/runs?run=run%2Fa%3Fb')
assert.equal(links[3].to, '/tools/tool%20with%20spaces/context?run=run%2Fa%3Fb')
assert.ok(!links[0].to.includes('?'))
assert.ok(!links[2].to.includes('?'), 'launch receipts must not become verification run IDs')
assert.equal(settingsSection('advanced', false), 'general')
assert.equal(settingsSection('advanced', true), 'advanced')
assert.equal(settingsSection('updates', false), 'updates')
assert.equal(settingsSection('unknown', true), 'general')
assert.equal(settingsSection(null, true), 'general')
console.log('OK: selected launch runs survive handoff navigation; settings routes enforce mode and safe defaults')

const { placeWindow } = require('../dist-electron/shared/window-placement')
const laptop = { x: 0, y: 25, width: 1512, height: 920 }
const external = { x: 1512, y: 0, width: 2560, height: 1415 }
const size = { width: 1280, height: 860 }
const min = { width: 900, height: 600 }
assert.deepEqual(placeWindow(undefined, [laptop], size, min), { width: 1280, height: 860 })
assert.deepEqual(placeWindow({ width: 1200, height: 800, x: 2000, y: 100 }, [laptop, external], size, min), { width: 1200, height: 800, x: 2000, y: 100 })
assert.deepEqual(placeWindow({ width: 1200, height: 800, x: 2000, y: 100 }, [laptop], size, min), { width: 1200, height: 800 }, 'a window left on an unplugged display recenters on the primary one')
assert.deepEqual(placeWindow({ width: 2400, height: 1300, x: 1600, y: 50 }, [laptop], size, min), { width: 1512, height: 920 }, 'oversized saved bounds shrink to the remaining display')
assert.deepEqual(placeWindow({ width: 1200, height: 800, x: 1000, y: -400 }, [laptop], size, min), { width: 1200, height: 800 }, 'a title bar above the menu bar is unreachable')
assert.deepEqual(placeWindow({ width: 1200, height: 800, x: 1400, y: 300 }, [laptop], size, min), { width: 1200, height: 800, x: 312, y: 145 }, 'a partly visible window is pulled fully on screen')
assert.deepEqual(placeWindow({ width: Number.NaN, height: 800, x: 10, y: 30 }, [laptop], size, min), { width: 1280, height: 800, x: 10, y: 30 })
console.log('OK: saved window bounds are validated against the connected displays')
