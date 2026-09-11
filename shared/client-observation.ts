import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { atomicWriteFileSync } from './atomic-file'
import { resolveShelfDataRoot } from './paths'

export type ClientKind = 'claude' | 'claude-code' | 'cursor' | 'codex'
function observationPath(serverPath: string, kind: ClientKind): string {
  let resolved = path.resolve(serverPath)
  try { resolved = fs.realpathSync(resolved) } catch { /* missing bundle has no observation */ }
  return path.join(resolveShelfDataRoot(), 'client-observations', `${kind}-${createHash('sha256').update(resolved).digest('hex')}.json`)
}

/** A client label is self-reported provenance, not authentication. */
export function recordClientObservation(serverPath: string, name?: string): void {
  if (!name) return
  const normalized = name.toLowerCase()
  const kind = /codex/.test(normalized) ? 'codex' : /cursor/.test(normalized) ? 'cursor'
    : /claude.?code/.test(normalized) ? 'claude-code' : /claude/.test(normalized) ? 'claude' : null
  if (!kind) return
  const file = observationPath(serverPath, kind)
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 })
  atomicWriteFileSync(file, JSON.stringify({ lastSeenAt: new Date().toISOString() }))
}

export function clientObservation(serverPath: string, kind: ClientKind): { lastSeenAt?: string } {
  try {
    const value = JSON.parse(fs.readFileSync(observationPath(serverPath, kind), 'utf8'))
    return typeof value.lastSeenAt === 'string' && Number.isFinite(Date.parse(value.lastSeenAt)) ? { lastSeenAt: value.lastSeenAt } : {}
  } catch { return {} }
}

/** Validate the configured command without executing arbitrary configuration. */
export function configuredCommandExists(command: unknown): boolean {
  if (typeof command !== 'string' || !command.trim() || command.startsWith('-')) return false
  const candidates = path.isAbsolute(command) ? [command]
    : command.includes('/') ? [] : (process.env.PATH || '').split(path.delimiter).filter(Boolean).map((dir) => path.join(dir, command))
  return candidates.some((file) => {
    try { fs.accessSync(file, fs.constants.X_OK); return fs.statSync(file).isFile() } catch { return false }
  })
}
