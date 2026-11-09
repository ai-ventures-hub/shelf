/**
 * Main-process error log. Electron's default handler shows "A JavaScript
 * error occurred in the main process" with the message and nothing else,
 * so a failure that only happens on the user's Mac cannot be traced. This
 * appends every uncaught exception and unhandled rejection, with its stack,
 * to ~/Library/Logs/Shelf/main-errors.log, keeps Shelf running, and shows
 * one short dialog per distinct message so a loop cannot bury the user in
 * alerts. The dialog names the log so the report can carry the stack.
 */
import { app, dialog } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

const MAX_LOG_BYTES = 512 * 1024
/** Show a dialog for the same message at most this often. */
const DIALOG_REPEAT_MS = 60_000

let logFile: string | null = null
const lastShown = new Map<string, number>()

function resolveLogFile(): string {
  if (logFile) return logFile
  let dir: string
  try {
    dir = app.getPath('logs')
  } catch {
    dir = path.join(app.getPath('userData'), 'logs')
  }
  fs.mkdirSync(dir, { recursive: true })
  logFile = path.join(dir, 'main-errors.log')
  return logFile
}

function describe(err: unknown): { message: string; stack: string } {
  if (err instanceof Error) {
    return { message: err.message || err.name, stack: err.stack || `${err.name}: ${err.message}` }
  }
  const text = typeof err === 'string' ? err : JSON.stringify(err)
  return { message: text, stack: text }
}

/** Append one record; never throws (a failing logger must not become the error). */
export function recordMainError(kind: 'uncaughtException' | 'unhandledRejection', err: unknown, origin?: string): string | null {
  try {
    const file = resolveLogFile()
    try {
      if (fs.statSync(file).size > MAX_LOG_BYTES) fs.renameSync(file, `${file}.1`)
    } catch {
      // No file yet.
    }
    const { stack } = describe(err)
    const record = [
      `--- ${new Date().toISOString()} Shelf ${app.getVersion()} ${kind}${origin ? ` (${origin})` : ''}`,
      stack,
      '',
    ].join('\n')
    fs.appendFileSync(file, record, { encoding: 'utf8', mode: 0o600 })
    return file
  } catch {
    return null
  }
}

/** Installs the handlers once, as early as main.ts can call it. */
export function installMainErrorLog(): void {
  process.on('uncaughtException', (err, origin) => {
    const file = recordMainError('uncaughtException', err, origin)
    console.error('Uncaught exception in main:', err)
    const { message } = describe(err)
    const now = Date.now()
    if ((lastShown.get(message) ?? 0) + DIALOG_REPEAT_MS > now) return
    lastShown.set(message, now)
    const where = file ? `Details were saved to ${file}.` : 'The details could not be saved.'
    // After ready only: a dialog before that would crash the app for real.
    if (app.isReady()) {
      dialog.showErrorBox('Shelf hit an unexpected error', `${message}\n\n${where} Shelf keeps running; if something stopped working, quit and reopen it.`)
    }
  })
  process.on('unhandledRejection', (reason) => {
    // Node's default would turn this into an uncaught exception and show the
    // generic dialog. Record it with its stack instead; the operation that
    // awaited it already failed on its own terms.
    recordMainError('unhandledRejection', reason)
    console.error('Unhandled rejection in main:', reason)
  })
}
