/**
 * Bridge parity smoke: the renderer's ShelfApi contract, the preload api
 * object, and main's registered IPC handlers must agree. Catches the
 * "window.shelf.X is not a function" class of failure at build time instead
 * of first click (e.g. a preload method added without its ipcMain.handle,
 * or a ShelfApi entry the preload never exposes).
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')

// --- preload: exposed api keys + invoked channels ---
const preload = read('electron/preload.ts')
const apiBody = preload.slice(
  preload.indexOf('const api = {'),
  preload.indexOf('contextBridge.exposeInMainWorld'),
)
const preloadKeys = new Set(
  [...apiBody.matchAll(/^  (\w+):/gm)].map((m) => m[1]),
)
// The preload calls the typed `invoke(...)` helper (shared/ipc-channels.ts).
const invokedChannels = new Set(
  [...preload.matchAll(/\binvoke\(\s*'([^']+)'/g)].map((m) => m[1]),
)

// --- renderer contract: ShelfApi interface keys ---
const rendererTypes = read('shared/desktop-api.ts')
const shelfApiBody = rendererTypes.slice(
  rendererTypes.indexOf('export interface ShelfApi {'),
  rendererTypes.length,
)
const contractKeys = new Set(
  [...shelfApiBody.matchAll(/^  (\w+):/gm)].map((m) => m[1]),
)

// --- main: registered handlers (electron/ipc/*.ts, through the typed handle()) ---
const ipcDir = path.join(root, 'electron/ipc')
const handledChannels = new Set()
for (const name of fs.readdirSync(ipcDir)) {
  if (!name.endsWith('.ts')) continue
  for (const m of read(`electron/ipc/${name}`).matchAll(/\bhandle\(\s*\n?\s*'([^']+)'/g)) {
    handledChannels.add(m[1])
  }
}
// main.ts itself registers nothing; every handler lives in a domain module.
assert.equal(
  (read('electron/main.ts').match(/ipcMain\.handle\(/g) || []).length,
  0,
  'electron/main.ts must not register IPC handlers directly (use electron/ipc/)',
)

// --- channel map: every registered channel is declared exactly once ---
const channelMap = read('shared/ipc-channels.ts')
const invokeMapBody = channelMap.slice(
  channelMap.indexOf('export interface IpcInvokeMap {'),
  channelMap.indexOf('export type IpcInvokeChannel'),
)
const mappedChannels = [...invokeMapBody.matchAll(/^  '([^']+)':/gm)].map((m) => m[1])
const duplicateMapped = mappedChannels.filter((c, i) => mappedChannels.indexOf(c) !== i)
assert.deepEqual(duplicateMapped, [], `Channels declared twice in IpcInvokeMap: ${duplicateMapped.join(', ')}`)
const mappedSet = new Set(mappedChannels)
const unmappedHandlers = [...handledChannels].filter((c) => !mappedSet.has(c))
assert.deepEqual(unmappedHandlers, [], `Handlers registered for channels missing from IpcInvokeMap: ${unmappedHandlers.join(', ')}`)
const unhandledMapped = [...mappedSet].filter((c) => !handledChannels.has(c))
assert.deepEqual(unhandledMapped, [], `IpcInvokeMap declares channels no module handles: ${unhandledMapped.join(', ')}`)

const missingInPreload = [...contractKeys].filter((k) => !preloadKeys.has(k))
assert.deepEqual(
  missingInPreload,
  [],
  `ShelfApi promises methods the preload never exposes: ${missingInPreload.join(', ')}`,
)

const missingInContract = [...preloadKeys].filter((k) => !contractKeys.has(k))
assert.deepEqual(
  missingInContract,
  [],
  `Preload exposes methods missing from the ShelfApi contract: ${missingInContract.join(', ')}`,
)

const unhandled = [...invokedChannels].filter((c) => !handledChannels.has(c))
assert.deepEqual(
  unhandled,
  [],
  `Preload invokes IPC channels with no ipcMain.handle: ${unhandled.join(', ')}`,
)

console.log(
  `OK: bridge parity — ${contractKeys.size} api methods, ${invokedChannels.size} channels invoked, ${handledChannels.size} handled, all mapped`,
)
