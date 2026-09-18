/** Browser-safe verification workflow and run records. */

export interface VerificationStep {
  id: string
  label: string
  command: string
  timeoutSeconds: number
}
export interface VerificationWorkflow {
  revision: string
  steps: VerificationStep[]
}
export type VerificationStatus =
  | 'pending'
  | 'running'
  | 'passed'
  | 'failed'
  | 'cancelled'
  | 'timed_out'
  | 'skipped'
  | 'interrupted'
  | 'cleanup_required'
export interface VerificationStepResult extends VerificationStep {
  status: VerificationStatus
  startedAt?: string
  endedAt?: string
  exitCode?: number | null
  message?: string
}
export interface VerificationRun {
  id: string
  toolId: string
  workflowRevision: string
  toolRevision: string
  projectPath: string
  startedAt: string
  endedAt?: string
  status: VerificationStatus
  steps: VerificationStepResult[]
  message?: string
  owner: { pid: number; identity: string }
  child?: { pid: number; identity: string }
}
export interface VerificationState {
  toolId: string
  workflow: VerificationWorkflow | null
  runs: VerificationRun[]
}
export interface SaveVerificationInput {
  toolId: string
  expectedRevision: string | null
  steps: VerificationStep[]
}
export interface StartVerificationInput {
  toolId: string
  workflowRevision: string
  toolRevision: string
}
export function verificationActive(status: VerificationStatus): boolean {
  return status === 'running' || status === 'cleanup_required'
}
