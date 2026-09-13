/** Browser-safe fields shared by the memory editor and agent handoffs. */
export const PROJECT_MEMORY_FIELDS = [
  {
    key: 'purpose',
    label: 'Purpose',
    hint: 'What is this project for, and who uses it?',
  },
  {
    key: 'conventions',
    label: 'Conventions',
    hint: 'Architecture, coding rules, and commands worth remembering.',
  },
  {
    key: 'decisions',
    label: 'Decisions',
    hint: 'What was decided and why? Add dates when useful.',
  },
  {
    key: 'knownIssues',
    label: 'Known issues',
    hint: 'Unresolved problems and anything that has not been verified.',
  },
  {
    key: 'nextSteps',
    label: 'Next steps',
    hint: 'Where should the next session begin?',
  },
] as const
export const PROJECT_MEMORY_FIELD_LIMIT = 4000
export type ProjectMemoryFields = Record<
  (typeof PROJECT_MEMORY_FIELDS)[number]['key'],
  string
>
export interface ProjectMemory extends ProjectMemoryFields {
  toolId: string
  revision: string
  updatedAt: string
}
export interface SaveProjectMemoryInput {
  toolId: string
  expectedRevision: string | null
  fields: ProjectMemoryFields
}
export interface ProjectHandoffOptions {
  task?: string
  includeEnvironment?: boolean
  includeDesign?: boolean
  /** Omit to exclude run evidence. Never silently substitutes a different run. */
  runId?: string
  includeLogs?: boolean
}
export interface ProjectHandoff {
  toolId: string
  generatedAt: string
  memoryRevision: string | null
  markdown: string
}
export function emptyProjectMemory(): ProjectMemoryFields {
  return {
    purpose: '',
    conventions: '',
    decisions: '',
    knownIssues: '',
    nextSteps: '',
  }
}
