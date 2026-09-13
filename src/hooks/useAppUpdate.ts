import { useEffect, useState } from 'react'
import type { AppUpdateState } from '../types'

export function useAppUpdate() {
  const [state, setState] = useState<AppUpdateState | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!window.shelf) return
    let active = true
    let eventSeen = false
    const off = window.shelf.onAppUpdateState((next) => {
      eventSeen = true
      setState(next)
    })
    void window.shelf
      .getAppUpdateState()
      .then((next) => {
        if (active && !eventSeen) setState(next)
      })
      .catch(() => {
        if (active) setError('Could not read update status.')
      })
    return () => {
      active = false
      off()
    }
  }, [])
  async function check() {
    setError(null)
    try {
      setState(await window.shelf.checkAppUpdates())
    } catch {
      setError('Could not check for updates. Try again.')
    }
  }
  async function install() {
    setError(null)
    try {
      await window.shelf.installUpdate()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }
  return { state, error, check, install }
}
