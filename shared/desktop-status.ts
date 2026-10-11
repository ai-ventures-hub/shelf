/**
 * What the Dock and Notification Center say about running tools. Pure so the
 * smoke suite can pin the rules without Electron.
 */
import type { ToolRuntimeState, ToolStatus } from './contracts'

export interface DesktopNotice {
  title: string
  body: string
}

/**
 * A notification for a tool that failed while the user may not be looking.
 * A running tool that falls into error always counts (it crashed or its
 * service died). A failed launch only counts when the window isn't focused,
 * since the launch screen already shows it otherwise. Stops, including
 * failed stops, never notify: the user asked for those.
 */
export function toolFailureNotice(
  previous: ToolStatus | undefined,
  next: ToolRuntimeState,
  toolName: string,
  windowFocused: boolean,
): DesktopNotice | null {
  if (next.status !== 'error') return null
  if (previous === 'running') {
    return { title: `${toolName} stopped unexpectedly`, body: next.message || 'Its process exited.' }
  }
  if (previous === 'starting' && !windowFocused) {
    return { title: `${toolName} couldn’t start`, body: next.message || 'Open Shelf to see what went wrong.' }
  }
  return null
}

/** Dock badge text: the running-tool count, or empty to clear it. */
export function dockBadgeText(states: ToolRuntimeState[]): string {
  const running = states.filter((state) => state.status === 'running').length
  return running > 0 ? String(running) : ''
}
