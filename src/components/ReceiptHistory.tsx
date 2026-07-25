import { Link } from 'react-router-dom'
import type { ReceiptOutcome, RunReceipt } from '../types'

function formatRelative(iso?: string): string {
  if (!iso) return '—'
  const then = Date.parse(iso)
  if (!Number.isFinite(then)) return '—'
  const mins = Math.round((Date.now() - then) / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 48) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

function formatDuration(ms?: number): string {
  if (ms == null || !Number.isFinite(ms)) return '—'
  if (ms < 1000) return `${ms}ms`
  const sec = Math.round(ms / 1000)
  if (sec < 60) return `${sec}s`
  const min = Math.floor(sec / 60)
  const rem = sec % 60
  if (min < 60) return rem ? `${min}m ${rem}s` : `${min}m`
  const hr = Math.floor(min / 60)
  return `${hr}h ${min % 60}m`
}

function outcomeLabel(outcome: ReceiptOutcome): string {
  switch (outcome) {
    case 'starting':
      return 'Starting'
    case 'running':
      return 'Running'
    case 'stopped':
      return 'Stopped'
    case 'error':
      return 'Error'
    case 'failed':
      return 'Failed'
    case 'interrupted':
      return 'Interrupted'
    default:
      return outcome
  }
}

export type ReceiptOutcomeFilter =
  | 'all'
  | 'ok'
  | 'problems'
  | 'running'
  | ReceiptOutcome

const FILTER_CHIPS: { id: ReceiptOutcomeFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'ok', label: 'Stopped' },
  { id: 'problems', label: 'Problems' },
  { id: 'running', label: 'Active' },
]

/** Map UI chip → outcomes passed to listReceipts. */
export function outcomesForFilter(
  filter: ReceiptOutcomeFilter,
): ReceiptOutcome[] | undefined {
  if (filter === 'all') return undefined
  if (filter === 'ok') return ['stopped']
  if (filter === 'problems') return ['error', 'failed', 'interrupted']
  if (filter === 'running') return ['starting', 'running']
  return [filter]
}

/**
 * Compact launch-history list for Recent view and tool detail.
 */
export function ReceiptHistory({
  receipts,
  showToolName = false,
  emptyLabel = 'No run receipts yet.',
  filter,
  onFilterChange,
  onExport,
  exporting = false,
}: {
  receipts: RunReceipt[]
  showToolName?: boolean
  emptyLabel?: string
  /** When set with onFilterChange, shows outcome chips above the list. */
  filter?: ReceiptOutcomeFilter
  onFilterChange?: (next: ReceiptOutcomeFilter) => void
  onExport?: (format: 'json' | 'csv') => void
  exporting?: boolean
}) {
  const showToolbar = Boolean(onFilterChange || onExport)

  return (
    <div className="receipt-history">
      {showToolbar ? (
        <div className="receipt-toolbar">
          {onFilterChange && filter != null ? (
            <div className="receipt-filters" role="group" aria-label="Filter receipts">
              {FILTER_CHIPS.map((chip) => (
                <button
                  key={chip.id}
                  type="button"
                  className={`filter-token${filter === chip.id ? ' is-active' : ''}`}
                  aria-pressed={filter === chip.id}
                  onClick={() => onFilterChange(chip.id)}
                >
                  {chip.label}
                </button>
              ))}
            </div>
          ) : null}
          {onExport ? (
            <div className="receipt-export">
              <button
                type="button"
                className="btn btn-quiet btn-sm"
                disabled={exporting || receipts.length === 0}
                onClick={() => onExport('json')}
              >
                Export JSON
              </button>
              <button
                type="button"
                className="btn btn-quiet btn-sm"
                disabled={exporting || receipts.length === 0}
                onClick={() => onExport('csv')}
              >
                Export CSV
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {receipts.length === 0 ? (
        <p className="receipt-empty">{emptyLabel}</p>
      ) : (
        <ul className="receipt-list" aria-label="Run receipts">
          {receipts.map((r) => (
            <li key={r.id} className="receipt-row" data-outcome={r.outcome}>
              <div className="receipt-row-main">
                <span className={`receipt-outcome is-${r.outcome}`}>
                  {outcomeLabel(r.outcome)}
                </span>
                {showToolName ? (
                  <Link className="receipt-tool" to={`/tools/${r.toolId}`}>
                    {r.toolName}
                  </Link>
                ) : null}
                <span className="receipt-when" title={r.startedAt}>
                  {formatRelative(r.startedAt)}
                </span>
                <span className="receipt-duration">{formatDuration(r.durationMs)}</span>
                {r.port ? <span className="receipt-port">:{r.port}</span> : null}
              </div>
              <p className="receipt-message">{r.message || r.launchCommand}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
