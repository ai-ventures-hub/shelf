import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useToolDrafts } from '../hooks/useToolDrafts'
import { formatRelativeTime } from '../lib/relativeTime'
import type { RegisterOutcome } from '../types'

const OUTCOME_COPY: Partial<Record<RegisterOutcome, string>> = {
  saved: 'Saved. Launch it from the library when you want it running.',
  needs_setup: 'Saved. It still needs setup before it can run.',
  saved_needs_review: 'Saved. Review the launch command before you run it.',
  saved_launch_failed: 'Saved, but the first launch failed. The draft is cleared.',
  launched: 'Saved and running.',
  invalid_folder: 'That folder is gone. The draft is still here.',
}

/**
 * Consent sheet for agent registrations. Accept calls the existing register
 * path with launch left off. Reject deletes the draft and writes nothing.
 */
export function DraftToolsPage() {
  const { drafts, error, refresh } = useToolDrafts()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  async function accept(id: string) {
    setBusyId(id)
    setNotice(null)
    try {
      const result = await window.shelf.acceptToolDraft(id)
      setNotice(OUTCOME_COPY[result.outcome] || `Saved (${result.outcome}).`)
      await refresh()
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err))
    } finally {
      setBusyId(null)
    }
  }

  async function reject(id: string) {
    setBusyId(id)
    setNotice(null)
    try {
      await window.shelf.rejectToolDraft(id)
      await refresh()
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <>
      <header className="page-header">
        <div className="page-header-copy">
          <p className="eyebrow">Agent registration</p>
          <h1 className="page-title">Waiting for you</h1>
          <p className="page-lede">
            An agent asked to add these folders. Nothing here is in the library,
            and nothing has been launched.
          </p>
        </div>
      </header>

      {error ? (
        <div className="warning-card" role="alert">
          {error}
        </div>
      ) : null}
      {notice ? <p className="activity-notice">{notice}</p> : null}

      {drafts.length === 0 ? (
        <div className="empty-state">
          <div>
            <h2>No drafts waiting</h2>
            <p>When an agent registers a new folder, it lands here first.</p>
            <Link className="btn btn-quiet" to="/activity">
              Activity
            </Link>
          </div>
        </div>
      ) : (
        <div className="draft-list">
          {drafts.map((draft) => (
            <article key={draft.id} className="draft-card">
              <header className="draft-card-head">
                <h2>{draft.name}</h2>
                <time dateTime={draft.updatedAt}>{formatRelativeTime(draft.updatedAt)}</time>
              </header>
              <dl className="draft-facts">
                <div>
                  <dt>Folder</dt>
                  <dd>{draft.projectPath}</dd>
                </div>
                <div>
                  <dt>Command</dt>
                  <dd>
                    <code>{draft.launchCommand || 'No command detected'}</code>
                  </dd>
                </div>
                <div>
                  <dt>Port</dt>
                  <dd>{draft.port ?? 'None'}</dd>
                </div>
                <div>
                  <dt>Env keys</dt>
                  <dd>{draft.envKeys.length ? draft.envKeys.join(', ') : 'None declared'}</dd>
                </div>
                {draft.client ? (
                  <div>
                    <dt>From</dt>
                    <dd>{draft.client}</dd>
                  </div>
                ) : null}
              </dl>
              <div className="action-row">
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={busyId !== null}
                  onClick={() => void accept(draft.id)}
                >
                  {busyId === draft.id ? 'Saving…' : 'Accept'}
                </button>
                <button
                  type="button"
                  className="btn btn-quiet btn-sm"
                  disabled={busyId !== null}
                  onClick={() => void reject(draft.id)}
                >
                  Reject
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </>
  )
}
