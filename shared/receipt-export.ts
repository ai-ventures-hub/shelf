/**
 * Filter + serialize run receipts for Recent / Settings export.
 * Pure helpers — no filesystem I/O (callers write via dialog or smoke asserts).
 */
import type { ReceiptOutcome, RunReceipt } from './types'

export interface ReceiptFilterOpts {
  toolId?: string
  /** Single outcome, or several (e.g. errors = failed + error + interrupted). */
  outcomes?: ReceiptOutcome[]
  /** Case-insensitive match against tool name, command, or message. */
  query?: string
  limit?: number
}

/** Apply filters in memory (newest-first input assumed). */
export function filterReceipts(
  receipts: RunReceipt[],
  opts: ReceiptFilterOpts = {},
): RunReceipt[] {
  const q = opts.query?.trim().toLowerCase()
  const outcomes = opts.outcomes?.length ? new Set(opts.outcomes) : null
  let list = receipts
  if (opts.toolId) list = list.filter((r) => r.toolId === opts.toolId)
  if (outcomes) list = list.filter((r) => outcomes.has(r.outcome))
  if (q) {
    list = list.filter((r) => {
      const hay = [r.toolName, r.launchCommand, r.message || '', r.url || '']
        .join(' ')
        .toLowerCase()
      return hay.includes(q)
    })
  }
  if (opts.limit != null) {
    list = list.slice(0, Math.max(0, opts.limit))
  }
  return list
}

export function receiptsToJson(receipts: RunReceipt[]): string {
  return `${JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), receipts }, null, 2)}\n`
}

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`
  return value
}

/** Flat CSV for spreadsheets; secrets already masked at write time. */
export function receiptsToCsv(receipts: RunReceipt[]): string {
  const header = [
    'id',
    'toolId',
    'toolName',
    'outcome',
    'startedAt',
    'endedAt',
    'durationMs',
    'port',
    'url',
    'pid',
    'exitCode',
    'launchCommand',
    'message',
  ]
  const rows = receipts.map((r) =>
    [
      r.id,
      r.toolId,
      r.toolName,
      r.outcome,
      r.startedAt,
      r.endedAt || '',
      r.durationMs ?? '',
      r.port ?? '',
      r.url || '',
      r.pid ?? '',
      r.exitCode ?? '',
      r.launchCommand,
      r.message || '',
    ]
      .map((cell) => csvEscape(String(cell)))
      .join(','),
  )
  return `${header.join(',')}\n${rows.join('\n')}${rows.length ? '\n' : ''}`
}
