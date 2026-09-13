import type { AppUpdateState } from './contracts'

/** Preserve a downloaded update through later checks and transient feed errors. */
export function nextAppUpdateState(
  current: AppUpdateState,
  patch: Partial<AppUpdateState>,
): AppUpdateState {
  if (current.status === 'ready' && patch.status !== 'ready') return current
  return { ...current, error: undefined, percent: undefined, ...patch }
}
