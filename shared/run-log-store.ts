import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { atomicWriteFileSync, withFileLockSync } from './atomic-file'
import { sanitizeOutput, type LogLine } from './types'

export const MAX_RUN_LOG_LINES = 3000
const MAX_BYTES = 2 * 1024 * 1024

/** Shared, bounded per-run evidence. No environment values are persisted here. */
export class RunLogStore {
  constructor(private readonly root: string) {}

  private directory(toolId: string): string {
    return path.join(this.root, 'logs', createHash('sha256').update(toolId).digest('hex'))
  }

  currentRun(toolId: string): string | undefined {
    try {
      const id = fs.readFileSync(path.join(this.directory(toolId), 'latest'), 'utf8').trim()
      return /^[a-f0-9-]{36}$/.test(id) ? id : undefined
    } catch { return undefined }
  }

  begin(toolId: string): string {
    const dir = this.directory(toolId)
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
    const runId = randomUUID()
    atomicWriteFileSync(path.join(dir, `${runId}.jsonl`), '')
    atomicWriteFileSync(path.join(dir, 'latest'), runId)
    const older = fs.readdirSync(dir).filter((name) => /^[a-f0-9-]{36}\.jsonl$/.test(name))
      .sort((a, b) => fs.statSync(path.join(dir, b)).mtimeMs - fs.statSync(path.join(dir, a)).mtimeMs)
    for (const name of older.slice(5)) fs.rmSync(path.join(dir, name), { force: true })
    return runId
  }

  append(toolId: string, entries: LogLine[], runId = this.currentRun(toolId)): void {
    if (!entries.length) return
    if (!runId) runId = this.begin(toolId)
    const file = path.join(this.directory(toolId), `${runId}.jsonl`)
    withFileLockSync(file, () => {
      const payload = entries.map((line) => JSON.stringify({ ...line, runId })).join('\n') + '\n'
      const size = fs.existsSync(file) ? fs.statSync(file).size : 0
      if (size + Buffer.byteLength(payload) > MAX_BYTES) {
        const recent = [...this.read(toolId, [], runId), ...entries].slice(-MAX_RUN_LOG_LINES)
        let bytes = 0
        const kept: string[] = []
        for (let i = recent.length - 1; i >= 0; i--) {
          const line = JSON.stringify({ ...recent[i], runId }) + '\n'
          bytes += Buffer.byteLength(line)
          if (bytes > MAX_BYTES) break
          kept.unshift(line)
        }
        atomicWriteFileSync(file, kept.join(''))
      } else fs.appendFileSync(file, payload, { encoding: 'utf8', mode: 0o600 })
    })
  }

  read(toolId: string, secretValues: readonly string[] = [], runId = this.currentRun(toolId)): LogLine[] {
    if (!runId || !/^[a-f0-9-]{36}$/.test(runId)) return []
    const file = path.join(this.directory(toolId), `${runId}.jsonl`)
    if (!fs.existsSync(file)) return []
    const lines: LogLine[] = []
    // Ignore an interrupted final record; preserve all complete evidence.
    const fd = fs.openSync(file, 'r')
    let text: string
    try {
      const size = fs.fstatSync(fd).size
      const start = Math.max(0, size - MAX_BYTES)
      const buffer = Buffer.alloc(Math.min(size, MAX_BYTES))
      const length = fs.readSync(fd, buffer, 0, buffer.length, start)
      text = buffer.toString('utf8', 0, length)
      if (start) text = text.slice(text.indexOf('\n') + 1)
    } finally { fs.closeSync(fd) }
    for (const raw of text.split('\n')) {
      try {
        const value = JSON.parse(raw) as LogLine
        if (value.toolId !== toolId || typeof value.text !== 'string' || typeof value.at !== 'string') continue
        if (!['stdout', 'stderr', 'system'].includes(value.stream)) continue
        lines.push(sanitizeOutput(value, secretValues))
      } catch { /* incomplete or malformed line */ }
    }
    return lines.slice(-MAX_RUN_LOG_LINES)
  }

  forget(toolId: string): void { fs.rmSync(this.directory(toolId), { recursive: true, force: true }) }
}
