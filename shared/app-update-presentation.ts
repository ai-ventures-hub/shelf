import type { AppUpdateState } from './contracts'

export function updateNotice(state: AppUpdateState | null, dismissedVersion: string | null, error: string | null): string | null {
  if (error) return 'Update failed'
  switch (state?.status) {
    case 'checking': return 'Checking for updates…'
    case 'downloading': return state.percent === undefined ? 'Downloading update…' : `Downloading · ${Math.max(0, Math.min(100, Math.round(state.percent)))}%`
    case 'ready': return state.version === dismissedVersion ? null : 'Update available'
    case 'error': return 'Update failed'
    default: return null
  }
}

export function updateDescription(state: AppUpdateState | null): string {
  if (!state) return 'Loading update status…'
  switch (state.status) {
    case 'unsupported': return 'Update checks are available in the installed app.'
    case 'checking': return 'Checking for updates…'
    case 'downloading': return `Downloading Shelf ${state.version || 'update'}${state.percent === undefined ? '…' : ` · ${Math.round(state.percent)}%`}`
    case 'ready': return `Shelf ${state.version} is ready to install.`
    case 'error': return state.error || 'Update failed. Please try again.'
    default: return state.checkedAt ? 'You’re up to date.' : 'Automatic updates are enabled.'
  }
}
