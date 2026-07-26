import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useCapabilityGaps } from '../hooks/useCapabilityGaps'
import { useLibrary } from '../hooks/useLibrary'
import type { CapabilityGapStatus } from '../types'

const FILTERS: Array<{ value: CapabilityGapStatus | 'all'; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'open', label: 'Open' },
  { value: 'planned', label: 'Planned' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'dismissed', label: 'Dismissed' },
]

function formatDate(value: string): string {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return 'Unknown'
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: parsed.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
  }).format(parsed)
}

export function CapabilityGapsPage() {
  const [filter, setFilter] = useState<CapabilityGapStatus | 'all'>('open')
  const { gaps, loading, error, updateStatus, remove } = useCapabilityGaps({
    status: filter === 'all' ? undefined : filter,
  })
  const { tools } = useLibrary()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  async function run(id: string, action: () => Promise<void>) {
    setBusyId(id)
    setActionError(null)
    try {
      await action()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <>
      <header className="page-header">
        <div className="page-header-copy">
          <p className="eyebrow">Capability intelligence</p>
          <h1 className="page-title">Capability gaps</h1>
          <p className="page-lede">
            Unmet needs recorded by your connected agents, kept local for planning.
          </p>
        </div>
      </header>

      <div className="gap-filters" role="group" aria-label="Filter capability gaps">
        {FILTERS.map((item) => (
          <button
            type="button"
            className={`btn btn-quiet btn-sm${filter === item.value ? ' is-active' : ''}`}
            aria-pressed={filter === item.value}
            key={item.value}
            onClick={() => setFilter(item.value)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {error || actionError ? (
        <div className="warning-card" role="alert">
          {actionError || error}
        </div>
      ) : null}

      {!loading && gaps.length === 0 ? (
        <div className="empty-state gap-empty">
          <div>
            <h2>No {filter === 'all' ? '' : `${filter} `}capability gaps</h2>
            <p>
              Agents connected to Shelf can record a gap when the library has no suitable tool.
            </p>
          </div>
        </div>
      ) : (
        <div className="gap-list" aria-live="polite">
          {gaps.map((gap) => {
            const related = gap.relatedToolIds
              .map((id) => tools.find((tool) => tool.id === id))
              .filter((tool) => Boolean(tool))
            const params = new URLSearchParams({
              capabilities: gap.capabilities.join('\n'),
            })
            return (
              <article className="panel gap-card" key={gap.id}>
                <div className="panel-header gap-card-header">
                  <div>
                    <div className="capability-chips">
                      {gap.capabilities.map((capability) => (
                        <span className="tag-chip" key={capability}>{capability}</span>
                      ))}
                    </div>
                    <h2 className="gap-title">{gap.task}</h2>
                  </div>
                  <span className={`readiness-badge is-${gap.status}`}>{gap.status}</span>
                </div>
                <div className="panel-body gap-body">
                  <p className="gap-reason">{gap.reason}</p>
                  <dl className="gap-meta">
                    <div>
                      <dt>Requested</dt>
                      <dd>{gap.occurrenceCount} time{gap.occurrenceCount === 1 ? '' : 's'}</dd>
                    </div>
                    <div>
                      <dt>Last request</dt>
                      <dd>{formatDate(gap.lastRequestedAt)}</dd>
                    </div>
                    <div>
                      <dt>Suggested access</dt>
                      <dd>{gap.suggestedAccess || 'Not specified'}</dd>
                    </div>
                  </dl>
                  {related.length > 0 ? (
                    <div className="gap-related">
                      <span className="field-label">Related tools</span>
                      {related.map((tool) => (
                        <Link key={tool!.id} to={`/tools/${tool!.id}`}>{tool!.name}</Link>
                      ))}
                    </div>
                  ) : null}
                  {gap.examples.length > 1 ? (
                    <details className="gap-examples">
                      <summary>Recent request examples</summary>
                      <ul>
                        {gap.examples.map((example) => (
                          <li key={`${example.at}:${example.task}`}>
                            {example.task} <span>· {formatDate(example.at)}</span>
                          </li>
                        ))}
                      </ul>
                    </details>
                  ) : null}
                  <div className="action-row gap-actions">
                    <Link className="btn btn-primary btn-sm" to={`/tools/new?${params.toString()}`}>
                      Create tool
                    </Link>
                    {gap.status !== 'planned' ? (
                      <button type="button" className="btn btn-quiet btn-sm" disabled={busyId === gap.id} onClick={() => void run(gap.id, () => updateStatus(gap.id, 'planned'))}>
                        Plan
                      </button>
                    ) : null}
                    {gap.status !== 'resolved' ? (
                      <button type="button" className="btn btn-quiet btn-sm" disabled={busyId === gap.id} onClick={() => void run(gap.id, () => updateStatus(gap.id, 'resolved'))}>
                        Resolve
                      </button>
                    ) : null}
                    {gap.status !== 'dismissed' ? (
                      <button type="button" className="btn btn-quiet btn-sm" disabled={busyId === gap.id} onClick={() => void run(gap.id, () => updateStatus(gap.id, 'dismissed'))}>
                        Dismiss
                      </button>
                    ) : null}
                    {gap.status !== 'open' ? (
                      <button type="button" className="btn btn-quiet btn-sm" disabled={busyId === gap.id} onClick={() => void run(gap.id, () => updateStatus(gap.id, 'open'))}>
                        Reopen
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="btn btn-quiet btn-sm is-danger"
                      disabled={busyId === gap.id}
                      onClick={() => {
                        if (window.confirm('Delete this capability gap?')) {
                          void run(gap.id, () => remove(gap.id))
                        }
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </article>
            )
          })}
        </div>
      )}
    </>
  )
}
