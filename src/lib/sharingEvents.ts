/**
 * Renderer-local bus for "open the Add shared tool sheet". The Library page
 * buttons and the shelf://add deep link (via window.shelf.onAddShared) both
 * end up here; the dialog itself is hosted once in StudioShell.
 */
export const ADD_SHARED_EVENT = 'shelf:add-shared'

export interface AddSharedRequest {
  resumeStageId?: string
  repo?: string
  bundlePath?: string
  /**
   * Skip the explicit Fetch click and clone straight into the consent sheet.
   * Only for sources the user already vouched for — a Team Tools entry from a
   * catalog they subscribed to. A shelf:// link from chat never sets this.
   */
  autoFetch?: boolean
}

export function requestAddShared(detail: AddSharedRequest = {}): void {
  window.dispatchEvent(new CustomEvent<AddSharedRequest>(ADD_SHARED_EVENT, { detail }))
}

export function onAddSharedRequest(cb: (detail: AddSharedRequest) => void): () => void {
  const listener = (event: Event) => cb((event as CustomEvent<AddSharedRequest>).detail || {})
  window.addEventListener(ADD_SHARED_EVENT, listener)
  return () => window.removeEventListener(ADD_SHARED_EVENT, listener)
}
