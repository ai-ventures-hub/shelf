import { useUnsavedChanges } from '../hooks/useUnsavedChanges'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Modal } from './Modal'
import type { Tool, ToolEnvironment } from '../types'

export function ToolEnvironmentPanel({ tool }: { tool: Tool }) {
  const generation = useRef(0)
  useEffect(() => () => { generation.current++ }, [])
  const [result, setResult] = useState<ToolEnvironment | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [consent, setConsent] = useState(false)
  const [settingUp, setSettingUp] = useState(false)
  const guard = useUnsavedChanges(false, settingUp)
  const [notice, setNotice] = useState<string | null>(null)
  const inspect = useCallback(async () => {
    const ticket = ++generation.current
    setBusy(true)
    setError(null)
    try {
      const next = await window.shelf.inspectToolEnvironment(tool.id)
      if (ticket === generation.current) setResult(next)
    } catch (err) {
      if (ticket === generation.current) setError(err instanceof Error ? err.message : String(err))
    } finally {
      if (ticket === generation.current) setBusy(false)
    }
  }, [tool.id])
  useEffect(() => {
    void inspect()
  }, [inspect, tool.updatedAt])
  async function setup() {
    if (!result || !tool.projectPath) return
    setSettingUp(true)
    setError(null)
    setNotice(null)
    try {
      const saved = await window.shelf.registerProject(tool.projectPath, {
        autoLaunch: false,
        runSetup: true,
        setupSteps: result.setupSteps,
      })
      if (saved.bootstrap?.some((step) => !step.result.ok))
        throw new Error(
          'Setup failed. Review the latest logs below, fix the reported problem, and retry.',
        )
      if (saved.outcome !== 'saved')
        throw new Error(
          saved.issues[0]?.message ||
            'Setup needs further configuration. Review your launch command.',
        )
      setConsent(false)
      setNotice('Setup finished. You can now try launching the tool.')
      await inspect()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSettingUp(false)
    }
  }
  return (
    <section className="panel" aria-labelledby="environment-title">
      <div className="panel-header">
        <h2 id="environment-title" className="panel-title">
          Environment
        </h2>
        <button
          className="btn btn-quiet btn-sm"
          disabled={busy || settingUp}
          onClick={() => void inspect()}
        >
          {busy ? 'Checking…' : 'Check again'}
        </button>
      </div>
      <div className="panel-body stack">
        <p className="muted">
          Read-only checks of local setup. A successful check does not prove API access or that the
          app will start.
        </p>
        {error && (
          <p role="alert" className="form-error">
            {error}
          </p>
        )}
        {notice && <p role="status">{notice}</p>}
        {result?.checks.map((check) => (
          <div key={check.label + check.detail}>
            <strong>
              {check.label} ·{' '}
              {check.status === 'ready'
                ? 'Found'
                : check.status === 'missing'
                  ? 'Needs attention'
                  : 'Check needed'}
            </strong>
            <p>{check.detail}</p>
          </div>
        ))}
        {result && (
          <p className="muted">Checked {new Date(result.checkedAt).toLocaleTimeString()}</p>
        )}
        {Boolean(result?.setupSteps.length) && (
          <button className="btn" disabled={busy || settingUp} onClick={() => setConsent(true)}>
            Review setup commands
          </button>
        )}
        <Link to={`/tools/${tool.id}/edit`}>Edit configuration</Link>
      </div>
      {guard.prompt}
      <Modal
        open={consent}
        busy={settingUp}
        onDismiss={() => setConsent(false)}
        aria-labelledby="setup-title"
      >
        <div className="name-prompt">
          <h2 id="setup-title">Run project setup?</h2>
          <p>
            These commands run in {tool.projectPath}. They may download packages and execute
            installation scripts.
          </p>
          {result?.setupSteps.map((step, i) => (
            <pre key={i} style={{ whiteSpace: 'pre-wrap' }}>
              {step.command}
            </pre>
          ))}
          {error && <p role="alert">{error}</p>}
          <div className="name-prompt-actions">
            <button className="btn" disabled={settingUp} onClick={() => setConsent(false)}>
              Cancel
            </button>
            <button className="btn btn-primary" disabled={settingUp} onClick={() => void setup()}>
              {settingUp ? 'Installing…' : 'Run these commands'}
            </button>
          </div>
        </div>
      </Modal>
    </section>
  )
}
