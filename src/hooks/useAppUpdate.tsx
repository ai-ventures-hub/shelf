import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { AppUpdateState } from '../types'

const DISMISSED_KEY = 'shelf.dismissedUpdate'
function readDismissed(): string | null {
  try { return sessionStorage.getItem(DISMISSED_KEY) } catch { return null }
}
const UpdateContext = createContext<{
  state: AppUpdateState | null
  error: string | null
  checking: boolean
  installing: boolean
  dismissedVersion: string | null
  dismiss: () => void
  check: () => Promise<void>
  install: () => Promise<void>
} | null>(null)

/** One subscription and action owner for every update entry point. */
export function AppUpdateProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppUpdateState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  const [installing, setInstalling] = useState(false)
  const [dismissedVersion, setDismissedVersion] = useState(readDismissed)
  const checkPending = useRef(false)
  const installPending = useRef(false)
  const eventRevision = useRef(0)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    if (!window.shelf) return
    const revision = eventRevision.current
    const off = window.shelf.onAppUpdateState((next) => {
      eventRevision.current++
      setState(next)
      setError(null)
    })
    void window.shelf.getAppUpdateState().then((next) => {
      if (alive.current && revision === eventRevision.current) setState(next)
    }).catch(() => {
      if (alive.current) setError('Could not read update status. Try checking again.')
    })
    return () => { alive.current = false; off() }
  }, [])
  async function check() {
    if (checkPending.current || installing || state?.status === 'ready' || state?.status === 'downloading') return
    checkPending.current = true
    setChecking(true)
    setError(null)
    const revision = eventRevision.current
    try {
      const next = await window.shelf.checkAppUpdates()
      if (alive.current && revision === eventRevision.current) setState(next)
    } catch {
      if (alive.current) setError('Could not check for updates. Try again.')
    } finally {
      checkPending.current = false
      if (alive.current) setChecking(false)
    }
  }
  async function install() {
    if (installPending.current || state?.status !== 'ready') return
    installPending.current = true
    setInstalling(true)
    setError(null)
    try { await window.shelf.installUpdate() }
    catch (err) {
      if (alive.current) setError((err instanceof Error ? err.message : String(err)).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, ''))
    }
    finally { installPending.current = false; if (alive.current) setInstalling(false) }
  }
  function dismiss() {
    if (state?.status !== 'ready' || !state.version) return
    setDismissedVersion(state.version)
    try { sessionStorage.setItem(DISMISSED_KEY, state.version) } catch { /* Session state still works in memory. */ }
  }
  return <UpdateContext.Provider value={{ state, error, checking, installing, dismissedVersion, dismiss, check, install }}>{children}</UpdateContext.Provider>
}

export function useAppUpdate() {
  const value = useContext(UpdateContext)
  if (!value) throw new Error('useAppUpdate requires AppUpdateProvider')
  return value
}
