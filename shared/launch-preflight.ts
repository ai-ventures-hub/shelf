import type { PreflightIssue } from './contracts'
import { readProjectFacts, type ProjectFacts } from './project-facts'
export type { PreflightIssue } from './contracts'
/**
 * Pure pre-launch checks: does the folder exist, are dependencies installed,
 * is the Docker daemon reachable? No side effects — callers decide what to do
 * (registerProject offers a consent-gated bootstrap; the GUI shows a remedy).
 */
import { execFile } from 'node:child_process'
import fs from 'node:fs'

/** Sync filesystem checks. Docker is async — see checkDockerDaemon. */
export function preflightProject(
  projectPath: string | undefined,
  launchCommand: string | undefined,
  observed?: ProjectFacts,
): PreflightIssue[] {
  const issues: PreflightIssue[] = []
  if (projectPath && !fs.existsSync(projectPath)) {
    issues.push({
      code: 'folder_missing',
      message: "Shelf can't find this project's folder anymore.",
    })
    return issues
  }
  if (projectPath) {
    issues.push(...missingDependencyIssues(projectPath, launchCommand, observed))
  }
  return issues
}

function missingDependencyIssues(
  projectPath: string,
  launchCommand: string | undefined,
  observed?: ProjectFacts,
): PreflightIssue[] {
  const issues: PreflightIssue[] = []
  const facts = observed ?? readProjectFacts(projectPath)
  if (facts.hasNodeDependencies && !facts.nodeModulesPresent) {
    issues.push({ code: 'deps_missing', message: "This project's packages aren't installed yet." })
  }

  const expectsVenv = Boolean(launchCommand && launchCommand.includes('.venv/'))
  if (facts.declaresPython && expectsVenv && !facts.venvPresent) {
    issues.push({
      code: 'deps_missing',
      message: "This project's Python environment isn't set up yet.",
    })
  }

  return issues
}

/** True when the launch command needs the Docker daemon. */
export function usesDocker(launchCommand: string | undefined): boolean {
  return /^\s*docker(\s|-compose)/.test(launchCommand || '')
}

/** Probe the Docker daemon (only call when usesDocker). */
export function checkDockerDaemon(timeoutMs = 4_000): Promise<PreflightIssue | null> {
  return new Promise((resolve) => {
    const child = execFile('docker', ['info'], { timeout: timeoutMs }, (err) => {
      resolve(
        err
          ? {
              code: 'docker_not_running',
              message: "Docker Desktop isn't running.",
            }
          : null,
      )
    })
    child.on('error', () =>
      resolve({
        code: 'docker_not_running',
        message: "Docker Desktop isn't running.",
      }),
    )
  })
}
