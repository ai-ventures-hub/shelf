/**
 * "Share with team" (1.4) — publish this tool's entry into a catalog repo.
 *
 * What travels is a POINTER: name, description, capabilities, and the tool's
 * own git remote. No launch command, no setup steps, no env keys, so this
 * path can leak nothing a manifest would have stripped anyway. The teammate
 * who installs it still sees the full consent sheet, built from the tool's
 * repo, at that moment.
 *
 * A push that fails is not a failed publish: the entry stays committed in the
 * local clone and the sheet says exactly how to finish it.
 */
import { useEffect, useRef, useState } from 'react'
import type { CatalogPublishResult, ShareFailure, TeamCatalog, Tool } from '../../types'

type Phase =
  | { kind: 'loading' }
  | { kind: 'pick'; catalogs: TeamCatalog[] }
  | { kind: 'publishing'; catalog: TeamCatalog }
  | { kind: 'done'; catalog: TeamCatalog; result: CatalogPublishResult }
  | { kind: 'error'; failure: ShareFailure; catalogs: TeamCatalog[] }

export function ShareWithTeamDialog({
  tool,
  open,
  onClose,
}: {
  tool: Tool
  open: boolean
  onClose: () => void
}) {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' })
  const sheetRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const id = window.setTimeout(() => sheetRef.current?.focus(), 30)
    return () => window.clearTimeout(id)
  }, [open, phase.kind])

  useEffect(() => {
    if (!open) return
    let active = true
    setPhase({ kind: 'loading' })
    window.shelf
      .listTeamCatalogs()
      .then((catalogs) => {
        if (active) setPhase({ kind: 'pick', catalogs })
      })
      .catch(() => {
        if (active) setPhase({ kind: 'pick', catalogs: [] })
      })
    return () => {
      active = false
    }
  }, [open])

  if (!open) return null

  const busy = phase.kind === 'loading' || phase.kind === 'publishing'

  async function publish(catalog: TeamCatalog, catalogs: TeamCatalog[]) {
    setPhase({ kind: 'publishing', catalog })
    const outcome = await window.shelf.publishToTeamCatalog(catalog.id, tool.id)
    if (!outcome.ok) {
      setPhase({ kind: 'error', failure: outcome, catalogs })
      return
    }
    setPhase({ kind: 'done', catalog: outcome.catalog || catalog, result: outcome.result })
  }

  return (
    <div
      className="name-prompt-backdrop consent-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose()
      }}
    >
      <div
        ref={sheetRef}
        tabIndex={-1}
        className="consent-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-team-title"
        onKeyDown={(e) => {
          if (e.key === 'Escape' && !busy) {
            e.preventDefault()
            onClose()
          }
        }}
      >
        <h2 id="share-team-title" className="consent-title">
          Share “{tool.name}” with a team
        </h2>
        <p className="consent-lede">
          Shelf adds a line to that team's catalog: the name, what it does, and the repo it
          lives in. No commands, no keys.
        </p>

        {phase.kind === 'loading' ? (
          <p className="field-hint" role="status">
            Reading your catalogs…
          </p>
        ) : null}

        {(phase.kind === 'pick' || phase.kind === 'error') && phase.catalogs.length === 0 ? (
          <div className="consent-section">
            <p className="consent-value is-muted">
              You aren't subscribed to a team catalog yet. Add one under Team Tools, then share
              this tool into it.
            </p>
          </div>
        ) : null}

        {phase.kind === 'error' ? (
          <div className="warning-card" role="alert">
            <p style={{ margin: 0 }}>{phase.failure.message}</p>
            {phase.failure.remedy ? (
              <p style={{ margin: '0.4rem 0 0', color: 'var(--muted)' }}>{phase.failure.remedy}</p>
            ) : null}
            {phase.failure.remedyCommand ? (
              <button
                type="button"
                className="btn btn-quiet btn-sm"
                style={{ marginTop: '0.5rem' }}
                onClick={() =>
                  void navigator.clipboard.writeText(phase.failure.remedyCommand as string)
                }
              >
                Copy the command
              </button>
            ) : null}
          </div>
        ) : null}

        {phase.kind === 'publishing' ? (
          <p className="field-hint" role="status">
            Publishing to {phase.catalog.name}…
          </p>
        ) : null}

        {(phase.kind === 'pick' || phase.kind === 'error') && phase.catalogs.length > 0 ? (
          <div className="consent-section team-pick">
            {phase.catalogs.map((catalog) => (
              <button
                type="button"
                className="team-pick-row"
                key={catalog.id}
                disabled={busy}
                onClick={() => void publish(catalog, phase.catalogs)}
              >
                <span>
                  <strong>{catalog.name}</strong>
                  <small>
                    {catalog.entries.length} {catalog.entries.length === 1 ? 'tool' : 'tools'}
                  </small>
                </span>
                <span className="team-pick-cta">Share here</span>
              </button>
            ))}
          </div>
        ) : null}

        {phase.kind === 'done' ? (
          <div className="consent-section">
            <p className="consent-value">
              {phase.result.action === 'added' ? 'Added' : 'Updated'} in {phase.catalog.name}.
              {phase.result.pushed
                ? ' Pushed, so your teammates see it on their next refresh.'
                : ''}
            </p>
            {!phase.result.pushed ? (
              <div className="warning-card" role="alert">
                <p style={{ margin: 0 }}>{phase.result.pushProblem}</p>
                {phase.result.pushRemedy ? (
                  <p style={{ margin: '0.4rem 0 0', color: 'var(--muted)' }}>
                    {phase.result.pushRemedy}
                  </p>
                ) : null}
                {phase.result.pushRemedyCommand ? (
                  <button
                    type="button"
                    className="btn btn-quiet btn-sm"
                    style={{ marginTop: '0.5rem' }}
                    onClick={() =>
                      void navigator.clipboard.writeText(
                        phase.result.pushRemedyCommand as string,
                      )
                    }
                  >
                    Copy the command
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="consent-actions">
          <button type="button" className="btn btn-quiet" disabled={busy} onClick={onClose}>
            {phase.kind === 'done' ? 'Done' : 'Cancel'}
          </button>
        </div>
      </div>
    </div>
  )
}
