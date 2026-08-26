/**
 * Fixture data for the interactive landing mocks (hero shelf, app showcase,
 * mode toggle). Client-safe pure data — importable from both
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
  'docker compose up … which folder?',
  'source .venv/bin/activate ???',
] as const

/** #app — showcase tabs, in pill order. Default active tab is 'mcp'. */
export type AppTabId = 'library' | 'gaps' | 'register' | 'share' | 'design' | 'mcp'
export const APP_TABS = [
  { id: 'library', label: 'Library' },
  { id: 'gaps', label: 'Capability gaps' },
  { id: 'register', label: 'Register a tool' },
  { id: 'share', label: 'Share a tool' },
  { id: 'design', label: 'Design profiles' },
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

/**
 * #design — brand-switcher presets. The hex values here are demo CONTENT
 * (the design tokens being shown), applied as inline custom properties on
 * the demo surface — the same mechanism the app's own live preview uses.
 * Site chrome around the demo stays on --av-* tokens; the "no inline
 * colors" rule governs chrome, not the tokens a token demo demonstrates.
 */
export type BrandPresetId = 'shelf' | 'verdant' | 'klaxon'

export const BRAND_PRESETS = [
  {
    id: 'shelf',
    name: 'Shelf',
    badge: 'Default',
    swatches: ['#090d16', '#131a2b', '#526fdd', '#9aafff', '#f7f8fc'],
    fontLabel: 'Archivo · 800 / tight',
    voiceLine: 'Plain words. Honest states. No ceremony.',
    source: 'design-profiles.json · default profile',
    cssVars: {
      '--be-bg': '#090d16',
      '--be-surface': '#131a2b',
      '--be-ink': '#f7f8fc',
      '--be-muted': '#99a3b8',
      '--be-brand': '#526fdd',
      '--be-on-brand': '#f2f5ff',
      '--be-line': '#26304a',
      '--be-radius': '12px',
      '--be-font': 'var(--av-font-display)',
      '--be-hw': '800',
      '--be-ht': '-0.02em',
      '--be-tt': 'none',
    },
  },
  {
    id: 'verdant',
    name: 'Verdant',
    badge: 'Approved',
    swatches: ['#f4f0e6', '#fdfbf4', '#2d4a34', '#b4552d', '#5a5348'],
    fontLabel: 'Georgia · serif / roman',
    voiceLine: 'Slow growth is still growth.',
    source: 'seeded from the CSS variables your project already declares, nothing guessed',
    cssVars: {
      '--be-bg': '#f4f0e6',
      '--be-surface': '#fdfbf4',
      '--be-ink': '#2d4a34',
      '--be-muted': '#5a5348',
      '--be-brand': '#b4552d',
      '--be-on-brand': '#fdfbf4',
      '--be-line': '#ddd5c2',
      '--be-radius': '16px',
      '--be-font': "Georgia, 'Times New Roman', serif",
      '--be-hw': '400',
      '--be-ht': '-0.01em',
      '--be-tt': 'none',
    },
  },
  {
    id: 'klaxon',
    name: 'Klaxon',
    badge: 'Approved',
    swatches: ['#0c0d10', '#16181d', '#d8f34e', '#f2f2ef', '#7a7f8a'],
    fontLabel: 'JetBrains Mono · 700 / caps',
    voiceLine: 'Louder than your roadmap.',
    source: 'drafted by your agent from a screenshot, reviewed, then saved',
    cssVars: {
      '--be-bg': '#0c0d10',
      '--be-surface': '#16181d',
      '--be-ink': '#f2f2ef',
      '--be-muted': '#7a7f8a',
      '--be-brand': '#d8f34e',
      '--be-on-brand': '#0c0d10',
      '--be-line': '#2a2d34',
      '--be-radius': '4px',
      '--be-font': 'var(--av-font-mono)',
      '--be-hw': '700',
      '--be-ht': '0.04em',
      '--be-tt': 'uppercase',
    },
  },
] as const satisfies readonly {
  id: BrandPresetId
  name: string
  badge: string
  swatches: readonly string[]
  fontLabel: string
  voiceLine: string
  source: string
  cssVars: Readonly<Record<string, string>>
}[]

/** #dev — mode-toggle mock rows. `dim` renders at .55 opacity (the "tucked away" cue). */
export const MODE_ROWS = {
  simple: [
    { label: 'AI Connections', meta: 'Claude · Cursor connected', tone: 'success' },
    { label: 'portfolio-site', meta: 'Running · Open', tone: 'success' },
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

/**
 * #app — Share tab: the shelf.json Share writes beside the project. Keys are
 * the real manifest fields (shared/tool-manifest.ts), and `env` carries a
 * HINT, never a value — the whole point of the tab, so don't "improve" that
 * line into something that looks like a key.
 */
export const SHARE_MANIFEST_LINES = [
  { text: '{' },
  { key: 'shelfManifest', val: '1,' },
  { key: 'name', val: '"Image Prepper",' },
  { key: 'launchCommand', val: '"npm run dev -- --port 4173",' },
  { key: 'port', val: '4173,' },
  { key: 'capabilities', val: '["batch-optimize images"],' },
  { key: 'bootstrap', val: '["npm install"],' },
  { key: 'env', val: '{ "OPENAI_API_KEY": "your own key" }' },
  { text: '}' },
] as const satisfies readonly ({ text: string } | { key: string; val: string })[]
