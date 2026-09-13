import fs from 'node:fs'
import path from 'node:path'
import { Worker } from 'node:worker_threads'
import type { ZipExtractOptions, ZipExtractResult } from './zip'

export type ArchiveRequest =
  | { kind: 'bundle'; folder: string }
  | { kind: 'extract'; file: string; destination: string; options?: ZipExtractOptions }
export interface PreparedArchive {
  zip: Uint8Array
  files: { name: string; bytes: number }[]
}
const ARCHIVE_TIMEOUT_MS = 5 * 60_000
let pending: Promise<unknown> = Promise.resolve()

/** One archive worker per host bounds memory while keeping the event loop available. */
function runArchive<T>(request: ArchiveRequest, signal?: AbortSignal): Promise<T> {
  const run = pending.then(() => new Promise<T>((resolve, reject) => {
    if (signal?.aborted) { reject(new Error('Archive operation cancelled.')); return }
    // MCP ships this standalone worker next to its bundle. Packaged Electron
    // uses that same resource instead of asking Node to load from app.asar.
    const resources = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
    const packaged = resources && path.join(resources, 'mcp', 'mcp', 'archive-worker.js')
    const entry = packaged && fs.existsSync(packaged) ? packaged : path.join(__dirname, 'archive-worker.js')
    const worker = new Worker(entry, { workerData: request })
    let settled = false
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort) }
    const fail = async (error: Error) => {
      if (settled) return
      settled = true
      cleanup()
      // Wait for all writes to stop before the staging owner removes partial files.
      await worker.terminate().catch(() => undefined)
      reject(error)
    }
    const abort = () => { void fail(new Error('Archive operation cancelled.')) }
    const timer = setTimeout(() => { void fail(new Error('Archive operation timed out.')) }, ARCHIVE_TIMEOUT_MS)
    signal?.addEventListener('abort', abort, { once: true })
    worker.once('error', (error) => { void fail(error) })
    worker.once('exit', (code) => {
      if (!settled) { settled = true; cleanup(); reject(new Error(`Archive worker exited without a result (${code}).`)) }
    })
    worker.once('message', (message: { ok: boolean; value: T; error?: string }) => {
      if (settled) return
      if (!message.ok) { void fail(new Error(message.error || 'Archive operation failed.')); return }
      settled = true
      cleanup()
      resolve(message.value)
    })
  }))
  pending = run.catch(() => undefined)
  return run
}

export async function prepareArchive(folder: string, signal?: AbortSignal): Promise<{ zip: Buffer; files: PreparedArchive['files'] }> {
  const result = await runArchive<PreparedArchive>({ kind: 'bundle', folder }, signal)
  return { ...result, zip: Buffer.from(result.zip.buffer, result.zip.byteOffset, result.zip.byteLength) }
}

export function extractArchive(file: string, destination: string, options?: ZipExtractOptions, signal?: AbortSignal): Promise<ZipExtractResult> {
  return runArchive({ kind: 'extract', file, destination, options }, signal)
}
