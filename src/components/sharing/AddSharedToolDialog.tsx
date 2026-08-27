/**
 * Add a shared tool (Tool Sharing, 1.2) — "Add from URL" / "Add from bundle"
 * / shelf://add. One sheet, two phases:
 *
 *   1. Source: paste a repo URL (or pick a bundle); a shelf://add link only
 *      pre-fills the field. Fetch — always an explicit click for links —
 *      clones/unzips into Shelf's scratch area and runs NOTHING.
 *   2. Consent: the full source, the destination folder, the exact setup
 *      commands and launch command verbatim, manifest notes, and an input
 *      per env key. Nothing runs or persists until "Add to my Shelf".
 *
 * A shelf:// link from chat is a lure shape, so this sheet is security
 * surface: it cannot be pre-confirmed by the link, and env inputs always
 * start empty (hints are prompts, never values).
 */
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLibrary } from '../../hooks/useLibrary'
import { friendlyLaunchError } from '../../lib/launchErrorCopy'
import type { ConfirmShareResult, ShareFailure, StagedShareView } from '../../types'

type Phase =
  | { kind: 'source' }
  | { kind: 'fetching'; label: string }
  | { kind: 'consent'; stage: StagedShareView; destination: string }
  | { kind: 'working'; stage: StagedShareView }
  | { kind: 'done'; result: ConfirmShareResult }

interface AddSharedToolDialogProps {
  open: boolean
  initialRepo?: string
  initialBundlePath?: string
  /** Fetch the repo on open instead of waiting for a Fetch click (catalogs). */
  autoFetch?: boolean
  onClose: () => void
}

function sourceLabel(stage: StagedShareView): string {
  return stage.source.kind === 'git' ? stage.source.repo : stage.source.bundlePath
}

export function AddSharedToolDialog({
  open,
  initialRepo,
  initialBundlePath,
  autoFetch,
  onClose,
}: AddSharedToolDialogProps) {
  const navigate = useNavigate()
  const { refresh } = useLibrary()
  const [phase, setPhase] = useState<Phase>({ kind: 'source' })
  const [repo, setRepo] = useState(initialRepo || '')
  const [error, setError] = useState<ShareFailure | null>(null)
  const [env, setEnv] = useState<Record<string, string>>({})
  const inputRef = useRef<HTMLInputElement>(null)
  const fetchButtonRef = useRef<HTMLButtonElement>(null)
  const sheetRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<string | null>(null)
  // Bumped on every open/reset; async results from a superseded open (a
  // second link arriving mid-fetch/mid-approve) are ignored.
  const genRef = useRef(0)

  // Keyboard: Escape must reach the sheet even when nothing inside is
  // focused (link-driven open, consent with no env inputs).
  useEffect(() => {
    if (!open) return
    const id = window.setTimeout(() => {
      if (document.activeElement === document.body) sheetRef.current?.focus()
    }, 30)
    return () => window.clearTimeout(id)
  }, [open, phase.kind])

  // Reset on open. A link-driven open shows the URL and waits for an
  // explicit Fetch click — a shelf:// link from chat must not cause even a
  // clone on its own. A bundle picked through the file dialog is already
  // the user's explicit choice, so it opens straight away.
  useEffect(() => {
    if (!open) return
    // A second link while a stage is live must not leak the first scratch clone.
    const stale = stageRef.current
    stageRef.current = null
    genRef.current += 1
    if (stale) void window.shelf.discardSharedTool(stale).catch(() => {})
    setError(null)
    setEnv({})
    setRepo(initialRepo || '')
    setPhase({ kind: 'source' })
    if (initialBundlePath) void fetchSource({ kind: 'bundle', bundlePath: initialBundlePath })
    // Install from a Team Tools catalog: the user subscribed to that catalog
    // themselves, so the Install click is the intent the Fetch click exists to
    // capture. The consent sheet below is still the only thing that can
    // authorize setup or launch.
    else if (initialRepo && autoFetch) void fetchSource({ kind: 'git', repo: initialRepo })
    else if (initialRepo) window.setTimeout(() => fetchButtonRef.current?.focus(), 0)
    else window.setTimeout(() => inputRef.current?.focus(), 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialRepo, initialBundlePath, autoFetch])

  async function fetchSource(source: { kind: 'git'; repo: string } | { kind: 'bundle'; bundlePath: string }) {
    const gen = genRef.current
    setError(null)
    setPhase({
      kind: 'fetching',
      label: source.kind === 'git' ? 'Fetching the repository…' : 'Opening the bundle…',
    })
    const result = await window.shelf.stageSharedTool(source)
    if (gen !== genRef.current) {
      // A newer open superseded this fetch — drop the scratch clone we just made.
      if (result.ok) void window.shelf.discardSharedTool(result.stage.stageId).catch(() => {})
      return
    }
    if (!result.ok) {
      setError(result)
      setPhase({ kind: 'source' })
      return
    }
    stageRef.current = result.stage.stageId
    setEnv(Object.fromEntries(Object.keys(result.stage.manifest.env).map((key) => [key, ''])))
    setPhase({ kind: 'consent', stage: result.stage, destination: result.stage.destination })
  }

  async function discardAndClose() {
    const stageId = stageRef.current
    stageRef.current = null
    if (stageId) {
      try {
        await window.shelf.discardSharedTool(stageId)
      } catch {
        // scratch cleanup is best-effort; app start sweeps leftovers
      }
    }
    onClose()
  }

  async function submitSource(e: FormEvent) {
    e.preventDefault()
    const value = repo.trim()
    if (!value) return
    await fetchSource({ kind: 'git', repo: value })
  }

  async function pickBundle() {
    const bundlePath = await window.shelf.pickShareBundle()
    if (!bundlePath) return
    await fetchSource({ kind: 'bundle', bundlePath })
  }

  async function changeDestination(stage: StagedShareView) {
    setError(null)
    const picked = await window.shelf.pickShareDestination(stage.stageId)
    if (!picked.ok) {
      setError(picked)
      return
    }
    if (picked.destination) setPhase({ kind: 'consent', stage, destination: picked.destination })
  }

  async function approve(stage: StagedShareView, destination: string) {
    const gen = genRef.current
    setError(null)
    setPhase({ kind: 'working', stage })
    const outcome = await window.shelf.confirmSharedTool(stage.stageId, {
      destination,
      env,
      runSetup: true,
    })
    // A second link arrived mid-approve: the add still completed (it's in the
    // library), but this sheet now belongs to the newer request — don't
    // stomp its phase or navigate away from it.
    if (gen !== genRef.current) return
    if (!outcome.ok) {
      setError(outcome)
      if (outcome.code === 'destination_invalid') {
        setPhase({ kind: 'consent', stage, destination })
      } else {
        stageRef.current = null
        setPhase({ kind: 'source' })
      }
      return
    }
    stageRef.current = null
    await refresh()
    const result = outcome.result
    const docker = result.issues.find((i) => i.code === 'docker_not_running')
    if (docker && result.tool) {
      // Same wording as the drag-drop register flow.
      window.alert(`${docker.message} Start it, then launch the tool from its page.`)
    }
    setPhase({ kind: 'done', result })
    const tool = result.tool
    if (tool) {
      onClose()
      navigate(
        result.outcome === 'saved_needs_review' ? `/tools/${tool.id}/edit` : `/tools/${tool.id}`,
      )
    }
  }

  const busy = phase.kind === 'fetching' || phase.kind === 'working'

  if (!open) return null

  return (
    <div
      className="name-prompt-backdrop consent-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) void discardAndClose()
      }}
    >
      <div
        ref={sheetRef}
        tabIndex={-1}
        className="consent-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-shared-title"
        onKeyDown={(e) => {
          if (e.key === 'Escape' && !busy) {
            e.preventDefault()
            void discardAndClose()
          }
        }}
      >
        {phase.kind === 'source' || phase.kind === 'fetching' ? (
          <form onSubmit={(e) => void submitSource(e)}>
            <h2 id="add-shared-title" className="consent-title">
              Add a shared tool
            </h2>
            <p className="consent-lede">
              {initialRepo
                ? 'This link came from outside Shelf. Fetch downloads the project into a scratch folder so you can review exactly what it does — nothing runs until you approve.'
                : 'Paste a link a coworker shared from Shelf, or a git repository URL. You’ll review exactly what it does before anything runs.'}
            </p>
            <label className="field">
              <span className="field-label">Repository URL or shelf:// link</span>
              <input
                ref={inputRef}
                className="field-input"
                value={repo}
                placeholder="https://github.com/your-team/tool.git"
                disabled={busy}
                autoComplete="off"
                spellCheck={false}
                onChange={(e) => setRepo(normalizeLinkInput(e.target.value))}
              />
            </label>
            {error ? <ShareErrorCard error={error} /> : null}
            {phase.kind === 'fetching' ? (
              <p className="field-hint" role="status">
                {phase.label}
              </p>
            ) : null}
            <div className="consent-actions">
              <button
                type="button"
                className="btn btn-quiet"
                disabled={busy}
                onClick={() => void pickBundle()}
              >
                Add from bundle (.zip)…
              </button>
              <button type="button" className="btn btn-quiet" disabled={busy} onClick={onClose}>
                Cancel
              </button>
              <button
                ref={fetchButtonRef}
                type="submit"
                className="btn btn-primary"
                disabled={busy || !repo.trim()}
              >
                {phase.kind === 'fetching' ? 'Fetching…' : 'Fetch'}
              </button>
            </div>
          </form>
        ) : null}

        {phase.kind === 'consent' || phase.kind === 'working' ? (
          <ConsentSheet
            stage={phase.stage}
            destination={phase.kind === 'consent' ? phase.destination : phase.stage.destination}
            env={env}
            busy={phase.kind === 'working'}
            error={error}
            onEnvChange={(key, value) => setEnv((prev) => ({ ...prev, [key]: value }))}
            onChangeDestination={() => void changeDestination(phase.stage)}
            onCancel={() => void discardAndClose()}
            onApprove={() =>
              void approve(
                phase.stage,
                phase.kind === 'consent' ? phase.destination : phase.stage.destination,
              )
            }
          />
        ) : null}

        {phase.kind === 'done' ? (
          <div>
            <h2 id="add-shared-title" className="consent-title">
              Added
            </h2>
            <p className="consent-lede">
              {phase.result.state?.code
                ? friendlyLaunchError(phase.result.state.code)
                : 'The tool is in your library.'}
            </p>
            <div className="consent-actions">
              <button type="button" className="btn btn-primary" onClick={onClose}>
                Done
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}

/** Accept a pasted `shelf://add?repo=…` link in the URL field. */
function normalizeLinkInput(value: string): string {
  const trimmed = value.trim()
  if (!/^shelf:\/\/add\b/i.test(trimmed)) return value
  try {
    const url = new URL(trimmed)
    return url.searchParams.get('repo') || value
  } catch {
    return value
  }
}

function ShareErrorCard({ error }: { error: ShareFailure }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="warning-card" role="alert" style={{ margin: '0.75rem 0 0' }}>
      <strong>{error.message}</strong>
      {error.remedy ? (
        <p style={{ margin: '0.4rem 0 0', fontSize: '0.88rem' }}>{error.remedy}</p>
      ) : null}
      {error.remedyCommand ? (
        <div className="action-row" style={{ margin: '0.6rem 0 0', alignItems: 'center' }}>
          <code style={{ fontSize: '0.82em' }}>{error.remedyCommand}</code>
          <button
            type="button"
            className="btn btn-quiet btn-sm"
            onClick={() => {
              void navigator.clipboard.writeText(error.remedyCommand!).then(() => {
                setCopied(true)
                window.setTimeout(() => setCopied(false), 2400)
              })
            }}
          >
            {copied ? 'Copied' : 'Copy command'}
          </button>
        </div>
      ) : null}
    </div>
  )
}

function ConsentSheet({
  stage,
  destination,
  env,
  busy,
  error,
  onEnvChange,
  onChangeDestination,
  onCancel,
  onApprove,
}: {
  stage: StagedShareView
  destination: string
  env: Record<string, string>
  busy: boolean
  error: ShareFailure | null
  onEnvChange: (key: string, value: string) => void
  onChangeDestination: () => void
  onCancel: () => void
  onApprove: () => void
}) {
  const manifest = stage.manifest
  // PORT is governed by the tool's port (Shelf sets it at launch) — never ask.
  const envKeys = Object.keys(manifest.env).filter((key) => key !== 'PORT')
  const firstInput = useRef<HTMLInputElement>(null)
  useEffect(() => {
    window.setTimeout(() => firstInput.current?.focus(), 0)
  }, [])

  return (
    <div>
      <h2 id="add-shared-title" className="consent-title">
        Add “{manifest.name}” to your Shelf?
      </h2>
      <p className="consent-lede">
        {manifest.description || 'No description was shared.'}
        {manifest.exportedBy ? ` · Shared with ${manifest.exportedBy}` : ''}
      </p>

      <div className="consent-section">
        <div className="field-label">Source</div>
        <p className="consent-value">
          <code style={{ fontSize: '0.85em' }}>{sourceLabel(stage)}</code>
        </p>
        {stage.ref ? (
          <p className="consent-value is-muted" style={{ fontSize: '0.8rem' }}>
            commit {stage.ref.slice(0, 10)}
          </p>
        ) : null}
      </div>

      <div className="consent-section">
        <div className="consent-row">
          <div>
            <div className="field-label">Destination folder</div>
            <p className="consent-value">{destination}</p>
          </div>
          <button
            type="button"
            className="btn btn-quiet btn-sm"
            disabled={busy}
            onClick={onChangeDestination}
          >
            Change…
          </button>
        </div>
      </div>

      <div className="consent-section">
        <div className="field-label">
          {stage.setupSteps.length > 0 ? 'Will run first, from that folder' : 'Setup'}
        </div>
        {stage.setupSteps.length > 0 ? (
          stage.setupSteps.map((step, index) => (
            <code className="consent-code" key={`${index}:${step.command}`}>
              {step.command}
            </code>
          ))
        ) : (
          <p className="consent-value is-muted">Nothing to install.</p>
        )}
      </div>

      <div className="consent-section">
        <div className="field-label">Launch command</div>
        {manifest.launchCommand ? (
          <code className="consent-code">{manifest.launchCommand}</code>
        ) : (
          <p className="consent-value is-muted">
            None shared — Shelf will detect one and may ask you to confirm it.
          </p>
        )}
        {manifest.port ? (
          <p className="consent-value is-muted" style={{ fontSize: '0.82rem' }}>
            Prefers port {manifest.port}; Shelf picks a free one if it’s busy.
          </p>
        ) : null}
      </div>

      {envKeys.length > 0 ? (
        <div className="consent-section">
          <div className="field-label">Values this tool needs from you</div>
          <p className="consent-value is-muted" style={{ fontSize: '0.82rem' }}>
            Only the names were shared. What you enter stays on this Mac.
          </p>
          <div className="consent-env-list">
            {envKeys.map((key, index) => (
              <label className="field" key={key}>
                <span className="field-label">
                  <code>{key}</code>
                </span>
                <input
                  ref={index === 0 ? firstInput : undefined}
                  className="field-input"
                  type={
                    /TOKEN|SECRET|PASSWORD|PASSWD|API_KEY|ACCESS_KEY|PRIVATE_KEY/i.test(key) &&
                    !/_(PATH|FILE|DIR|URL|ID|NAME)$/i.test(key)
                      ? 'password'
                      : 'text'
                  }
                  value={env[key] || ''}
                  disabled={busy}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(e) => onEnvChange(key, e.target.value)}
                />
                {manifest.env[key] ? <span className="field-hint">{manifest.env[key]}</span> : null}
              </label>
            ))}
          </div>
        </div>
      ) : null}

      {manifest.capabilities.length > 0 || manifest.agentAccess.length > 0 ? (
        <div className="consent-section">
          <div className="field-label">For your AI agents</div>
          {manifest.capabilities.length > 0 ? (
            <p className="consent-value is-muted">
              Can: {manifest.capabilities.join(', ')}
            </p>
          ) : null}
          {manifest.agentAccess.map((access, index) => (
            <p className="consent-value is-muted" key={`${index}:${access.entrypoint}`}>
              {access.kind === 'http-api' ? 'HTTP API' : access.kind.toUpperCase()}
              {access.transport ? ` · ${access.transport}` : ''}:{' '}
              <code style={{ fontSize: '0.85em' }}>{access.entrypoint}</code>
            </p>
          ))}
        </div>
      ) : null}

      {manifest.notes ? (
        <div className="consent-section">
          <div className="field-label">Notes from the sender</div>
          <p className="consent-note">{manifest.notes}</p>
        </div>
      ) : null}

      {stage.warnings.length > 0 ? (
        <div className="consent-section">
          <div className="field-label">Shelf adjusted this manifest</div>
          <ul className="consent-list">
            {stage.warnings.map((warning, index) => (
              <li key={`${index}:${warning}`}>{warning}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {error ? <ShareErrorCard error={error} /> : null}

      <div className="consent-actions">
        <p className="consent-actions-note">Nothing runs until you approve.</p>
        <button type="button" className="btn btn-quiet" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={onApprove}>
          {busy
            ? stage.setupSteps.length > 0
              ? 'Installing and launching…'
              : 'Adding…'
            : 'Add to my Shelf'}
        </button>
      </div>
    </div>
  )
}
