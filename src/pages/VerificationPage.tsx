import { ToolPageHeader } from '../components/ToolPageHeader'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Modal } from '../components/Modal'
import { VerificationResults } from '../components/VerificationResults'
import { useLibrary } from '../hooks/useLibrary'
import { useUnsavedChanges } from '../hooks/useUnsavedChanges'
import {
  verificationActive,
  type VerificationState,
  type VerificationStep,
} from '../../shared/verification-contracts'

function verificationError(error: unknown) {
  return error instanceof Error
    ? error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')
    : 'Verification could not complete. Try again.'
}
const newStep = (): VerificationStep => ({
  id: crypto.randomUUID(),
  label: '',
  command: '',
  timeoutSeconds: 600,
})
export function VerificationPage() {
  const { id } = useParams()
  return <VerificationEditor key={id} id={id || ''} />
}
function VerificationEditor({ id }: { id: string }) {
  const { tools, loading } = useLibrary()
  const tool = tools.find((item) => item.id === id)
  const [state, setState] = useState<VerificationState | null>(null)
  const [steps, setSteps] = useState<VerificationStep[]>([])
  const [savedSteps, setSavedSteps] = useState<VerificationStep[]>([])
  const [revision, setRevision] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [reload, setReload] = useState(false)
  const [review, setReview] = useState<{
    steps: VerificationStep[]
    workflowRevision: string
    toolRevision: string
    projectPath: string
    envKeys: string[]
  } | null>(null)
  const [selected, setSelected] = useState('')
  const resultsRef = useRef<HTMLDivElement>(null)
  const alive = useRef(true)
  const request = useRef(0)
  const initialized = useRef(false)
  const dirty = JSON.stringify(steps) !== JSON.stringify(savedSteps)
  const active = state?.runs.find((run) => verificationActive(run.status))
  const guard = useUnsavedChanges(dirty, busy)
  const refresh = useCallback(
    async (loadDraft = false) => {
      const ticket = ++request.current
      try {
        const value = await window.shelf.getVerification(id)
        if (!alive.current || ticket !== request.current) return
        setState(value)
        if (loadDraft) setError(null)
        if (loadDraft || !initialized.current) {
          setSteps(value.workflow?.steps || [])
          setSavedSteps(value.workflow?.steps || [])
          setRevision(value.workflow?.revision || null)
          initialized.current = true
        }
        setSelected((current) =>
          value.runs.some((run) => run.id === current)
            ? current
            : value.runs[0]?.id || '',
        )
      } catch (err) {
        if (alive.current && ticket === request.current) setError(verificationError(err))
      }
    },
    [id],
  )
  useEffect(() => {
    alive.current = true
    void refresh()
    const off = window.shelf.onVerificationUpdate((toolId) => {
      if (id === toolId) void refresh()
    })
    return () => {
      alive.current = false
      request.current++
      off()
    }
  }, [id, refresh])
  // Events refresh step transitions; polling also catches recovery and a missed event.
  useEffect(() => {
    if (!active) return
    const timer = window.setInterval(() => void refresh(), 1000)
    return () => clearInterval(timer)
  }, [active?.id, refresh])
  async function perform(action: () => Promise<void>) {
    if (busy) return
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await action()
    } catch (err) {
      if (alive.current) setError(verificationError(err))
    } finally {
      if (alive.current) setBusy(false)
    }
  }
  function change(index: number, patch: Partial<VerificationStep>) {
    setSteps((current) =>
      current.map((step, i) => (i === index ? { ...step, ...patch } : step)),
    )
    setNotice(null)
  }
  function move(index: number, offset: number) {
    setSteps((current) => {
      const next = [...current]
      ;[next[index], next[index + offset]] = [next[index + offset], next[index]]
      return next
    })
  }
  if (loading) return <p role="status">Loading project…</p>
  if (!tool)
    return (
      <p role="alert">
        This tool is no longer in the library. <Link to="/">Back to library</Link>
      </p>
    )
  const stale = state?.workflow?.revision !== (revision || undefined)
  const invalid =
    !steps.length ||
    steps.some(
      (step) =>
        !step.label.trim() ||
        !step.command.trim() ||
        !Number.isInteger(step.timeoutSeconds) ||
        step.timeoutSeconds < 1 ||
        step.timeoutSeconds > 3600,
    )
  return (
    <>
      <ToolPageHeader id={id} name={tool.name} description="Review and run this project's checks.">
          <button
            className="btn btn-primary"
            disabled={
              busy ||
              dirty ||
              !state?.workflow ||
              !tool.projectPath ||
              Boolean(active) ||
              stale
            }
            onClick={() =>
              setReview({
                steps: savedSteps,
                workflowRevision: revision!,
                toolRevision: tool.updatedAt,
                projectPath: tool.projectPath!,
                envKeys: Object.keys(tool.env || {}),
              })
            }
          >
            Review &amp; run{state?.runs.length ? ' again' : ''}
          </button>
      </ToolPageHeader>
      {error && (
        <p className="warning-card" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {!tool.projectPath && (
        <p className="warning-card">
          Set a <Link to={`/tools/${id}/edit`}>project folder</Link> before running
          checks.
        </p>
      )}
      <section className="panel" aria-labelledby="verification-commands-title">
        <div className="panel-header">
          <h2 className="panel-title" id="verification-commands-title">
            Verification commands
          </h2>
          <button
            className="btn btn-quiet btn-sm"
            disabled={busy}
            onClick={() => {
              if (dirty) setReload(true)
              else void refresh(true)
            }}
          >
            Load saved version
          </button>
        </div>
        <div className="panel-body stack">
          <p className="muted">
            Commands run in your project folder with its configured environment. Use
            checks that finish on their own. Change watch-mode test commands to run once.
            Commands can modify files; keep credentials in environment settings.
          </p>
          {stale && (
            <p className="warning-card">
              Saved commands changed. Your draft is preserved. Load the saved version
              before saving or running.
            </p>
          )}
          <fieldset
            className="context-fields"
            disabled={busy || !state || Boolean(active)}
          >
            {steps.length === 0 && (
              <p className="muted">
                No checks saved yet. Find scripts in package.json, or add a command for
                any project type.
              </p>
            )}
            {steps.map((step, index) => (
              <div className="verification-command" key={step.id}>
                <div className="verification-command-heading">
                  <h3>Step {index + 1}</h3>
                  <div className="action-row">
                    <button
                      className="btn btn-quiet btn-sm"
                      aria-label={`Move step ${index + 1} up`}
                      disabled={index === 0}
                      onClick={() => move(index, -1)}
                    >
                      Up
                    </button>
                    <button
                      className="btn btn-quiet btn-sm"
                      aria-label={`Move step ${index + 1} down`}
                      disabled={index === steps.length - 1}
                      onClick={() => move(index, 1)}
                    >
                      Down
                    </button>
                    <button
                      className="btn btn-quiet btn-sm"
                      aria-label={`Remove step ${index + 1}`}
                      onClick={() =>
                        setSteps((current) =>
                          current.filter((item) => item.id !== step.id),
                        )
                      }
                    >
                      Remove
                    </button>
                  </div>
                </div>
                <div className="verification-command-fields">
                  <label className="field">
                    <span className="field-label">Step {index + 1} name</span>
                    <input
                      className="field-input"
                      value={step.label}
                      maxLength={120}
                      placeholder="Typecheck"
                      onChange={(event) => change(index, { label: event.target.value })}
                    />
                  </label>
                  <label className="field">
                    <span className="field-label">Timeout in seconds</span>
                    <input
                      className="field-input"
                      type="number"
                      min={1}
                      max={3600}
                      value={Number.isNaN(step.timeoutSeconds) ? '' : step.timeoutSeconds}
                      onChange={(event) =>
                        change(index, { timeoutSeconds: event.target.valueAsNumber })
                      }
                    />
                  </label>
                </div>
                <label className="field">
                  <span className="field-label">Step {index + 1} command</span>
                  <textarea
                    className="field-input verification-code"
                    rows={2}
                    value={step.command}
                    maxLength={4000}
                    spellCheck={false}
                    placeholder="npm run typecheck"
                    onChange={(event) => change(index, { command: event.target.value })}
                  />
                </label>
              </div>
            ))}
            <div className="action-row">
              <button
                className="btn btn-quiet"
                disabled={steps.length >= 10}
                onClick={() => setSteps((current) => [...current, newStep()])}
              >
                Add command
              </button>
              <button
                className="btn btn-quiet"
                disabled={!tool.projectPath || steps.length >= 10}
                onClick={() =>
                  void perform(async () => {
                    const found = await window.shelf.suggestVerification(id)
                    if (!alive.current) return
                    const additions = found
                      .filter(
                        (item) => !steps.some((step) => step.command === item.command),
                      )
                      .slice(0, 10 - steps.length)
                    setSteps((current) => [...current, ...additions])
                    setNotice(
                      additions.length
                        ? 'Scripts added to your draft. Review commands and timeouts before saving.'
                        : 'No additional typecheck, lint, test, or build scripts found. Add a command manually.',
                    )
                  })
                }
              >
                Find package scripts
              </button>
            </div>
          </fieldset>
          <div className="action-row">
            <button
              className="btn btn-primary"
              disabled={busy || !state || !dirty || invalid || Boolean(active) || stale}
              onClick={() =>
                void perform(async () => {
                  const workflow = await window.shelf.saveVerification({
                    toolId: id,
                    expectedRevision: revision,
                    steps,
                  })
                  if (!alive.current) return
                  setSteps(workflow.steps)
                  setSavedSteps(workflow.steps)
                  setRevision(workflow.revision)
                  setNotice('Verification commands saved.')
                  await refresh()
                })
              }
            >
              Save commands
            </button>
            {dirty && (
              <span className="muted" role="status">
                Unsaved changes
              </span>
            )}
          </div>
        </div>
      </section>
      <div ref={resultsRef} tabIndex={-1}>
        {state && (
          <VerificationResults
            toolId={id}
            runs={state.runs}
            selected={selected}
            onSelect={setSelected}
            busy={busy}
            onCancel={(runId) =>
              void perform(async () => {
                await window.shelf.cancelVerification(id, runId)
                await refresh()
              })
            }
          />
        )}
      </div>
      <Modal
        className="name-prompt-backdrop consent-backdrop"
        open={review !== null}
        busy={busy}
        onDismiss={() => setReview(null)}
        aria-labelledby="verification-review-title"
      >
        <div className="consent-sheet verification-review">
          <h2 id="verification-review-title" className="consent-title">
            Review verification commands
          </h2>
          <p className="consent-lede">
            Shelf will run every step below, in order, using the current files in this
            folder. The first failure or timeout stops the run. Running again starts from
            step 1.
          </p>
          <p className="verification-code">{review?.projectPath}</p>
          <p className="muted">
            Configured environment keys: {review?.envKeys.join(', ') || 'None'}. Commands
            also inherit Shelf’s shell environment.
          </p>
          <ol className="verification-review-steps">
            {review?.steps.map((step) => (
              <li key={step.id}>
                <strong>{step.label}</strong>{' '}
                <span className="muted">· {step.timeoutSeconds}s timeout</span>
                <pre>{step.command}</pre>
              </li>
            ))}
          </ol>
          {error && (
            <p className="warning-card" role="alert">
              {error}
            </p>
          )}
          <div className="consent-actions">
            <button
              className="btn btn-quiet"
              disabled={busy}
              onClick={() => setReview(null)}
            >
              Back
            </button>
            <button
              className="btn btn-primary"
              disabled={busy}
              onClick={() =>
                void perform(async () => {
                  if (!review) return
                  const run = await window.shelf.startVerification({
                    toolId: id,
                    workflowRevision: review.workflowRevision,
                    toolRevision: review.toolRevision,
                  })
                  if (!alive.current) return
                  setSelected(run.id)
                  setReview(null)
                  await refresh()
                  requestAnimationFrame(() => {
                    resultsRef.current?.scrollIntoView({ block: 'start' })
                    resultsRef.current?.focus({ preventScroll: true })
                  })
                })
              }
            >
              {busy ? 'Starting…' : 'Run verification'}
            </button>
          </div>
        </div>
      </Modal>
      <Modal
        open={reload}
        onDismiss={() => setReload(false)}
        aria-labelledby="verification-reload-title"
      >
        <div className="name-prompt">
          <h2 id="verification-reload-title">Discard draft commands?</h2>
          <p>Load the version currently saved in Shelf.</p>
          <div className="name-prompt-actions">
            <button className="btn" onClick={() => setReload(false)}>
              Keep draft
            </button>
            <button
              className="btn btn-danger"
              onClick={() => {
                setReload(false)
                void refresh(true)
              }}
            >
              Load saved version
            </button>
          </div>
        </div>
      </Modal>
      {guard.prompt}
    </>
  )
}
