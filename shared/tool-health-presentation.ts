import type { ToolHealth } from './contracts'

/** Keep the badge short; the popover retains every blocker, in priority order. */
export function healthWarning(health: ToolHealth) {
  const first = health.problems[0] || 'Open this tool to review its launch configuration.'
  const port = /^Port (\d+) is in use by another process\.?$/.exec(first)
  if (port) return { label: 'Port busy', heading: `Port ${port[1]} is busy` }
  if (first.startsWith('Project folder is missing')) return { label: 'Folder missing', heading: 'Project folder is missing' }
  if (first === 'No launch command is set.') return { label: 'Setup needed', heading: 'Launch command is missing' }
  return { label: 'Needs attention', heading: 'Launch needs attention' }
}
