/**
 * Helper for smoke-adopt-deep: a SEPARATE OS process that builds its own
 * ProcessManager over a shared SHELF_DATA_ROOT, launches one tool, prints the
 * resulting state as JSON, and exits — mimicking an MCP server that launched
 * a tool and was then torn down (the launched tree survives detached).
 *
 * Usage: node scripts/smoke-adopt-launcher.mjs <dataRoot> <toolId>
 */
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const { LibraryStore } = require(path.join(__dirname, '../dist-electron/shared/library-store'))
const { ProcessManager } = require(path.join(__dirname, '../dist-electron/shared/process-manager'))
const { ReceiptStore } = require(path.join(__dirname, '../dist-electron/shared/receipt-store'))

const [dataRoot, toolId] = process.argv.slice(2)
const store = new LibraryStore(dataRoot)
const manager = new ProcessManager(store, { receipts: new ReceiptStore(dataRoot) })
const state = await manager.start(toolId)
console.log(JSON.stringify({ status: state.status, pid: state.pid, message: state.message }))
process.exit(state.status === 'running' ? 0 : 1)
