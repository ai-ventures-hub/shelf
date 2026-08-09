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
const invokedChannels = new Set(
  [...preload.matchAll(/ipcRenderer\.invoke\(\s*'([^']+)'/g)].map((m) => m[1]),
)

// --- renderer contract: ShelfApi interface keys ---
const rendererTypes = read('src/types.ts')
const shelfApiBody = rendererTypes.slice(
  rendererTypes.indexOf('export interface ShelfApi {'),
  rendererTypes.indexOf('declare global'),
)
const contractKeys = new Set(
  [...shelfApiBody.matchAll(/^  (\w+):/gm)].map((m) => m[1]),
)

// --- main: registered handlers (main.ts + mcp-connect-ipc.ts) ---
const handledChannels = new Set()
for (const file of ['electron/main.ts', 'electron/mcp-connect-ipc.ts']) {
  for (const m of read(file).matchAll(/ipcMain\.handle\(\s*\n?\s*'([^']+)'/g)) {
    handledChannels.add(m[1])
  }
}

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
  `OK: bridge parity — ${contractKeys.size} api methods, ${invokedChannels.size} channels, all handled`,
)
