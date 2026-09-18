import { useAppUpdate } from '../hooks/useAppUpdate'

export function AppUpdatePanel() {
  const { state, error, check, install } = useAppUpdate()
  return (
    <section className="panel">
      <div className="panel-header">
        <h2 className="panel-title">Shelf updates{state ? ` · ${state.currentVersion}` : ''}</h2>
      </div>
      <div className="panel-body stack">
        <p role="status">
          {!state
            ? 'Loading update status…'
            : state.status === 'unsupported'
              ? 'Development build. Update checks are available in the installed app.'
              : state.status === 'checking'
                ? 'Checking for updates…'
                : state.status === 'downloading'
                  ? `Downloading ${state.version || 'update'}${state.percent === undefined ? '…' : ` · ${state.percent}%`}`
                  : state.status === 'ready'
                    ? `Shelf ${state.version} is ready to install.`
                    : state.status === 'error'
                      ? state.error
                      : state.checkedAt
                        ? `Up to date. Last checked ${new Date(state.checkedAt).toLocaleString()}.`
                        : 'Automatic updates are enabled.'}
        </p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {state?.status === 'ready' ? (
          <button className="btn btn-primary" onClick={() => void install()}>
            Restart and update
          </button>
        ) : (
          <button
            className="btn"
            disabled={Boolean(
              state && ['unsupported', 'checking', 'downloading'].includes(state.status),
            )}
            onClick={() => void check()}
          >
            Check for updates
          </button>
        )}
      </div>
    </section>
  )
}
