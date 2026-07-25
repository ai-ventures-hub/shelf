/**
 * Smart project import — inspect a folder and suggest Shelf tool fields.
 * Pure filesystem + port helpers; no process spawning beyond port probes.
 */
import fs from 'node:fs'
import path from 'node:path'
import { resolveDesignMd } from './design-md'
import { findFreePort, isPortFree, urlForPort, withForcedPort } from './ports'
import type { LaunchAlternative, ProjectImportSuggestion } from './types'

export type { LaunchAlternative, ProjectImportSuggestion }

const SCRIPT_PRIORITY = [
  'dev',
  'start',
  'serve',
  'develop',
  'preview',
  'watch',
  'server',
]

/**
 * Inspect an absolute project folder and return fill-in suggestions.
 */
export async function inspectProject(
  projectPath: string,
): Promise<ProjectImportSuggestion> {
  const resolved = path.resolve(projectPath.trim())
  const base: ProjectImportSuggestion = {
    projectPath: resolved,
    launchAlternatives: [],
    tags: [],
    designMd: { found: false },
    confidence: 'low',
    signals: [],
  }

  if (!resolved || !fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    base.signals.push('Folder not found or not a directory.')
    return base
  }

  const entries = safeReaddir(resolved)
  const entrySet = new Set(entries)
  const signals: string[] = []
  const tags = new Set<string>()
  let alternatives: LaunchAlternative[] = []

  let name = titleFromFolder(resolved)
  let description: string | undefined
  let launchCommand: string | undefined
  let preferredPort: number | undefined
  let notesHint: string | undefined

  const design = resolveDesignMd(resolved)
  if (design.found) {
    signals.push(`DESIGN.md at ${path.basename(design.path || 'DESIGN.md')}`)
  }

  // —— Node / JS ——
  const pkgPath = path.join(resolved, 'package.json')
  if (entrySet.has('package.json') && fs.existsSync(pkgPath)) {
    const pkg = readJson(pkgPath) as {
      name?: string
      description?: string
      scripts?: Record<string, string>
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    } | null

    if (pkg) {
      signals.push('Found package.json')
      if (pkg.name) name = humanizePackageName(pkg.name)
      if (pkg.description?.trim()) description = pkg.description.trim()

      const pm = detectPackageManager(entrySet)
      const scripts = pkg.scripts || {}
      const scriptNames = Object.keys(scripts)
      const primaryScript =
        SCRIPT_PRIORITY.find((s) => scriptNames.includes(s)) || scriptNames[0]

      if (primaryScript) {
        launchCommand = `${pm} run ${primaryScript}`
        signals.push(`Script "${primaryScript}" via ${pm}`)
        for (const s of scriptNames) {
          if (s === primaryScript) continue
          if (SCRIPT_PRIORITY.includes(s) || /^(dev|start|serve)/.test(s)) {
            alternatives.push({
              command: `${pm} run ${s}`,
              label: `${pm} run ${s}`,
            })
          }
        }
      }

      const deps = {
        ...(pkg.dependencies || {}),
        ...(pkg.devDependencies || {}),
      }
      preferredPort =
        extractPortFromScripts(scripts) ||
        frameworkDefaultPort(deps, entrySet) ||
        preferredPort

      for (const tag of frameworkTags(deps, entrySet)) tags.add(tag)
    }
  }

  // —— Python ——
  const hasPy =
    entrySet.has('requirements.txt') ||
    entrySet.has('pyproject.toml') ||
    entrySet.has('Pipfile') ||
    entrySet.has('setup.py')
  if (hasPy) {
    signals.push('Python project markers')
    tags.add('Python')
    const venvPython = resolveVenvPython(resolved, entrySet)
    const pyEntry = detectPythonEntry(resolved, entrySet)
    if (!launchCommand && pyEntry) {
      launchCommand = `${venvPython} ${pyEntry}`
      signals.push(
        venvPython.includes('.venv')
          ? 'Using .venv Python entry'
          : 'Using system Python entry',
      )
      preferredPort = preferredPort || 5000
    } else if (!launchCommand) {
      launchCommand = venvPython.includes('.venv')
        ? `${venvPython} -m flask run --port 5000`
        : 'python3 -m http.server 8000'
      preferredPort = preferredPort || (launchCommand.includes('8000') ? 8000 : 5000)
      notesHint =
        'Python entry unclear — confirm the launch command before saving.'
    }
  }

  // —— Docker ——
  const composeFile = ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml'].find(
    (f) => entrySet.has(f),
  )
  if (composeFile) {
    signals.push(`Found ${composeFile}`)
    tags.add('Docker')
    alternatives.push({
      command: 'docker compose up',
      label: 'docker compose up',
    })
    if (!launchCommand) {
      launchCommand = 'docker compose up'
      preferredPort = preferredPort || 8080
    }
  }

  // —— Makefile ——
  if (entrySet.has('Makefile') || entrySet.has('makefile')) {
    const makeTargets = readMakeTargets(path.join(resolved, entrySet.has('Makefile') ? 'Makefile' : 'makefile'))
    const makeDev = ['dev', 'serve', 'start', 'run'].find((t) => makeTargets.includes(t))
    if (makeDev) {
      signals.push(`Makefile target "${makeDev}"`)
      const cmd = `make ${makeDev}`
      if (!launchCommand) launchCommand = cmd
      else alternatives.push({ command: cmd, label: cmd })
    }
  }

  // —— Plain node server (fixture style) ——
  if (!launchCommand && entrySet.has('server.mjs')) {
    launchCommand = 'node server.mjs'
    preferredPort = preferredPort || 8765
    signals.push('Found server.mjs')
    tags.add('Node')
  } else if (!launchCommand && entrySet.has('server.js')) {
    launchCommand = 'node server.js'
    preferredPort = preferredPort || 3000
    signals.push('Found server.js')
    tags.add('Node')
  }

  // —— Port from env files ——
  const envPort = readPortFromEnvFiles(resolved, entrySet)
  if (envPort) {
    preferredPort = envPort
    signals.push(`PORT=${envPort} in env file`)
  }

  // —— Free-port adjustment ——
  let port = preferredPort
  let portFree: boolean | undefined
  let url: string | undefined
  if (preferredPort) {
    portFree = await isPortFree(preferredPort)
    if (!portFree) {
      try {
        const free = await findFreePort({ preferred: preferredPort, from: 3000, to: 4999 })
        port = free.port
        portFree = true
        signals.push(
          `Port ${preferredPort} busy → suggesting free port ${port}`,
        )
      } catch {
        signals.push(`Port ${preferredPort} busy; could not find a free alternative.`)
      }
    } else {
      signals.push(`Port ${preferredPort} is free`)
    }
    if (port && launchCommand) {
      // Pin port for package-manager / framework commands so readiness stays truthful.
      if (shouldPinPort(launchCommand)) {
        launchCommand = withForcedPort(launchCommand, port)
        alternatives = alternatives.map((a) =>
          shouldPinPort(a.command)
            ? { ...a, command: withForcedPort(a.command, port!) }
            : a,
        )
      } else if (!/\bPORT=\d+/.test(launchCommand) && /node\s+server\./.test(launchCommand)) {
        launchCommand = `PORT=${port} ${launchCommand}`
      }
      url = urlForPort(undefined, port)
    }
  }

  // Deduplicate alternatives (exclude primary).
  const altFiltered = alternatives
    .filter((a) => a.command !== launchCommand)
    .filter(
      (a, i, arr) => arr.findIndex((x) => x.command === a.command) === i,
    )
    .slice(0, 6)

  let confidence: ProjectImportSuggestion['confidence'] = 'low'
  if (launchCommand && (entrySet.has('package.json') || hasPy || composeFile)) {
    confidence = preferredPort ? 'high' : 'medium'
  } else if (launchCommand) {
    confidence = 'medium'
  }

  if (!notesHint && design.found) {
    notesHint = 'Project-local DESIGN.md detected — available on the tool detail page.'
  }

  return {
    projectPath: resolved,
    name,
    description,
    launchCommand,
    launchAlternatives: altFiltered,
    port,
    portPreferred: preferredPort,
    portFree,
    url,
    tags: Array.from(tags).sort((a, b) => a.localeCompare(b)),
    designMd: { found: design.found, path: design.path },
    notesHint,
    confidence,
    signals,
  }
}

function shouldPinPort(command: string): boolean {
  return /\b(npm|pnpm|yarn|bun)\s+run\b/.test(command) || /\b(next|vite|flask)\b/.test(command)
}

function safeReaddir(dir: string): string[] {
  try {
    return fs.readdirSync(dir)
  } catch {
    return []
  }
}

function readJson(filePath: string): unknown | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch {
    return null
  }
}

function titleFromFolder(dir: string): string {
  const base = path.basename(dir)
  return humanizePackageName(base)
}

function humanizePackageName(raw: string): string {
  const bare = raw.includes('/') ? raw.split('/').pop()! : raw
  return bare
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

function detectPackageManager(entries: Set<string>): string {
  if (entries.has('pnpm-lock.yaml')) return 'pnpm'
  if (entries.has('yarn.lock')) return 'yarn'
  if (entries.has('bun.lockb') || entries.has('bun.lock')) return 'bun'
  return 'npm'
}

function extractPortFromScripts(scripts: Record<string, string>): number | undefined {
  for (const body of Object.values(scripts)) {
    const match =
      body.match(/--port(?:=|\s+)(\d{2,5})/i) ||
      body.match(/-p(?:=|\s+)(\d{2,5})/) ||
      body.match(/\bPORT=(\d{2,5})\b/)
    if (match) {
      const n = Number(match[1])
      if (n >= 1 && n <= 65535) return n
    }
  }
  return undefined
}

function frameworkDefaultPort(
  deps: Record<string, string>,
  entries: Set<string>,
): number | undefined {
  if (deps.next || entries.has('next.config.js') || entries.has('next.config.mjs') || entries.has('next.config.ts')) {
    return 3000
  }
  if (
    deps.vite ||
    entries.has('vite.config.js') ||
    entries.has('vite.config.ts') ||
    entries.has('vite.config.mjs')
  ) {
    return 5173
  }
  if (deps.nuxt || entries.has('nuxt.config.ts') || entries.has('nuxt.config.js')) {
    return 3000
  }
  if (deps.astro) return 4321
  if (deps.express || deps.fastify || deps.hono) return 3000
  return undefined
}

function frameworkTags(
  deps: Record<string, string>,
  entries: Set<string>,
): string[] {
  const tags: string[] = ['Node']
  if (deps.next || entries.has('next.config.js') || entries.has('next.config.mjs') || entries.has('next.config.ts')) {
    tags.push('Next.js')
  }
  if (deps.vite || entries.has('vite.config.ts') || entries.has('vite.config.js')) {
    tags.push('Vite')
  }
  if (deps.react || deps['react-dom']) tags.push('React')
  if (deps.vue) tags.push('Vue')
  if (deps.nuxt) tags.push('Nuxt')
  if (deps.astro) tags.push('Astro')
  if (deps.express || deps.fastify || deps.hono) tags.push('API')
  if (deps.electron) tags.push('Electron')
  return tags
}

function resolveVenvPython(root: string, entries: Set<string>): string {
  const candidates = ['.venv/bin/python', 'venv/bin/python', '.venv/bin/python3']
  for (const rel of candidates) {
    const abs = path.join(root, rel)
    if (fs.existsSync(abs)) return rel
  }
  // Directory presence without binary still prefers the conventional path.
  if (entries.has('.venv') || entries.has('venv')) return '.venv/bin/python'
  return 'python3'
}

function detectPythonEntry(root: string, entries: Set<string>): string | undefined {
  const candidates = [
    'app.py',
    'main.py',
    'server.py',
    'run.py',
    'manage.py',
    'wsgi.py',
  ]
  for (const file of candidates) {
    if (entries.has(file) && fs.existsSync(path.join(root, file))) return file
  }
  return undefined
}

function readMakeTargets(filePath: string): string[] {
  try {
    const text = fs.readFileSync(filePath, 'utf8')
    const targets: string[] = []
    for (const line of text.split('\n')) {
      const m = line.match(/^([A-Za-z0-9_-]+):/)
      if (m) targets.push(m[1])
    }
    return targets
  } catch {
    return []
  }
}

function readPortFromEnvFiles(root: string, entries: Set<string>): number | undefined {
  const files = ['.env.local', '.env', '.env.development', '.env.development.local']
  for (const file of files) {
    if (!entries.has(file)) continue
    try {
      const text = fs.readFileSync(path.join(root, file), 'utf8')
      const m = text.match(/^\s*PORT\s*=\s*(\d{2,5})\s*$/m)
      if (m) {
        const n = Number(m[1])
        if (n >= 1 && n <= 65535) return n
      }
    } catch {
      // ignore unreadable env
    }
  }
  return undefined
}
