import { updateDescription } from '../../shared/app-update-presentation'
import { useAppUpdate } from '../hooks/useAppUpdate'
import { useRef } from 'react'

export function AppUpdateDetails() {
  const { state, error, checking, installing, check, install } = useAppUpdate()
  const restartButton = useRef<HTMLButtonElement>(null)
  return <>
    <div className="update-copy">
      <strong>Shelf{state ? ` ${state.currentVersion}` : ''}</strong>
      <p role="status">{updateDescription(state)}</p>
      {state?.checkedAt && <p className="field-hint">Last checked {new Date(state.checkedAt).toLocaleString()}.</p>}
      {state?.status === 'downloading' && <progress aria-label="Update download" max={100} value={state.percent} />}
      {state?.status === 'ready' && <p className="field-hint">Restart now, or install on your next quit.</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
    </div>
    {state?.status === 'ready' ? (
      <button ref={restartButton} className="btn btn-primary" disabled={installing} onClick={() => void install().finally(() => requestAnimationFrame(() => restartButton.current?.focus()))}>{installing ? 'Restarting…' : 'Restart and update'}</button>
    ) : (
      <button className="btn" disabled={checking || installing || state?.status === 'unsupported' || state?.status === 'checking' || state?.status === 'downloading'} onClick={() => void check()}>
        {checking || state?.status === 'checking' ? 'Checking…' : error || state?.status === 'error' ? 'Retry update check' : 'Check for updates'}
      </button>
    )}
  </>
}

export function AppUpdatePanel() {
  return <section className="panel" aria-label="Shelf updates"><div className="panel-body update-row"><AppUpdateDetails /></div></section>
}
