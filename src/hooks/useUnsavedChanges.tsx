import { useEffect, useRef } from 'react'
import { useBlocker } from 'react-router-dom'
import { Modal } from '../components/Modal'

export function useUnsavedChanges(dirty: boolean, busy = false) {
  const saved = useRef(false)
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      !saved.current &&
      (dirty || busy) &&
      (currentLocation.pathname !== nextLocation.pathname ||
        currentLocation.search !== nextLocation.search ||
        currentLocation.state !== nextLocation.state),
  )
  useEffect(() => {
    if (!dirty && !busy && blocker.state === 'blocked') blocker.reset()
  }, [dirty, busy, blocker])
  useEffect(() => {
    const beforeUnload = (event: Event) => {
      if (!saved.current && (dirty || busy)) {
        event.preventDefault()
        if (event.type === 'beforeunload') (event as BeforeUnloadEvent).returnValue = ''
      }
    }
    window.addEventListener('beforeunload', beforeUnload)
    window.addEventListener('shelf:before-quit', beforeUnload)
    return () => {
      window.removeEventListener('beforeunload', beforeUnload)
      window.removeEventListener('shelf:before-quit', beforeUnload)
    }
  }, [dirty, busy])
  return {
    allowNavigation: () => {
      saved.current = true
    },
    prompt: (
      <Modal
        open={blocker.state === 'blocked'}
        busy={busy}
        onDismiss={() => blocker.reset?.()}
        aria-labelledby="unsaved-title"
      >
        <div className="name-prompt">
          <h2 id="unsaved-title">{busy ? 'Operation in progress' : 'Discard unsaved changes?'}</h2>
          <p>
            {busy
              ? 'Wait for this operation to finish before leaving.'
              : 'Your changes have not been saved.'}
          </p>
          <div className="name-prompt-actions">
            <button className="btn" onClick={() => blocker.reset?.()}>
              Stay here
            </button>
            {!busy && (
              <button className="btn btn-danger" onClick={() => blocker.proceed?.()}>
                Discard changes
              </button>
            )}
          </div>
        </div>
      </Modal>
    ),
  }
}
