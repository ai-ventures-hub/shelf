import { useAppUpdate } from '../hooks/useAppUpdate'
import { useEffect, useState } from 'react'

/**
 * Restart prompt for a downloaded update. The update arrived silently in the
 * background (electron-updater); this only asks for the restart. Dismissing
 * is safe — the update still installs on the next natural quit.
 */
export function UpdateBanner() {
  const { state, error, install } = useAppUpdate()
  const version = state?.status === 'ready' ? state.version : null
  const [dismissed, setDismissed] = useState(false)
  const [installing, setInstalling] = useState(false)

  useEffect(() => { setDismissed(false) }, [version])

  if (!version || dismissed) return null

  return (
    <div className="update-banner" role="status">
      <span className="update-banner-text">
        Shelf {version} is ready — restart to update.
      </span>
      {error && <span role="alert">{error}</span>}
      <button
        type="button"
        className="update-banner-restart"
        disabled={installing}
        onClick={() => {
          setInstalling(true)
          void install().finally(() => setInstalling(false))
        }}
      >
        {installing ? 'Restarting…' : 'Restart'}
      </button>
      <button
        type="button"
        className="update-banner-dismiss"
        aria-label="Dismiss — installs on next quit"
        title="Installs on next quit"
        onClick={() => setDismissed(true)}
      >
        ✕
      </button>
    </div>
  )
}
