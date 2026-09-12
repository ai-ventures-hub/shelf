import { parentPort, workerData } from 'node:worker_threads'
import type { ArchiveRequest, PreparedArchive } from './archive-tasks'
import { bundleFolder, extractZip } from './zip'

const request = workerData as ArchiveRequest
try {
  if (request.kind === 'bundle') {
    let files: PreparedArchive['files'] = []
    const zip = new Uint8Array(bundleFolder(request.folder, { onFiles: (value) => { files = value } }))
    parentPort?.postMessage({ ok: true, value: { zip, files } }, [zip.buffer])
  } else if (request.kind === 'extract') {
    parentPort?.postMessage({ ok: true, value: extractZip(request.file, request.destination, request.options) })
  } else {
    throw new Error('Unknown archive operation.')
  }
} catch (error) {
  parentPort?.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) })
} finally {
  parentPort?.close()
}
