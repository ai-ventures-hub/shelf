/**
 * "Check for updates" for a tool added from a shared repo. Check = fetch +
 * summary only (commits, manifest diff, new setup/env). Applying is always a
 * user click; a diverged copy is said plainly with keep-yours / take-theirs
 * and no merge UI (SHARING.md).
 */
import { useEffect, useRef, useState } from 'react'
import { useLibrary } from '../../hooks/useLibrary'
import type { ApplyUpdateResult, Tool, UpdateCheck } from '../../types'

type Phase =
  | { kind: 'checking' }
  | { kind: 'checked'; check: UpdateCheck }
  | { kind: 'applying' }
  | { kind: 'applied'; result: ApplyUpdateResult }
  | { kind: 'error'; message: string }

export function UpdateSheet({ tool, open, onClose }: { tool: Tool; open: boolean; onClose: () => void }) {
  const { refresh } = useLibrary()
  const [phase, setPhase] = useState<Phase>({ kind: 'checking' })
  const [runSetup, setRunSetup] = useState(false)
  const sheetRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const id = window.setTimeout(() => sheetRef.current?.focus(), 30)
    return () => window.clearTimeout(id)
  }, [open, phase.kind])

  useEffect(() => {
    if (!open) return
    let active = true
    setRunSetup(false)
    setPhase({ kind: 'checking' })
    window.shelf
      .checkToolUpdates(tool.id)
      .then((check) => {
        if (active) setPhase({ kind: 'checked', check })
      })
      .catch((err) => {
        if (active) setPhase({ kind: 'error', message: err instanceof Error ? err.message : String(err) })
      })
    return () => {
      active = false
    }
  }, [open, tool.id])

  if (!open) return null

  async function apply(mode: 'fast_forward' | 'take_theirs', target: string, setupCommands: string[]) {
    setPhase({ kind: 'applying' })
    try {
      const result = await window.shelf.applyToolUpdate(tool.id, {
        mode,
        target,
        runSetup: runSetup && setupCommands.length > 0,
        setupCommands: runSetup ? setupCommands : [],
      })
      await refresh()
      setPhase({ kind: 'applied', result })
    } catch (err) {
      setPhase({ kind: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  }

  const busy = phase.kind === 'checking' || phase.kind === 'applying'

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
        aria-labelledby="update-sheet-title"
        onKeyDown={(e) => {
          if (e.key === 'Escape' && !busy) {
            e.preventDefault()
            onClose()
          }
        }}
      >
        <h2 id="update-sheet-title" className="consent-title">
          Updates for “{tool.name}”
        </h2>
        {tool.source?.repo ? (
          <p className="consent-lede">
            <code style={{ fontSize: '0.85em' }}>{tool.source.repo}</code>
          </p>
        ) : null}

        {phase.kind === 'checking' ? (
          <p className="field-hint" role="status">
            Checking the shared repository… nothing is changed by this.
          </p>
        ) : null}
        {phase.kind === 'applying' ? (
          <p className="field-hint" role="status">
            Updating…
          </p>
        ) : null}

        {phase.kind === 'error' ? (
          <div className="warning-card" role="alert">
            {phase.message}
          </div>
        ) : null}

        {phase.kind === 'checked' ? <CheckBody check={phase.check} tool={tool} runSetup={runSetup} onRunSetup={setRunSetup} /> : null}

        {phase.kind === 'applied' ? (
          <div className="consent-section">
            <p className="consent-value">{phase.result.message}</p>
            {phase.result.applied.length > 0 ? (
              <p className="consent-value is-muted">
                Updated from the manifest: {phase.result.applied.join(', ')}.
              </p>
            ) : null}
            {phase.result.skipped.length > 0 ? (
              <p className="consent-value is-muted">
                Kept your version of{' '}
                {phase.result.skipped.map((s) => `${s.field} (${s.reason})`).join('; ')}.
              </p>
            ) : null}
            {phase.result.missingEnvKeys.length > 0 ? (
              <p className="consent-value is-muted">
                Needs values (Edit this tool): {phase.result.missingEnvKeys.join(', ')}.
              </p>
            ) : null}
            {phase.result.running ? (
              <p className="consent-value">
                The tool was running while its files changed — restart it to pick up the update.
              </p>
            ) : null}
            {phase.result.setup?.some((s) => !s.ok) ? (
              <div className="warning-card" style={{ marginTop: '0.5rem' }}>
                A setup command failed — see Live logs.
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="consent-actions">
          {phase.kind === 'checked' && phase.check.state === 'updates_available' ? (
            <>
              <p className="consent-actions-note">Nothing changes until you click Update.</p>
              <button type="button" className="btn btn-quiet" onClick={onClose}>
                Not now
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() =>
                  phase.check.state === 'updates_available' &&
                  void apply('fast_forward', phase.check.target, phase.check.newBootstrap)
                }
              >
                Update
              </button>
            </>
          ) : phase.kind === 'checked' && phase.check.state === 'diverged' ? (
            <>
              <p className="consent-actions-note">Your copy and the shared one both changed.</p>
              <button type="button" className="btn btn-quiet" onClick={onClose}>
                Keep mine
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => {
                  if (
                    phase.check.state === 'diverged' &&
                    window.confirm(
                      `Replace your copy of “${tool.name}” with the shared version? Your local changes in this folder will be discarded. This cannot be undone.`,
                    )
                  ) {
                    void apply('take_theirs', phase.check.target, phase.check.newBootstrap)
                  }
                }}
              >
                Take theirs
              </button>
            </>
          ) : (
            <button type="button" className="btn btn-primary" disabled={busy} onClick={onClose}>
              {phase.kind === 'applied' ? 'Done' : 'Close'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function CheckBody({
  check,
  tool,
  runSetup,
  onRunSetup,
}: {
  check: UpdateCheck
  tool: Tool
  runSetup: boolean
  onRunSetup: (value: boolean) => void
}) {
  switch (check.state) {
    case 'up_to_date':
      return (
        <p className="consent-value">
          Up to date — nothing new on the shared side ({check.ref.slice(0, 10)}).
          {check.dirty ? ' You have local changes in this folder; Shelf leaves them alone.' : ''}
        </p>
      )
    case 'no_target_branch':
      return (
        <p className="consent-value">
          Shelf can’t tell which branch on <code>{check.remote}</code> to follow (no origin/HEAD, main, or master).
        </p>
      )
    case 'not_shared':
      return <p className="consent-value">This tool wasn’t added from a shared repository.</p>
    case 'folder_missing':
      return <p className="consent-value">Shelf can’t find this tool’s folder anymore.</p>
    case 'not_git':
      return <p className="consent-value">This folder is no longer a git repository, so Shelf can’t check it.</p>
    case 'no_remote':
      return <p className="consent-value">This folder has no remote to check against.</p>
    case 'git_missing':
      return (
        <div className="warning-card">
          <strong>{check.message}</strong>
          <p style={{ margin: '0.4rem 0 0', fontSize: '0.88rem' }}>{check.remedy}</p>
        </div>
      )
    case 'fetch_failed':
      return (
        <div className="warning-card">
          <strong>Couldn’t reach the shared repository.</strong>
          <p style={{ margin: '0.4rem 0 0', fontSize: '0.88rem' }}>{check.message}</p>
        </div>
      )
    case 'updates_available':
    case 'diverged': {
      const diverged = check.state === 'diverged'
      return (
        <>
          {diverged ? (
            <div className="warning-card" style={{ marginBottom: '0.5rem' }}>
              <strong>Your copy has diverged from the shared version.</strong>
              <p style={{ margin: '0.4rem 0 0', fontSize: '0.88rem' }}>
                {check.dirty ? 'You have uncommitted changes in this folder. ' : ''}
                {check.ahead > 0
                  ? `You have ${check.ahead} local commit${check.ahead === 1 ? '' : 's'} the shared version doesn’t. `
                  : ''}
                Shelf won’t merge. Keep yours, or replace your copy with theirs.
              </p>
            </div>
          ) : null}
          <div className="consent-section">
            <div className="field-label">
              {check.behind} new commit{check.behind === 1 ? '' : 's'} on {check.target}
            </div>
            {check.commits.length > 0 ? (
              <ul className="consent-list">
                {check.commits.map((commit) => (
                  <li key={commit.sha}>
                    <code style={{ fontSize: '0.8em' }}>{commit.sha}</code> {commit.subject}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="consent-value is-muted">No incoming commits.</p>
            )}
          </div>
          <div className="consent-section">
            <div className="field-label">Manifest changes</div>
            {check.manifestDiff.length > 0 ? (
              <dl className="consent-diff">
                {check.manifestDiff.map((d) => (
                  <DiffRow key={d.field} field={d.field} before={d.before} after={d.after} />
                ))}
              </dl>
            ) : (
              <p className="consent-value is-muted">shelf.json is unchanged.</p>
            )}
            {check.depsChanged ? (
              <p className="consent-value is-muted" style={{ marginTop: '0.4rem' }}>
                Dependency files changed in this update.
              </p>
            ) : null}
            {check.newEnvKeys.length > 0 ? (
              <p className="consent-value is-muted" style={{ marginTop: '0.4rem' }}>
                New values you’ll need to add in Edit: {check.newEnvKeys.join(', ')}.
              </p>
            ) : null}
          </div>
          {check.newBootstrap.length > 0 ? (
            <div className="consent-section">
              <div className="field-label">
                {check.depsChanged ? 'Setup to re-run after updating' : 'New setup commands in the shared manifest'}
              </div>
              {check.newBootstrap.map((command, index) => (
                <code className="consent-code" key={`${index}:${command}`}>
                  {command}
                </code>
              ))}
              <label className="consent-checkbox">
                <input type="checkbox" checked={runSetup} onChange={(e) => onRunSetup(e.target.checked)} />
                <span>Run these after updating, from {tool.projectPath}</span>
              </label>
            </div>
          ) : null}
        </>
      )
    }
    default:
      return null
  }
}

function DiffRow({ field, before, after }: { field: string; before?: string; after?: string }) {
  return (
    <>
      <dt>{field}</dt>
      <dd>
        {before ? <del>{before}</del> : <span style={{ color: 'var(--subtle)' }}>(none)</span>}
        {' → '}
        {after ? <ins>{after}</ins> : <span style={{ color: 'var(--subtle)' }}>(removed)</span>}
      </dd>
    </>
  )
}
