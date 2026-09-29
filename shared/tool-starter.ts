/**
 * Start a new tool from an idea.
 *
 * Shelf creates a small, already-launchable project in the recipe the user's
 * own tools follow (zero-dependency Node server on a loopback port, the
 * design profile as DESIGN.md and CSS variables, a build brief for the
 * agent), registers it, and hands the folder to a coding agent. The agent
 * builds the tool; Shelf already knows how to run it.
 *
 * Nothing here runs a command. Creation is a user action in the desktop app,
 * so the tool is saved directly rather than staged as an agent draft.
 */
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { containsLikelySecret } from './capability-intelligence'
import type { DesignProfile, Tool } from './contracts'
import { buildDesignBrief } from './design-brief'
import { flattenTokens, type FlatToken } from './design-tokens'
import type { DesignProfileStore } from './design-profile-store'
import type { LibraryStore } from './library-store'
import { isPortFree } from './ports'
import { folderNameFor } from './tool-manifest'
import { stripInvisibleChars } from './types'

/** Constant on purpose: it is passed to a shell, so no user text goes in it. */
export const STARTER_KICKOFF_PROMPT =
  'Read AGENTS.md and build the tool it describes. Keep the start command working after every change.'

/** Coding agents Shelf can start in a tool's folder, by CLI name. */
export const STARTER_AGENT_CLIS = {
  // The older local installer set up `claude` as a shell alias, which a
  // script cannot see; its binary lives at ~/.claude/local/claude.
  'claude-code': { bin: 'claude', label: 'Claude Code', homeFallbacks: ['.claude/local/claude', '.local/bin/claude'] },
  codex: { bin: 'codex', label: 'Codex', homeFallbacks: ['.local/bin/codex'] },
} as const
export type StarterAgentCli = keyof typeof STARTER_AGENT_CLIS

/**
 * Which agent CLIs this Mac can actually run: on the login shell's PATH, in
 * an nvm global bin, or at a known install path. An installed desktop app
 * (ChatGPT, Claude) does not count; the Terminal hand-off needs the CLI.
 */
export async function detectAgentClis(home = os.homedir()): Promise<Record<StarterAgentCli, boolean>> {
  const onPath = new Set<string>()
  await new Promise<void>((resolve) => {
    execFile('/bin/zsh', ['-lc', 'for c in claude codex; do command -v "$c" >/dev/null 2>&1 && echo "$c"; done'], { timeout: 2_500 }, (_error, stdout) => {
      for (const line of String(stdout || '').split('\n')) if (line.trim()) onPath.add(line.trim())
      resolve()
    })
  })
  const nvmBins = (() => {
    try {
      const root = path.join(home, '.nvm', 'versions', 'node')
      return fs.readdirSync(root).map((version) => path.join(root, version, 'bin'))
    } catch {
      return []
    }
  })()
  const found = (agent: StarterAgentCli) => {
    const { bin, homeFallbacks } = STARTER_AGENT_CLIS[agent]
    const candidates = [
      ...homeFallbacks.map((relative) => path.join(home, relative)),
      ...['/opt/homebrew/bin', '/usr/local/bin', ...nvmBins].map((dir) => path.join(dir, bin)),
    ]
    return onPath.has(bin) || candidates.some((candidate) => {
      try { fs.accessSync(candidate, fs.constants.X_OK); return true } catch { return false }
    })
  }
  return { 'claude-code': found('claude-code'), codex: found('codex') }
}

/**
 * A one-shot Terminal script that opens the agent in `folder` with the
 * kickoff prompt. Terminal runs .command files from an interactive login
 * shell, so nvm and Homebrew PATHs resolve, and `open` needs no Automation
 * permission. The script deletes itself and leaves a shell in the folder.
 */
export function agentLauncherScript(folder: string, agent: StarterAgentCli): string {
  const { bin, label, homeFallbacks } = STARTER_AGENT_CLIS[agent]
  const prompt = shellQuote(STARTER_KICKOFF_PROMPT)
  const candidates = [bin, ...homeFallbacks.map((relative) => `"$HOME/${relative}"`)].join(' ')
  return `#!/bin/zsh
# Written by Shelf to start ${label} in a new tool's folder. Safe to delete.
rm -f -- "$0"; rmdir -- "\${0:h}" 2>/dev/null
cd ${shellQuote(folder)} || exit 1
agent=""
for candidate in ${candidates}; do
  if command -v "$candidate" >/dev/null 2>&1; then agent="$candidate"; break; fi
done
if [ -n "$agent" ]; then
  "$agent" ${prompt}
else
  echo "${label} is not installed, or its command is not on your PATH."
  echo "Install it, then run this from this folder:"
  echo "  ${bin} ${prompt}"
fi
exec "\${SHELL:-/bin/zsh}" -l
`
}

/** Where hand-made Shelf tools already live on this Mac. */
export function defaultToolsRoot(home = os.homedir()): string {
  return path.join(home, 'Shelf Tools')
}

/** Clear of the 3000s dev servers crowd and of Shelf's own tooling. */
const PORT_RANGE = { from: 4400, to: 4999 } as const
const MAX_NAME = 80
const MAX_IDEA = 4000

export interface ToolStarterInput {
  name: string
  /** What the tool should do, in the user's words. Becomes the build brief. */
  idea: string
  /** Parent folder; the tool gets its own folder inside. Default ~/Shelf Tools. */
  parentDir?: string
  port?: number
  /** Omitted = the default profile; null = no profile. */
  designProfileId?: string | null
}

export interface ToolStarterDeps {
  store: LibraryStore
  designProfiles: DesignProfileStore
  /** Absolute node binary, or 'node' when a login shell already finds it. */
  nodeCommand: { command: string; env?: Record<string, string> }
  toolDefaults?: Partial<Pick<Tool, 'iconLucide' | 'iconColor' | 'iconBackground'>>
  /** Pending agent drafts: their ports are claimed too. */
  drafts?: { list(): ReadonlyArray<{ port?: number }> }
  now?: () => Date
}

export interface ToolStarterResult {
  tool: Tool
  folder: string
  files: string[]
  prompt: string
  profileName?: string
}

/**
 * A port no library tool claims and nothing is listening on. Stopped tools
 * count as taken: their port is free now and busy the moment they start.
 */
export async function pickStarterPort(tools: readonly Pick<Tool, 'port'>[]): Promise<number> {
  const claimed = new Set(tools.map((tool) => tool.port).filter((port): port is number => Boolean(port)))
  for (let port = PORT_RANGE.from; port <= PORT_RANGE.to; port++) {
    if (!claimed.has(port) && (await isPortFree(port))) return port
  }
  throw new Error(`No free port between ${PORT_RANGE.from} and ${PORT_RANGE.to}. Enter one yourself.`)
}

/**
 * `node server.mjs` when node is on the login PATH Shelf launches with
 * (Homebrew, system); an absolute path for nvm/fnm installs that only an
 * interactive shell sets up; Shelf's own runtime on a Mac without Node.
 */
export function starterLaunchCommand(nodeCommand: ToolStarterDeps['nodeCommand']): string {
  const onLoginPath = ['/opt/homebrew/bin/node', '/usr/local/bin/node', '/usr/bin/node']
  if (nodeCommand.command === 'node' || onLoginPath.includes(nodeCommand.command)) return 'node server.mjs'
  const env = Object.entries(nodeCommand.env || {}).map(([key, value]) => `${key}=${shellQuote(value)} `).join('')
  return `${env}${shellQuote(nodeCommand.command)} server.mjs`
}

export function shellQuote(value: string): string {
  return /^[A-Za-z0-9_./:@%+=-]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`
}

export function cleanStarterInput(input: ToolStarterInput): { name: string; idea: string } {
  const name = stripInvisibleChars(String(input.name ?? '')).replace(/\s+/g, ' ').trim()
  // Line breaks are control characters too; strip per line so they survive.
  const idea = String(input.idea ?? '').replace(/\r\n?/g, '\n').split('\n').map(stripInvisibleChars).join('\n').trim()
  if (!name) throw new Error('Give the tool a name.')
  if (name.length > MAX_NAME) throw new Error(`Keep the name under ${MAX_NAME} characters.`)
  if (!idea) throw new Error('Describe what the tool should do.')
  if (idea.length > MAX_IDEA) throw new Error(`Keep the description under ${MAX_IDEA} characters. Put details in the project once it exists.`)
  // Both land in files an agent reads and a repo may later publish.
  if (containsLikelySecret(name) || containsLikelySecret(idea))
    throw new Error('That text looks like it contains a credential. Leave secrets out; the tool reads them from environment variables.')
  return { name, idea }
}

export async function createToolProject(
  input: ToolStarterInput,
  deps: ToolStarterDeps,
): Promise<ToolStarterResult> {
  const { name, idea } = cleanStarterInput(input)
  const parentDir = input.parentDir?.trim() ? path.resolve(input.parentDir.trim()) : defaultToolsRoot()
  if (!path.isAbsolute(parentDir)) throw new Error('Choose a folder for the new tool.')
  if (input.parentDir?.trim() && !isDirectory(parentDir))
    throw new Error('The folder you chose no longer exists. Choose another.')
  const folder = path.join(parentDir, folderNameFor(name))
  if (path.dirname(folder) !== parentDir) throw new Error('That name cannot be used as a folder name.')
  if (fs.existsSync(folder) && !isEmptyDirectory(folder))
    throw new Error(`${folder} already exists and is not empty. Choose another name or folder.`)
  const already = deps.store.findByProjectPath(folder)
  if (already) throw new Error(`"${already.name}" already uses that folder.`)

  const port = input.port ?? (await pickStarterPort([...deps.store.list(), ...(deps.drafts?.list() ?? [])]))
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Use a port between 1024 and 65535.')
  if (input.port !== undefined && !(await isPortFree(port))) throw new Error(`Port ${port} is in use. Choose another.`)

  const profile = input.designProfileId === null
    ? undefined
    : input.designProfileId
      ? deps.designProfiles.get(input.designProfileId)
      : deps.designProfiles.getDefault()
  if (input.designProfileId && !profile) throw new Error('That design profile no longer exists.')

  const launchCommand = starterLaunchCommand(deps.nodeCommand)
  const url = `http://127.0.0.1:${port}/`
  const now = (deps.now?.() ?? new Date()).toISOString()

  // Register first so the brief can carry the tool id; remove it again if
  // the files cannot be written.
  const tool = deps.store.save({
    id: '',
    name,
    description: summarize(idea),
    tags: ['New tool'],
    capabilities: [],
    agentAccess: [],
    favorite: false,
    projectPath: folder,
    launchCommand,
    port,
    url,
    notes: [
      `Started in Shelf on ${now.slice(0, 10)}. The build brief is AGENTS.md.`,
      profile ? `Design source: Shelf ${profile.name} profile ${profile.id}.` : '',
    ].filter(Boolean).join(' '),
    iconLucide: deps.toolDefaults?.iconLucide || 'Hammer',
    iconColor: deps.toolDefaults?.iconColor,
    iconBackground: deps.toolDefaults?.iconBackground,
    createdAt: '',
    updatedAt: '',
  })

  const files = starterFiles({ name, idea, port, launchCommand, toolId: tool.id, profile })
  const createdFolder = !fs.existsSync(folder)
  const written: string[] = []
  try {
    fs.mkdirSync(folder, { recursive: true })
    for (const [relative, content] of Object.entries(files)) {
      const target = path.join(folder, relative)
      fs.mkdirSync(path.dirname(target), { recursive: true })
      // 'wx': never overwrite anything that appeared in the meantime.
      fs.writeFileSync(target, content, { encoding: 'utf8', flag: 'wx' })
      written.push(relative)
    }
  } catch (error) {
    if (createdFolder) fs.rmSync(folder, { recursive: true, force: true })
    else for (const relative of written) fs.rmSync(path.join(folder, relative), { force: true })
    deps.store.delete(tool.id)
    throw new Error(`Shelf could not create the project: ${error instanceof Error ? error.message : String(error)}`)
  }

  return { tool, folder, files: Object.keys(files), prompt: STARTER_KICKOFF_PROMPT, profileName: profile?.name }
}

interface StarterFileInput {
  name: string
  idea: string
  port: number
  launchCommand: string
  toolId: string
  profile?: DesignProfile
}

/** Every file the starter writes, keyed by path relative to the tool folder. */
export function starterFiles(input: StarterFileInput): Record<string, string> {
  const slug = folderNameFor(input.name).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[._-]+|[._-]+$/g, '') || 'shelf-tool'
  return {
    'AGENTS.md': agentsBrief(input),
    'CLAUDE.md': '@AGENTS.md\n',
    'README.md': readme(input),
    ...(input.profile ? { 'DESIGN.md': designMd(input.profile) } : {}),
    'package.json': `${JSON.stringify({ name: slug, version: '0.1.0', private: true, type: 'module', description: summarize(input.idea), scripts: { start: 'node server.mjs' }, engines: { node: '>=20' } }, null, 2)}\n`,
    'server.mjs': serverSource(input),
    'public/index.html': indexHtml(input),
    'public/styles.css': STYLES_CSS,
    'public/tokens.css': tokensCss(input.profile),
    '.gitignore': 'node_modules/\n.env\n.env.*\n.DS_Store\ndata/*.tmp\n',
  }
}

/** The build brief. Also what the MCP new-tool prompt hands an agent. */
export function agentsBrief(input: Omit<StarterFileInput, 'toolId'> & { toolId?: string }): string {
  const start = input.launchCommand
  const design = input.profile
    ? `Follow DESIGN.md. It comes from the user's "${input.profile.name}" design profile in Shelf. \`public/tokens.css\` already defines its colors and fonts as CSS variables, and \`public/styles.css\` maps them to the page. Use those variables instead of new colors.`
    : 'No design profile was chosen. Keep the starter\'s calm, neutral styling and its light and dark modes.'
  const finish = input.toolId
    ? `3. Tell Shelf what the tool can do. If the Shelf MCP server is connected, call \`shelf_upsert_tool\` with id \`${input.toolId}\` and set \`description\`, \`capabilities\` (short task phrases, such as "resize website images"), and \`agentAccess\` for each HTTP or CLI interface. Otherwise, list those in your final message so the user can paste them into Shelf.`
    : '3. Register the tool with `shelf_register_project` (the user accepts it in Shelf), passing a description and capabilities (short task phrases, such as "resize website images"). Describe each HTTP or CLI interface in README.md.'
  return `# ${input.name}

${input.idea}

You are building this tool from scratch in this folder. ${input.toolId ? "Shelf, the user's local tool library, created the folder, registered the tool, and launches it." : "It will live in Shelf, the user's local tool library, which launches it."} Build the smallest version that does the job well, then stop and summarize what you built.

## Shelf tool contract

- Start command: \`${start}\`, run from this folder. Shelf runs exactly this. If you change it (for example to \`npm start\` after adding dependencies), update it in Shelf too (see Finish).
- Listen on \`process.env.PORT\`, falling back to ${input.port}. Bind to 127.0.0.1 only. Shelf treats the tool as running once that port accepts connections.
- Print one line with the local URL when the server is ready.
- Keep \`GET /api/health\` answering 200.
- Prefer no dependencies: Node's standard library and plain HTML, CSS, and JavaScript. If a package clearly pays for itself, add it to package.json and say why in README.md.
- Keep state as JSON files in \`data/\`, written atomically (write a temporary file, then rename it). Never write outside this folder.
- Secrets never go in files. Read them from environment variables and list the variable names in README.md. The user sets the values in Shelf.

## Design

${design}

## Make it useful to agents

If the tool holds data or performs actions another agent could use, expose them:

- HTTP: JSON endpoints under \`/api/\`.
- CLI: \`node cli.mjs <command>\` that works without the server running.

Document each one in README.md under "Agent access".

## Finish

1. Start it with \`${start}\` and check it in a browser at http://127.0.0.1:${input.port}/.
2. Update README.md: what the tool does, how to run it, and the "Agent access" section.
${finish}
${input.toolId ? `\nShelf tool id: ${input.toolId}\n` : ''}`
}

function readme(input: StarterFileInput): string {
  return `# ${input.name}

${input.idea}

## Run

\`${input.launchCommand}\`, then open http://127.0.0.1:${input.port}/. Set \`PORT\` to use another port.

## Agent access

None yet. The build brief in AGENTS.md asks the agent to document each HTTP or CLI interface here.
`
}

function designMd(profile: DesignProfile): string {
  return `# Design

This project follows the "${profile.name}" design profile from Shelf (profile ${profile.id}). \`public/tokens.css\` holds its tokens as CSS variables. Connected agents can read the full profile with \`shelf_get_design_profile\`.

${buildDesignBrief(profile)}
`
}

function serverSource(input: StarterFileInput): string {
  return `// Started by Shelf. Zero dependencies: Node's standard library only.
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

const HOST = '127.0.0.1'
const PORT = Number(process.env.PORT) || ${input.port}
const PUBLIC_DIR = fileURLToPath(new URL('./public/', import.meta.url))
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
}

function send(res, status, body, type) {
  res.writeHead(status, { 'content-type': type, 'x-content-type-options': 'nosniff' })
  res.end(body)
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', \`http://\${HOST}\`)
  if (url.pathname === '/api/health') {
    return send(res, 200, JSON.stringify({ ok: true, name: ${JSON.stringify(input.name)} }), TYPES['.json'])
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed', 'text/plain')
  let relative
  try {
    relative = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\\/+/, '')
  } catch {
    return send(res, 400, 'Bad request', 'text/plain')
  }
  const file = normalize(join(PUBLIC_DIR, relative))
  if (!file.startsWith(PUBLIC_DIR)) return send(res, 404, 'Not found', 'text/plain')
  try {
    send(res, 200, await readFile(file), TYPES[extname(file)] ?? 'application/octet-stream')
  } catch {
    send(res, 404, 'Not found', 'text/plain')
  }
})

server.listen(PORT, HOST, () => {
  console.log(\`${input.name.replace(/[`\\$]/g, '')} running at http://\${HOST}:\${PORT}/\`)
})
`
}

function indexHtml(input: StarterFileInput): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(input.name)}</title>
    <link rel="stylesheet" href="/tokens.css" />
    <link rel="stylesheet" href="/styles.css" />
  </head>
  <body>
    <main class="starter">
      <p class="eyebrow">New tool</p>
      <h1>${escapeHtml(input.name)}</h1>
      <p class="idea">${escapeHtml(input.idea).replace(/\n+/g, '<br />')}</p>
      <p class="status">Your agent is building this tool. Reload this page when it says it is done.</p>
    </main>
  </body>
</html>
`
}

/** Aliases cover profiles named in Shelf's vocabulary and common alternatives. */
const STYLES_CSS = `:root {
  --bg: var(--color-surface, var(--color-background, var(--color-bg, #f7f7f8)));
  --card: var(--color-panel, var(--color-card, #ffffff));
  --ink: var(--color-ink, var(--color-text, #1b1d22));
  --muted: var(--color-muted, var(--color-text-muted, #5c6470));
  --line: var(--color-line, var(--color-border, #dcdfe5));
  --brand: var(--color-brand, var(--color-primary, var(--color-accent, #3d5ce0)));
  --font: var(--typography-font-family-app, var(--typography-font-family-body, ui-sans-serif, system-ui, sans-serif));
  --font-display: var(--typography-font-family-display, var(--font));
  color-scheme: light dark;
}

* { box-sizing: border-box; }

body {
  margin: 0;
  min-height: 100vh;
  background: var(--bg);
  color: var(--ink);
  font-family: var(--font);
  line-height: 1.55;
}

.starter {
  max-width: 640px;
  margin: 12vh auto;
  padding: 32px;
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 16px;
}

.eyebrow {
  margin: 0 0 8px;
  color: var(--brand);
  font-size: 0.8rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

h1 {
  margin: 0 0 12px;
  font-family: var(--font-display);
  font-size: 1.9rem;
  line-height: 1.2;
}

.idea { margin: 0 0 20px; }

.status {
  margin: 0;
  padding-top: 16px;
  border-top: 1px solid var(--line);
  color: var(--muted);
}
`

const NEUTRAL_TOKENS_CSS = `/* No design profile was chosen: calm neutral defaults for both modes. */
:root {
  --color-surface: #f7f7f8;
  --color-panel: #ffffff;
  --color-ink: #1b1d22;
  --color-muted: #5c6470;
  --color-line: #dcdfe5;
  --color-brand: #3d5ce0;
}

@media (prefers-color-scheme: dark) {
  :root {
    --color-surface: #0f1218;
    --color-panel: #171b24;
    --color-ink: #eef0f5;
    --color-muted: #9aa3b5;
    --color-line: #2a3140;
    --color-brand: #8aa0ff;
  }
}
`

/**
 * Token values that are plainly design values: colors, lengths, numbers,
 * font-family lists, and keywords. Everything else is skipped, not escaped:
 * a profile can be agent-written, and CSS has too many ways to reach the
 * network (url, image-set, @import) or break out of a declaration.
 */
const SAFE_COLOR = /^(?:#[0-9a-f]{3,8}|(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch)\([0-9a-z.,%\s/+-]{1,80}\))$/i
const SAFE_LENGTH = /^-?(?:\d+|\d*\.\d+)(?:px|rem|em|%|vh|vw|vmin|vmax|ch|ex|pt|ms|s|deg|fr)?$/i
const SAFE_KEYWORD = /^[a-z][a-z-]{0,40}$/i
const SAFE_FONT_LIST = /^(?:\s*(?:"[a-z0-9 _-]{1,60}"|'[a-z0-9 _-]{1,60}'|[a-z][a-z0-9 _-]{0,60})\s*)(?:,(?:\s*(?:"[a-z0-9 _-]{1,60}"|'[a-z0-9 _-]{1,60}'|[a-z][a-z0-9 _-]{0,60})\s*))*$/i

function safeCssValue(raw: unknown): string | null {
  if (typeof raw !== 'string' && typeof raw !== 'number') return null
  const value = String(raw).trim()
  if (!value || value.length > 200) return null
  return [SAFE_COLOR, SAFE_LENGTH, SAFE_KEYWORD, SAFE_FONT_LIST].some((pattern) => pattern.test(value)) ? value : null
}

/** A safe CSS custom-property declaration, or nothing. */
function cssDeclaration(token: FlatToken): string | null {
  const name = token.path.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  const value = safeCssValue(token.value)
  return name && value ? `  --${name}: ${value};` : null
}

function declarations(tokens: FlatToken[]): string {
  return tokens.map(cssDeclaration).filter(Boolean).join('\n')
}

/** The profile's tokens as CSS variables, with its light and dark overrides. */
export function tokensCss(profile?: DesignProfile): string {
  if (!profile) return NEUTRAL_TOKENS_CSS
  const base = declarations(flattenTokens(profile.tokens || {}))
  const light = declarations(flattenTokens(profile.modes?.light || {}))
  const dark = declarations(flattenTokens(profile.modes?.dark || {}))
  return [
    // No profile text in the file: a name is free text, and a comment is
    // one crafted "*/" away from a live rule. DESIGN.md names the profile.
    '/* From your Shelf design profile. DESIGN.md has the details. */',
    `:root {\n${base}\n}`,
    light ? `@media (prefers-color-scheme: light) {\n  :root {\n${light.replace(/^/gm, '  ')}\n  }\n}` : '',
    dark ? `@media (prefers-color-scheme: dark) {\n  :root {\n${dark.replace(/^/gm, '  ')}\n  }\n}` : '',
  ].filter(Boolean).join('\n\n') + '\n'
}

function summarize(idea: string): string {
  const first = idea.split(/(?<=[.!?])\s|\n/)[0]?.trim() || idea.trim()
  return first.length > 200 ? `${first.slice(0, 197).trimEnd()}…` : first
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function isDirectory(target: string): boolean {
  try { return fs.statSync(target).isDirectory() } catch { return false }
}

function isEmptyDirectory(target: string): boolean {
  if (!isDirectory(target)) return false
  return fs.readdirSync(target).every((entry) => entry === '.DS_Store')
}

/**
 * The MCP `new-tool` prompt: the same recipe for an agent that starts from a
 * chat instead of the desktop. The agent creates the folder itself and ends
 * with shelf_register_project, so the user still accepts the draft in Shelf.
 */
export function buildNewToolPrompt(input: {
  idea: string
  name?: string
  port: number
  toolsRoot: string
  profile?: DesignProfile
}): string {
  const name = input.name?.trim()
  const folder = path.join(input.toolsRoot, name ? folderNameFor(name) : '<Tool Name>')
  const steps = [
    `Build a new local tool for the user's Shelf library.`,
    '',
    '## Set up',
    '',
    `1. Create the folder \`${folder}\`${name ? '' : ' (choose a short, title-case name)'}. It must be new or empty.`,
    `2. Use port ${input.port}. It is free and no tool in the user's library claims it. If it is taken by the time you start, call \`shelf_find_free_port\`.`,
    input.profile
      ? `3. Call \`shelf_get_design_profile\` with id \`${input.profile.id}\` ("${input.profile.name}", the user's default) and save its brief as DESIGN.md. Put its color and font tokens in \`public/tokens.css\` as CSS variables.`
      : '3. No design profile is set up. Use calm, neutral styling with light and dark modes.',
    '4. Save the brief below as AGENTS.md in the folder, then build the tool it describes.',
    '',
    '---',
    '',
  ]
  return steps.join('\n') + agentsBrief({
    name: name || '<Tool Name>',
    idea: input.idea.trim(),
    port: input.port,
    launchCommand: 'node server.mjs',
    profile: input.profile,
  })
}
