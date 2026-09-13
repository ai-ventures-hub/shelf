import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { Tool, ToolEnvironment } from './contracts'
import { preflightProject, usesDocker, checkDockerDaemon } from './launch-preflight'
import { readProjectFacts } from './project-facts'
import { detectBootstrapNeeds } from './project-bootstrap'
import { readManifest } from './tool-manifest'

const execFileAsync = promisify(execFile)
/** Read-only diagnostics. Never evaluates a project's launch command or exposes env values. */
export async function inspectToolEnvironment(tool: Tool): Promise<ToolEnvironment> {
  const checks: ToolEnvironment['checks'] = []
  const root = tool.projectPath
  let folderReady = !root
  if (root) {
    try {
      folderReady = fs.statSync(root).isDirectory()
    } catch {
      folderReady = false
    }
    checks.push({
      label: 'Project folder',
      status: folderReady ? 'ready' : 'missing',
      detail: folderReady ? root : 'Choose the current project folder in Edit configuration.',
    })
  }
  const facts = root && folderReady ? readProjectFacts(root) : undefined
  const issues = preflightProject(root, tool.launchCommand, facts)
  checks.push(
    ...issues.map((issue) => ({
      label: 'Project setup',
      status: 'missing' as const,
      detail: issue.message,
    })),
  )
  if (facts?.entries.has('package.json') && !facts.packageJson)
    checks.push({
      label: 'Package metadata',
      status: 'unknown',
      detail: 'package.json could not be read. Fix its JSON before relying on detection.',
    })
  const binaries = new Set<string>()
  if (facts?.packageJson) {
    binaries.add('node')
    binaries.add(facts.packageManager)
  }
  if (facts?.declaresPython && !tool.launchCommand.includes('.venv/')) binaries.add('python3')
  if (usesDocker(tool.launchCommand)) binaries.add('docker')
  const first = tool.launchCommand.trim().split(/\s+/)[0]
  if (['node', 'npm', 'pnpm', 'yarn', 'bun', 'python3', 'docker'].includes(first))
    binaries.add(first)
  await Promise.all(
    [...binaries].map(async (binary) => {
      try {
        // Binary names come exclusively from the allowlist above, not user input.
        const { stdout } = await execFileAsync('/bin/zsh', ['-lc', `command -v ${binary}`], {
          timeout: 4000,
          cwd: folderReady ? root : undefined,
          maxBuffer: 65536,
        })
        checks.push({
          label: binary,
          status: stdout.trim() ? 'ready' : 'missing',
          detail: stdout.trim()
            ? 'Available in your login shell.'
            : `Install ${binary} or correct your shell PATH.`,
        })
      } catch {
        checks.push({
          label: binary,
          status: 'unknown',
          detail: `Could not find ${binary} in your login shell within four seconds. Check installation and shell startup.`,
        })
      }
    }),
  )
  if (binaries.has('docker')) {
    const issue = await checkDockerDaemon()
    checks.push({
      label: 'Docker daemon',
      status: issue ? 'missing' : 'ready',
      detail: issue?.message || 'Docker responded.',
    })
  }
  if (root && folderReady) {
    const manifest = readManifest(root)
    for (const key of Object.keys(manifest?.manifest.env || {})) {
      const configured = Boolean(tool.env?.[key] || process.env[key])
      checks.push({
        label: `Environment: ${key}`,
        status: configured ? 'ready' : 'unknown',
        detail: configured
          ? 'Value configured; hidden here.'
          : 'Not configured in Shelf or its host. The project may load it from its own env file.',
      })
    }
    if (tool.launchCommand.includes('.venv/'))
      checks.push({
        label: 'Python environment',
        status: fs.existsSync(path.join(root, '.venv/bin/python')) ? 'ready' : 'missing',
        detail: 'Project-local .venv/bin/python.',
      })
  }
  if (checks.length === 0)
    checks.push({
      label: 'Custom command',
      status: 'unknown',
      detail: 'This command needs a test run. Shelf has not executed it during inspection.',
    })
  return {
    checkedAt: new Date().toISOString(),
    checks: checks.sort((a, b) => a.label.localeCompare(b.label)),
    setupSteps: root && folderReady ? detectBootstrapNeeds(root, facts) : [],
  }
}
