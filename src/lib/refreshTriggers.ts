/**
 * Push-based refresh for renderer data: re-read when the main process reports
 * that one of `files` changed on disk (data:external-change), when the window
 * regains focus, or when it becomes visible again. Changes reported while the
 * window is hidden are held and read once it is visible, so a hidden window
 * makes no IPC calls. Returns an unsubscribe function.
 */
export function subscribeDataRefresh(
  files: readonly string[],
  refresh: () => void,
  { focus = true }: { focus?: boolean } = {},
): () => void {
  let stale = false
  const trigger = () => {
    if (document.visibilityState === 'hidden') {
      stale = true
      return
    }
    stale = false
    refresh()
  }
  const offFile = window.shelf?.onExternalDataChange
    ? window.shelf.onExternalDataChange((filename) => {
        if (files.includes(filename)) trigger()
      })
    : () => {}
  const onVisibility = () => {
    if (document.visibilityState === 'visible' && stale) trigger()
  }
  document.addEventListener('visibilitychange', onVisibility)
  if (focus) window.addEventListener('focus', trigger)
  return () => {
    offFile()
    document.removeEventListener('visibilitychange', onVisibility)
    if (focus) window.removeEventListener('focus', trigger)
  }
}

/**
 * setInterval that runs only while the window is visible. Hidden or
 * minimized windows make no calls; on becoming visible it catches up with
 * one immediate tick, then resumes the interval. Returns a stop function.
 */
export function visibleInterval(tick: () => void, ms: number): () => void {
  let timer: number | undefined
  const start = () => {
    if (timer === undefined) timer = window.setInterval(tick, ms)
  }
  const pause = () => {
    if (timer !== undefined) window.clearInterval(timer)
    timer = undefined
  }
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') return pause()
    if (timer === undefined) {
      tick()
      start()
    }
  }
  if (document.visibilityState !== 'hidden') start()
  document.addEventListener('visibilitychange', onVisibility)
  return () => {
    pause()
    document.removeEventListener('visibilitychange', onVisibility)
  }
}
