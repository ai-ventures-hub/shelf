import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { errorText } from '../lib/errorText'
import { subscribeDataRefresh } from '../lib/refreshTriggers'
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

/** Stores the board is built from; a change to any of them re-reads it. */
const BOARD_SOURCES = [
  'receipts.json',
  'capability-gaps.json',
  'design-profiles.json',
  'tool-drafts.json',
  'library.json',
] as const

/**
 * One timeline built from receipts, gaps, design drafts, verification,
 * client observations, and tool drafts. It does not write a new store.
 */
export function MorningBoardPage() {
  const [events, setEvents] = useState<MorningEvent[]>([])
  const [client, setClient] = useState('all')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const generation = useRef(0)

  const load = useCallback(async () => {
    const ticket = ++generation.current
    try {
      const rows = await window.shelf.getActivityBoard()
      if (ticket !== generation.current) return
      setEvents(rows)
      setError(null)
    } catch (err: unknown) {
      if (ticket === generation.current) setError(errorText(err))
    } finally {
      if (ticket === generation.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    // Bursts (a launch writes a receipt, then its end) collapse into one read.
    let timer: number | undefined
    const soon = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(() => void load(), 250)
    }
    const offFiles = subscribeDataRefresh(BOARD_SOURCES, soon, { focus: false })
    const offReceipt = window.shelf?.onReceiptUpdate ? window.shelf.onReceiptUpdate(soon) : () => {}
    const offVerify = window.shelf?.onVerificationUpdate ? window.shelf.onVerificationUpdate(soon) : () => {}
    return () => {
      generation.current++
      window.clearTimeout(timer)
      offFiles()
      offReceipt()
      offVerify()
    }
  }, [load])

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
        <div className="warning-card" role="alert" style={{ marginBottom: '1rem' }}>
          Could not read activity. {error}
          <div className="action-row" style={{ margin: '0.6rem 0 0' }}>
            <button
              type="button"
              className="btn btn-quiet btn-sm"
              onClick={() => {
                setLoading(true)
                void load()
              }}
            >
              Try again
            </button>
          </div>
        </div>
      ) : null}

      {events.length > 0 ? (
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
      ) : null}

      {loading && events.length === 0 ? (
        <p className="muted" role="status">
          Loading activity…
        </p>
      ) : error && events.length === 0 ? null : shown.length === 0 ? (
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
