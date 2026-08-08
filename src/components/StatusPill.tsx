import type { ToolStatus } from '../types'

const TONE: Record<ToolStatus, 'success' | 'warning' | 'danger' | 'neutral'> = {
  running: 'success',
  starting: 'warning',
  error: 'danger',
  stopped: 'neutral',
}

const LABEL: Record<ToolStatus, string> = {
  running: 'Running',
  starting: 'Starting',
  error: 'Error',
  stopped: 'Stopped',
}

export function StatusPill({
  status,
  message,
}: {
  status: ToolStatus
  message?: string
}) {
  return (
    <span
      className="status-pill"
      data-tone={TONE[status]}
      data-status={status}
      title={message || LABEL[status]}
    >
      {LABEL[status]}
    </span>
  )
}
