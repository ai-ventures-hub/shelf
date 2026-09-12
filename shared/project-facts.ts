import fs from 'node:fs'
import path from 'node:path'

export interface ProjectPackage {
  name?: string
  description?: string
  bin?: string | Record<string, string>
  scripts: Record<string, string>
  dependencies: Record<string, string>
  devDependencies: Record<string, string>
}

export interface ProjectFacts {
  entries: Set<string>
  packageJson: ProjectPackage | null
  packageManager: 'pnpm' | 'yarn' | 'bun' | 'npm'
  hasNodeDependencies: boolean
  nodeModulesPresent: boolean
  declaresPython: boolean
  venvPresent: boolean
}

function stringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
}

/** One filesystem observation for import, preflight, setup, and update planning. */
export function readProjectFacts(root: string): ProjectFacts {
  let entries: Set<string>
  try { entries = new Set(fs.readdirSync(root)) } catch { entries = new Set() }
  let packageJson: ProjectPackage | null = null
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      const pkg = raw as Record<string, unknown>
      packageJson = {
        name: typeof pkg.name === 'string' ? pkg.name : undefined,
        description: typeof pkg.description === 'string' ? pkg.description : undefined,
        bin: typeof pkg.bin === 'string' ? pkg.bin : stringRecord(pkg.bin),
        scripts: stringRecord(pkg.scripts),
        dependencies: stringRecord(pkg.dependencies),
        devDependencies: stringRecord(pkg.devDependencies),
      }
    }
  } catch { /* Missing or malformed package metadata cannot supply launch suggestions. */ }
  return {
    entries, packageJson,
    packageManager: entries.has('pnpm-lock.yaml') ? 'pnpm' : entries.has('yarn.lock') ? 'yarn' : entries.has('bun.lockb') || entries.has('bun.lock') ? 'bun' : 'npm',
    hasNodeDependencies: Boolean(packageJson && (Object.keys(packageJson.dependencies).length || Object.keys(packageJson.devDependencies).length)),
    nodeModulesPresent: fs.existsSync(path.join(root, 'node_modules')),
    declaresPython: ['requirements.txt', 'pyproject.toml', 'Pipfile'].some((file) => entries.has(file)),
    venvPresent: fs.existsSync(path.join(root, '.venv')),
  }
}

/** Updates reinstall existing dependencies; first launch only installs missing ones. */
export function projectInstallCommands(facts: ProjectFacts, mode: 'missing' | 'refresh'): string[] {
  const commands: string[] = []
  if (facts.entries.has('package.json') && (mode === 'refresh' || (facts.hasNodeDependencies && !facts.nodeModulesPresent))) {
    commands.push(`${facts.packageManager} install`)
  }
  if (facts.entries.has('requirements.txt') && (mode === 'refresh' || !facts.venvPresent)) {
    commands.push(facts.venvPresent ? '.venv/bin/pip install -r requirements.txt' : 'python3 -m venv .venv && .venv/bin/pip install -r requirements.txt')
  }
  return commands
}
