/**
 * Pure pre-launch checks: does the folder exist, are dependencies installed,
 * is the Docker daemon reachable? No side effects — callers decide what to do
 * (registerProject offers a consent-gated bootstrap; the GUI shows a remedy).
 */
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import type { LaunchErrorCode } from './types'

export interface PreflightIssue {
  code: LaunchErrorCode
  /** Plain-language, non-developer wording; the GUI shows this verbatim. */
  message: string
}

/** Sync filesystem checks. Docker is async — see checkDockerDaemon. */
export function preflightProject(
  projectPath: string | undefined,
  launchCommand: string | undefined,
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
    issues.push(...missingDependencyIssues(projectPath, launchCommand))
  }
  return issues
}

function missingDependencyIssues(
  projectPath: string,
  launchCommand: string | undefined,
): PreflightIssue[] {
  const issues: PreflightIssue[] = []
  const has = (rel: string) => fs.existsSync(path.join(projectPath, rel))

  // Node projects: a package.json with dependencies but no node_modules is
  // the single most common failure for freshly generated projects.
  if (has('package.json') && !has('node_modules')) {
    try {
      const pkg = JSON.parse(
        fs.readFileSync(path.join(projectPath, 'package.json'), 'utf8'),
      ) as { dependencies?: object; devDependencies?: object }
      if (
        Object.keys(pkg.dependencies || {}).length > 0 ||
        Object.keys(pkg.devDependencies || {}).length > 0
      ) {
        issues.push({
          code: 'deps_missing',
          message: "This project's packages aren't installed yet.",
        })
      }
    } catch {
      // Unreadable package.json — let the launch surface the real error.
    }
  }

  // Python projects that declare requirements but have no venv, when the
  // launch command expects one.
  const declaresPython =
    has('requirements.txt') || has('pyproject.toml') || has('Pipfile')
  const expectsVenv = Boolean(launchCommand && launchCommand.includes('.venv/'))
  if (declaresPython && expectsVenv && !has('.venv')) {
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
