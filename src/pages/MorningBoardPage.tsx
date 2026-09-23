import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { formatRelativeTime } from '../lib/relativeTime'
import type { MorningEvent, MorningKind } from '../../shared/morning-board'

const KIND_LABEL: Record<MorningKind, string> = {
  launch: 'Launch',
  gap: 'Gap',
  design: 'Design',
  verification: 'Verify',
  client: 'Client',
  draft: 'Draft',
}

/**
 * One timeline built from receipts, gaps, design drafts, verification,
 * client observations, and tool drafts. It does not write a new store.
 */
export function MorningBoardPage() {
  const [events, setEvents] = useState<MorningEvent[]>([])
  const [client, setClient] = useState('all')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    window.shelf
      .getActivityBoard()
      .then((rows) => {
        if (!cancelled) setEvents(rows)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
    }
  }, [])

  const clients = useMemo(() => {
    const names = new Set<string>()
    for (const event of events) {
      if (event.client) names.add(event.client)
    }
    return Array.from(names).sort()
  }, [events])

  const shown = client === 'all' ? events : events.filter((event) => event.client === client)

  return (
    <>
      <header className="page-header">
        <div className="page-header-copy">
          <p className="eyebrow">Local record</p>
          <h1 className="page-title">Activity</h1>
          <p className="page-lede">
            What launched, what an agent asked for, and what is still waiting on you.
            Sorted from the files Shelf already keeps.
          </p>
        </div>
      </header>

      {error ? (
        <div className="warning-card" role="alert">
          {error}
        </div>
      ) : null}

      <div className="gap-filters" role="group" aria-label="Filter activity by client">
        <button
          type="button"
          className={`btn btn-quiet btn-sm${client === 'all' ? ' is-active' : ''}`}
          aria-pressed={client === 'all'}
          onClick={() => setClient('all')}
        >
          All
        </button>
        {clients.map((name) => (
          <button
            key={name}
            type="button"
            className={`btn btn-quiet btn-sm${client === name ? ' is-active' : ''}`}
            aria-pressed={client === name}
            onClick={() => setClient(name)}
          >
            {name}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <div className="empty-state">
          <div>
            <h2>Nothing recorded yet</h2>
            <p>Launches, gaps, and agent drafts will show up here.</p>
          </div>
        </div>
      ) : (
        <ol className="activity-list">
          {shown.map((event) => (
            <li key={event.id} className="activity-row">
              <div className="activity-row-main">
                <span className="activity-kind">{KIND_LABEL[event.kind]}</span>
                {event.href ? (
                  <Link to={event.href}>{event.title}</Link>
                ) : (
                  <span>{event.title}</span>
                )}
                <p className="activity-detail">{event.detail}</p>
              </div>
              <time className="activity-time" dateTime={event.at}>
                {formatRelativeTime(event.at)}
              </time>
            </li>
          ))}
        </ol>
      )}
    </>
  )
}
