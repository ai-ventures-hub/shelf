import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useCapabilityGaps } from '../hooks/useCapabilityGaps'
import { useLibrary } from '../hooks/useLibrary'
import { useToolDrafts } from '../hooks/useToolDrafts'
import { useUiMode } from '../hooks/useUiMode'
import { errorText } from '../lib/errorText'
import { friendlyLaunchError } from '../lib/launchErrorCopy'
import { formatRelativeTime } from '../lib/relativeTime'
import type { RegisterOutcome } from '../types'

const DRAFT_OUTCOME_COPY: Partial<Record<RegisterOutcome, string>> = {
  saved: 'Saved to your library. Launch it whenever you want it running.',
  needs_setup: 'Saved. It still needs setup before it can run.',
  saved_needs_review: 'Saved. Review the launch command before you run it.',
  saved_launch_failed: 'Saved, but the first launch failed. The draft is cleared.',
  launched: 'Saved and running.',
  invalid_folder: 'That folder is gone. The draft is still here.',
}

/**
 * Unified "Needs you" inbox: merges crashed/errored tools, staged agent
 * registrations waiting for approval, and open capability gaps into one calm
 * decision queue so the user does not have to check three separate pages.
 */
export function NeedsYouPage() {
  const { tools, states, startTool } = useLibrary()
  const { drafts, error: draftError, refresh: refreshDrafts } = useToolDrafts()
  const { isDeveloper } = useUiMode()
  const { gaps: openGaps } = useCapabilityGaps({
    status: 'open',
    limit: 50,
    enabled: isDeveloper,
    withSuggestions: false,
  })

  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const erroredTools = tools.filter((tool) => states[tool.id]?.status === 'error')
  const totalCount = erroredTools.length + drafts.length + (isDeveloper ? openGaps.length : 0)

  async function retryTool(toolId: string, reassignPort = false) {
    setBusyKey(`tool:${toolId}`)
    setNotice(null)
    try {
      await startTool(toolId, reassignPort ? { onPortConflict: 'reassign' } : undefined)
    } catch (err) {
      setNotice(errorText(err))
    } finally {
      setBusyKey(null)
    }
  }

  async function decideDraft(id: string, shownRevision: string, accept: boolean) {
    setBusyKey(`draft:${id}`)
    setNotice(null)
    try {
      if (accept) {
        const result = await window.shelf.acceptToolDraft(id, shownRevision)
        setNotice(DRAFT_OUTCOME_COPY[result.outcome] || `Saved (${result.outcome}).`)
      } else {
        await window.shelf.rejectToolDraft(id)
      }
      await refreshDrafts()
    } catch (err) {
      setNotice(errorText(err))
      await refreshDrafts()
    } finally {
      setBusyKey(null)
    }
  }

  return (
    <>
      <header className="page-header">
        <div className="page-header-copy">
          <p className="eyebrow">Inbox</p>
          <h1 className="page-title">Needs you</h1>
          <p className="page-lede">
            Everything waiting on a decision — crashed tools, agent registrations, and open requests — in one place.
          </p>
        </div>
        <div className="action-row">
          <Link className="btn btn-quiet btn-sm" to="/activity">
            Activity timeline
          </Link>
        </div>
      </header>

      {draftError ? (
        <div className="warning-card" role="alert" style={{ marginBottom: '1rem' }}>
          {draftError}
        </div>
      ) : null}
      {notice ? (
        <p className="activity-notice" role="status">
          {notice}
        </p>
      ) : null}

      {totalCount === 0 ? (
        <div className="empty-state">
          <div>
            <h2>All clear</h2>
            <p>No broken tools, waiting drafts, or open requests right now.</p>
            <div className="empty-state-actions">
              <Link className="btn btn-primary" to="/">
                Back to library
              </Link>
              <Link className="btn btn-quiet" to="/activity">
                View activity
              </Link>
            </div>
          </div>
        </div>
      ) : (
        <div className="inbox-sections">
          {erroredTools.length > 0 ? (
            <section className="inbox-section" aria-labelledby="inbox-errors-title">
              <div className="inbox-section-head">
                <h2 id="inbox-errors-title">Tools needing attention</h2>
                <span className="nav-count">{erroredTools.length}</span>
              </div>
              <div className="draft-list">
                {erroredTools.map((tool) => {
                  const st = states[tool.id]
                  const busy = busyKey === `tool:${tool.id}`
                  return (
                    <article key={tool.id} className="draft-card inbox-error-card">
                      <header className="draft-card-head">
                        <h3>
                          <Link to={`/tools/${encodeURIComponent(tool.id)}`}>{tool.name}</Link>
                        </h3>
                        {st?.startedAt ? (
                          <time dateTime={st.startedAt}>{formatRelativeTime(st.startedAt)}</time>
                        ) : null}
                      </header>
                      <p className="activity-detail">
                        {st?.code ? friendlyLaunchError(st.code) : st?.message || 'Stopped with an error.'}
                        {st?.detail ? (
                          <>
                            {' '}
                            <code>{st.detail}</code>
                          </>
                        ) : null}
                      </p>
                      <div className="action-row" style={{ margin: '0.75rem 0 0' }}>
                        {st?.code === 'port_in_use' ? (
                          <button
                            type="button"
                            className="btn btn-primary btn-sm"
                            disabled={busyKey !== null}
                            onClick={() => void retryTool(tool.id, true)}
                          >
                            {busy ? 'Launching…' : 'Launch on a free port'}
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="btn btn-primary btn-sm"
                            disabled={busyKey !== null}
                            onClick={() => void retryTool(tool.id, false)}
                          >
                            {busy ? 'Launching…' : 'Retry launch'}
                          </button>
                        )}
                        {st?.remedy === 'edit_env' ? (
                          <Link className="btn btn-quiet btn-sm" to={`/tools/${tool.id}/edit?focus=env`}>
                            Edit env vars
                          </Link>
                        ) : null}
                        <Link className="btn btn-quiet btn-sm" to={`/tools/${tool.id}/runs`}>
                          View logs
                        </Link>
                      </div>
                    </article>
                  )
                })}
              </div>
            </section>
          ) : null}

          {drafts.length > 0 ? (
            <section className="inbox-section" aria-labelledby="inbox-drafts-title">
              <div className="inbox-section-head">
                <h2 id="inbox-drafts-title">Waiting for your approval</h2>
                <span className="nav-count">{drafts.length}</span>
              </div>
              <div className="draft-list">
                {drafts.map((draft) => {
                  const busy = busyKey === `draft:${draft.id}`
                  return (
                    <article key={draft.id} className="draft-card">
                      <header className="draft-card-head">
                        <h3>{draft.name}</h3>
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
                        {draft.client ? (
                          <div>
                            <dt>From</dt>
                            <dd>{draft.client}</dd>
                          </div>
                        ) : null}
                        {draft.remotePreview ? (
                          <div>
                            <dt>Remote preview</dt>
                            <dd>Requested for paired phones.</dd>
                          </div>
                        ) : null}
                      </dl>
                      <div className="action-row" style={{ margin: '0.75rem 0 0' }}>
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          disabled={busyKey !== null}
                          onClick={() => void decideDraft(draft.id, draft.updatedAt, true)}
                        >
                          {busy ? 'Saving…' : 'Accept'}
                        </button>
                        <button
                          type="button"
                          className="btn btn-quiet btn-sm"
                          disabled={busyKey !== null}
                          onClick={() => void decideDraft(draft.id, draft.updatedAt, false)}
                        >
                          Reject
                        </button>
                        <Link className="btn btn-quiet btn-sm" to="/drafts">
                          Details
                        </Link>
                      </div>
                    </article>
                  )
                })}
              </div>
            </section>
          ) : null}

          {isDeveloper && openGaps.length > 0 ? (
            <section className="inbox-section" aria-labelledby="inbox-gaps-title">
              <div className="inbox-section-head">
                <h2 id="inbox-gaps-title">Open capability gaps</h2>
                <Link className="btn btn-quiet btn-sm" to="/gaps">
                  View all ({openGaps.length})
                </Link>
              </div>
              <ol className="activity-list">
                {openGaps.slice(0, 8).map((gap) => (
                  <li key={gap.id} className="activity-row">
                    <div className="activity-row-main">
                      <span className="activity-kind">
                        Asked {gap.occurrenceCount}× · {formatRelativeTime(gap.lastRequestedAt)}
                      </span>
                      <strong>{gap.task || gap.capabilities.join(', ')}</strong>
                      {gap.reason ? <p className="activity-detail">{gap.reason}</p> : null}
                    </div>
                    <div className="action-row" style={{ margin: 0 }}>
                      <Link
                        className="btn btn-quiet btn-sm"
                        to={`/tools/start?gap=${encodeURIComponent(gap.id)}`}
                      >
                        Build tool
                      </Link>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          ) : null}
        </div>
      )}
    </>
  )
}
