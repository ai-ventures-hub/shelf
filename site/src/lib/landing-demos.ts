/**
 * Fixture data for the interactive landing mocks (hero shelf, drop-demo loop,
 * app showcase, mode toggle). Client-safe pure data — importable from both
 * server and client components; anything a client component needs lives here
 * so landing-content.ts can stay server-only.
 */

/** Tone tokens resolved to colors by CSS ([data-tone] rules). */
export type DemoTone = 'success' | 'accent' | 'warning' | 'muted'

/** Hero — the five shelf tiles. */
export const HERO_TILES = [
  { letter: 'P', name: 'portfolio-site', state: '● Running', tone: 'success', edge: 'success' },
  { letter: 'I', name: 'Image Prepper', state: '● Running', tone: 'success', edge: 'neutral' },
  { letter: 'W', name: 'wp-preview', state: 'Ready', tone: 'accent', edge: 'neutral' },
  { letter: 'C', name: 'csv-de-duper', state: 'One-shot', tone: 'muted', edge: 'neutral' },
  { letter: '+', name: 'yours next', state: 'drop a folder', tone: 'muted', edge: 'neutral', flat: true },
] as const satisfies readonly {
  letter: string
  name: string
  state: string
  tone: DemoTone
  edge: 'success' | 'neutral'
  flat?: boolean
}[]

/** Hero — drifting graveyard filenames (positions/drift live in CSS nth-child rules). */
export const HERO_FILENAMES = [
  'pdf-batch-thing/',
  'npm run dev … which port?',
  'csv-de-duper.py',
  '~/Downloads/client-resizer-v1',
  'docker compose up — which folder?',
  'source .venv/bin/activate ???',
] as const

/** #how — drop-demo loop: the titlebar label per phase. */
export const DROP_PHASE_LABELS = [
  'Waiting for a drop',
  'Understanding the project',
  'Getting it ready',
  'Running',
] as const

/** #how — phase 1 project-scan rows. */
export const SCAN_ROWS = [
  { left: 'package.json', right: '✓ Next.js · npm', tone: 'success' },
  { left: 'launch', right: '✓ npm run dev', tone: 'success' },
  { left: 'port 3000', right: 'busy → moved to 3001', tone: 'warning' },
] as const satisfies readonly { left: string; right: string; tone: DemoTone }[]

/** #app — showcase tabs, in pill order. Default active tab is 'mcp'. */
export type AppTabId = 'library' | 'gaps' | 'register' | 'mcp'
export const APP_TABS = [
  { id: 'library', label: 'Library' },
  { id: 'gaps', label: 'Capability gaps' },
  { id: 'register', label: 'Register a tool' },
  { id: 'mcp', label: 'MCP Connections' },
] as const satisfies readonly { id: AppTabId; label: string }[]

/** #app — sidebar LIBRARY rows; active row follows the tab (library→All tools, gaps→Capability gaps). */
export const SIDE_LIBRARY = [
  { name: 'All tools', n: 5 },
  { name: 'Favorites', n: 0 },
  { name: 'Running', n: 1 },
  { name: 'Recent', n: 5 },
  { name: 'Capability gaps', n: 1 },
] as const

/** #app — Library tab cards. */
export const LIB_CARDS = [
  { letter: 'P', name: 'portfolio-site', cmd: 'npm run dev · :3001', pill: '● Running', tone: 'success', edge: 'success' },
  { letter: 'I', name: 'Image Prepper', cmd: 'npm run dev · :4173', pill: 'Ready', tone: 'accent', edge: 'neutral' },
  { letter: 'W', name: 'wp-manager', cmd: 'docker compose up · :8080', pill: 'Stopped', tone: 'muted', edge: 'neutral' },
  { letter: 'D', name: 'doc-converter', cmd: 'python convert.py · one-shot', pill: 'Manual', tone: 'muted', edge: 'neutral' },
] as const satisfies readonly {
  letter: string
  name: string
  cmd: string
  pill: string
  tone: DemoTone
  edge: 'success' | 'neutral'
}[]

/** #app — Capability gaps tab rows. */
export const GAP_ROWS = [
  { task: 'Fill PDF forms', reason: 'no tool declares this capability', count: '×3' },
  { task: 'Transcribe meeting audio', reason: 'recorded in capability-gaps.json · deduped', count: '×1' },
] as const

/** #app — Register-a-tool suggestion sheet. */
export const IMPORT_FIELDS = [
  { label: 'NAME', value: 'Image Prepper', mono: false, tone: 'default' },
  { label: 'LAUNCH', value: 'npm run dev -- --port 4173', mono: true, tone: 'default' },
  { label: 'PORT', value: '4173', mono: true, tone: 'default' },
  { label: 'TAGS', value: 'image · utility', mono: false, tone: 'default' },
  { label: 'CAPABILITIES', value: 'batch-optimize images', mono: false, tone: 'accent' },
  { label: 'AGENT ACCESS', value: 'CLI · ready', mono: false, tone: 'accent' },
  { label: 'PACKAGE', value: 'npm', mono: true, tone: 'default' },
  { label: 'DESIGN.MD', value: 'Detected', mono: false, tone: 'success' },
] as const satisfies readonly {
  label: string
  value: string
  mono: boolean
  tone: 'default' | 'accent' | 'success'
}[]

/**
 * The four one-click MCP clients (0.7.0), in card order for the MCP
 * Connections tab. `chip` is the short label used by the #agents chips
 * (chip order lives in AgentChat: Claude Code first).
 *
 * Logo provenance (mirrors src/assets/clients/README.md in the app repo):
 * - claude.svg — Claude glyph from claude.ai/favicon.svg (Anthropic)
 * - claude-code.png — Claude Code product icon (Anthropic VS Code Marketplace)
 * - cursor.svg — CUBE_2D_DARK from cursor.com/brand (Anysphere)
 * - codex.svg — OpenAI monoblossom, white recolor per OpenAI brand guidance
 * All marks are property of their respective owners; used to indicate
 * compatibility only.
 */
export const MCP_CLIENTS = [
  { id: 'claude-desktop', name: 'Claude Desktop', chip: 'Claude Desktop', logo: '/logos/claude.svg' },
  { id: 'claude-code', name: 'Claude Code', chip: 'Claude Code', logo: '/logos/claude-code.png' },
  { id: 'cursor', name: 'Cursor', chip: 'Cursor', logo: '/logos/cursor.svg' },
  { id: 'codex', name: 'OpenAI Codex', chip: 'Codex', logo: '/logos/codex.svg' },
] as const

export type McpClientId = (typeof MCP_CLIENTS)[number]['id']

/** #dev — mode-toggle mock rows. `dim` renders at .55 opacity (the "tucked away" cue). */
export const MODE_ROWS = {
  simple: [
    { label: 'AI Connections', meta: 'Claude · Cursor connected', tone: 'success' },
    { label: 'portfolio-site', meta: 'Running — Open', tone: 'success' },
    { label: 'History', meta: 'launched 2h ago', tone: 'muted' },
    { label: 'Advanced details', meta: 'tucked away, still saved', tone: 'muted', dim: true },
  ],
  developer: [
    { label: 'MCP Connections', meta: 'server.js · stdio', tone: 'accent' },
    { label: 'portfolio-site', meta: 'npm run dev -- --port 3001', tone: 'muted' },
    { label: 'Capability intelligence', meta: 'batch-optimize · CLI ready', tone: 'success' },
    { label: 'Capability gaps', meta: 'capability-gaps.json · 2', tone: 'warning' },
  ],
} as const satisfies Record<
  'simple' | 'developer',
  readonly { label: string; meta: string; tone: DemoTone; dim?: boolean }[]
>
