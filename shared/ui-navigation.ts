export function toolSections(id: string, runId = '') {
  const root = `/tools/${encodeURIComponent(id)}`
  const run = runId ? `?run=${encodeURIComponent(runId)}` : ''
  return [
    { label: 'Overview', path: root, to: root },
    { label: 'Runs', path: `${root}/runs`, to: `${root}/runs${run}` },
    { label: 'Verify', path: `${root}/verify`, to: `${root}/verify` },
    { label: 'Memory & handoff', path: `${root}/context`, to: `${root}/context${run}` },
  ]
}

export const SETTINGS_SECTIONS = [
  { id: 'general', label: 'General' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'shortcuts', label: 'Shortcuts' },
  { id: 'updates', label: 'Updates & About' },
  { id: 'advanced', label: 'Advanced' },
] as const

export function settingsSection(value: string | null, developer: boolean) {
  return SETTINGS_SECTIONS.some((item) => item.id === value && (developer || item.id !== 'advanced')) ? value! : 'general'
}
