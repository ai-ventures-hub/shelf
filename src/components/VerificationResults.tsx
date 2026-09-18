import { useEffect, useState } from 'react'
import { Modal } from './Modal'
import { LogPanel } from './LogPanel'
import type { LogLine } from '../types'
import {
  verificationActive,
  type VerificationRun,
} from '../../shared/verification-contracts'

function message(error: unknown) {
  return error instanceof Error
    ? error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')
    : 'Could not load verification evidence.'
}
function label(status: string) {
  return status.replaceAll('_', ' ')
}
export function VerificationResults({
  toolId,
  runs,
  selected,
  onSelect,
  busy,
  onCancel,
}: {
  toolId: string
  runs: VerificationRun[]
  selected: string
  onSelect: (id: string) => void
  busy: boolean
  onCancel: (id: string) => void
}) {
  const run = runs.find((item) => item.id === selected)
  const [chosenStep, setChosenStep] = useState('')
  const step =
    run?.steps.find((item) => item.id === chosenStep) ||
    run?.steps.find((item) => !['passed', 'pending', 'skipped'].includes(item.status)) ||
    run?.steps[0]
  const [lines, setLines] = useState<LogLine[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [preparing, setPreparing] = useState(false)
  const [preview, setPreview] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const active = run && verificationActive(run.status)
  useEffect(() => {
    setChosenStep('')
    setCopied(false)
  }, [run?.id])
  useEffect(() => {
    let disposed = false
    let inflight = false
    async function load() {
      if (!run || !step || inflight) return
      inflight = true
      try {
        const output = await window.shelf.getVerificationLogs(toolId, run.id, step.id)
        if (!disposed) {
          setLines(output)
          setError(null)
        }
      } catch (err) {
        if (!disposed) setError(message(err))
      } finally {
        inflight = false
        if (!disposed) setLoading(false)
      }
    }
    setLines([])
    setError(null)
    setLoading(true)
    if (run && step) void load()
    else setLoading(false)
    const timer = active ? window.setInterval(() => void load(), 1000) : undefined
    return () => {
      disposed = true
      if (timer) clearInterval(timer)
    }
  }, [toolId, run?.id, step?.id, step?.status, active])
  return (
    <section className="panel" aria-labelledby="verification-results-title">
      <div className="panel-header">
        <h2 className="panel-title" id="verification-results-title">
          Verification history
        </h2>
      </div>
      <div className="panel-body stack">
        {!runs.length ? (
          <p className="muted">
            No runs yet. Save commands and review them to start your first verification.
          </p>
        ) : (
          <>
            <label className="field">
              <span className="field-label">Run</span>
              <select
                className="field-input"
                value={selected}
                disabled={preparing}
                onChange={(event) => {
                  onSelect(event.target.value)
                  setChosenStep('')
                  setCopied(false)
                }}
              >
                {runs.map((item) => (
                  <option key={item.id} value={item.id}>
                    {new Date(item.startedAt).toLocaleString()} · {label(item.status)}
                  </option>
                ))}
              </select>
            </label>
            <p className="muted">
              Shelf retains the last 10 verification runs per project and up to 3,000
              output lines per step. Results describe the files present when each command
              ran.
            </p>
            {run && (
              <>
                <div className="action-row">
                  <strong role="status">Result: {label(run.status)}</strong>
                  {active && (
                    <button
                      className="btn btn-danger"
                      disabled={busy}
                      onClick={() => onCancel(run.id)}
                    >
                      {busy
                        ? 'Stopping…'
                        : run.status === 'cleanup_required'
                          ? 'Retry cleanup'
                          : 'Cancel verification'}
                    </button>
                  )}
                  {!active && run.status !== 'passed' && (
                    <button
                      className="btn btn-quiet"
                      disabled={preparing}
                      onClick={async () => {
                        setPreparing(true)
                        setError(null)
                        setCopied(false)
                        try {
                          setPreview(
                            (
                              await window.shelf.prepareVerificationHandoff(
                                toolId,
                                run.id,
                              )
                            ).markdown,
                          )
                        } catch (err) {
                          setError(message(err))
                        } finally {
                          setPreparing(false)
                        }
                      }}
                    >
                      {preparing ? 'Preparing…' : 'Prepare failure handoff'}
                    </button>
                  )}
                </div>
                {active && (
                  <p className="muted">
                    You can leave this page. Verification continues in Shelf; quitting or
                    installing an update cancels it.
                  </p>
                )}
                {run.message && <p className="warning-card">{run.message}</p>}
                {copied && (
                  <p className="notice" role="status">
                    Handoff copied. Paste it into your agent to continue.
                  </p>
                )}
                <ol className="verification-steps">
                  {run.steps.map((item) => (
                    <li key={item.id}>
                      <button
                        className="verification-step"
                        aria-pressed={item.id === step?.id}
                        onClick={() => setChosenStep(item.id)}
                      >
                        <span>{item.label}</span>
                        <span className="verification-status" data-status={item.status}>
                          {label(item.status)}
                          {item.exitCode != null ? ` · exit ${item.exitCode}` : ''}
                        </span>
                      </button>
                    </li>
                  ))}
                </ol>
                {step && (
                  <>
                    <h3>Output: {step.label}</h3>
                    <pre className="verification-code">{step.command}</pre>
                    {loading ? (
                      <p role="status">Loading output…</p>
                    ) : (
                      <LogPanel
                        lines={lines}
                        emptyMessage={
                          step.status === 'skipped' || step.status === 'pending'
                            ? 'This step has not run.'
                            : step.status === 'running'
                              ? 'Waiting for output…'
                              : 'This step has no retained output.'
                        }
                      />
                    )}
                  </>
                )}
              </>
            )}
          </>
        )}
        {error && (
          <p className="warning-card" role="alert">
            {error}
          </p>
        )}
      </div>
      <Modal
        className="name-prompt-backdrop consent-backdrop"
        open={preview !== null}
        onDismiss={() => setPreview(null)}
        aria-labelledby="verification-handoff-title"
      >
        <div className="consent-sheet context-handoff">
          <h2 id="verification-handoff-title" className="consent-title">
            Review failure handoff
          </h2>
          <p className="consent-lede">
            Includes saved project memory and selected verification evidence. Known
            credentials are masked. Review and edit before sharing.
          </p>
          <textarea
            className="field-input"
            aria-label="Verification handoff"
            rows={16}
            value={preview || ''}
            onChange={(event) => setPreview(event.target.value)}
          />
          {error && (
            <p className="warning-card" role="alert">
              {error}
            </p>
          )}
          <div className="consent-actions">
            <button className="btn btn-quiet" onClick={() => setPreview(null)}>
              Back
            </button>
            <button
              className="btn btn-primary"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(preview || '')
                  setCopied(true)
                  setPreview(null)
                } catch {
                  setError('Copy failed. Select and copy the text above.')
                }
              }}
            >
              Copy handoff
            </button>
          </div>
        </div>
      </Modal>
    </section>
  )
}
