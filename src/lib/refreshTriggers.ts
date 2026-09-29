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
