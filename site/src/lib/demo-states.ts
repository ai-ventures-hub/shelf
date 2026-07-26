/**
 * Prepared landing-demo states — deterministic, no live Shelf/MCP.
 * Phase 2 state machine: import → launch → capability match → gap inbox.
 */

/** Process lifecycle (distinct from agent readiness). */
export type DemoToolStatus = 'Added' | 'Ready' | 'Starting' | 'Running' | 'Stopped'

/**
 * Mirror shared/capability-intelligence readiness vocabulary.
 * Running ≠ agent-ready.
 */
export type DemoReadiness = 'ready' | 'needs_setup' | 'manual_only' | 'unavailable'

export type DemoTool = {
  id: string
  name: string
  command: string
  port: number
  tags: string[]
  notes: string
  status: DemoToolStatus
  /** Task phrases agents match via shelf_find_capability. */
  capabilities: string[]
  readiness: DemoReadiness
  logLine?: string
}

export type DemoGap = {
  id: string
  task: string
  capabilities: string[]
  reason: string
  occurrenceCount: number
  status: 'open'
}

export type DemoChatMessage = {
  role: 'user' | 'agent'
  text: string
}

/** Interactive / auto-tour beats visitors can jump to via chips. */
export type DemoBeatId =
  | 'import'
  | 'launch'
  | 'capability'
  | 'gap'
  | 'ready-scan'
  | 'running'

export type DemoBeat = {
  id: DemoBeatId
  /** Chip label (visitor-facing prompt). */
  chip: string
  messages: DemoChatMessage[]
  tools: DemoTool[]
  /** Highlighted tool card, if any. */
  featuredToolId: string | null
  /** Capability Gaps inbox rows (deduped). */
  gaps: DemoGap[]
  /** Optional callout under the Shelf header. */
  shelfNote?: string
}

export const READINESS_LABEL: Record<DemoReadiness, string> = {
  ready: 'Agent-ready',
  needs_setup: 'Needs setup',
  manual_only: 'Manual only',
  unavailable: 'Unavailable',
}

const IMAGE_PREPPER_BASE: Omit<DemoTool, 'status' | 'logLine'> = {
  id: 'image-prepper',
  name: 'Image Prepper',
  command: 'npm run dev -- --port 4173',
  port: 4173,
  tags: ['Image', 'Utility'],
  notes: 'Resize and optimize client photos before upload.',
  capabilities: ['batch-optimize images', 'resize client photos'],
  readiness: 'ready',
}

const WP_MANAGER: DemoTool = {
  id: 'wp-manager',
  name: 'Local WordPress Manager',
  command: 'docker compose up',
  port: 8080,
  tags: ['WordPress', 'Client'],
  notes: 'Spin up a local WP stack for client previews.',
  status: 'Ready',
  capabilities: ['preview WordPress sites'],
  // Process can start; agent MCP entrypoint still needs setup.
  readiness: 'needs_setup',
}

const DOC_CONVERTER: DemoTool = {
  id: 'doc-converter',
  name: 'Document Converter',
  command: '.venv/bin/python convert.py',
  port: 0,
  tags: ['Docs', 'Utility'],
  notes: 'Batch convert PDFs to markdown.',
  status: 'Stopped',
  capabilities: ['convert PDFs to markdown'],
  readiness: 'manual_only',
}

const PDF_GAP: DemoGap = {
  id: 'gap-fill-pdf',
  task: 'Fill PDF forms',
  capabilities: ['fill PDF forms'],
  reason: 'No tool declares this capability.',
  occurrenceCount: 1,
  status: 'open',
}

function library(
  imageStatus: DemoToolStatus,
  logLine?: string,
): DemoTool[] {
  return [
    { ...IMAGE_PREPPER_BASE, status: imageStatus, logLine },
    WP_MANAGER,
    DOC_CONVERTER,
  ]
}

/** Ordered auto-tour — Capability Intelligence visible within ~20s. */
export const DEMO_BEAT_ORDER: DemoBeatId[] = [
  'import',
  'launch',
  'capability',
  'gap',
  'ready-scan',
]

export const DEMO_BEATS: Record<DemoBeatId, DemoBeat> = {
  import: {
    id: 'import',
    chip: 'Add the tool I just built.',
    messages: [
      {
        role: 'user',
        text: 'I finished building the image-preparation tool.',
      },
      {
        role: 'agent',
        text: 'I found its launch command, detected port 4173, tagged it as Image and Utility, and added it to Shelf.',
      },
    ],
    tools: library('Added'),
    featuredToolId: 'image-prepper',
    gaps: [],
    shelfNote: 'Smart import — same library your agents share.',
  },
  launch: {
    id: 'launch',
    chip: 'Launch Image Prepper.',
    messages: [
      { role: 'user', text: 'Launch Image Prepper.' },
      {
        role: 'agent',
        text: 'Launched. Shelf shows Running — the process is listening on 4173. That is process status, not agent readiness.',
      },
    ],
    tools: library('Running', 'Ready on http://127.0.0.1:4173'),
    featuredToolId: 'image-prepper',
    gaps: [],
    shelfNote: 'Running = process up. Agent-ready = declared access.',
  },
  capability: {
    id: 'capability',
    chip: 'What Shelf tool can optimize images?',
    messages: [
      { role: 'user', text: 'What can batch-optimize images?' },
      {
        role: 'agent',
        text: 'Matched Image Prepper via shelf_find_capability — capabilities: batch-optimize images. Readiness: ready (CLI declared). Score explainable; no child-MCP proxy.',
      },
    ],
    tools: library('Running', 'Ready on http://127.0.0.1:4173'),
    featuredToolId: 'image-prepper',
    gaps: [],
    shelfNote: 'Capability match + readiness pill — discovery only.',
  },
  gap: {
    id: 'gap',
    chip: 'Record a gap if nothing can fill PDF forms.',
    messages: [
      { role: 'user', text: 'Can anything fill PDF forms?' },
      {
        role: 'agent',
        text: 'No matching capability. Recorded a deduped row in Capability Gaps so you can plan the next tool.',
      },
    ],
    tools: library('Running', 'Ready on http://127.0.0.1:4173'),
    featuredToolId: null,
    gaps: [PDF_GAP],
    shelfNote: 'Unmet needs stay local in capability-gaps.json.',
  },
  'ready-scan': {
    id: 'ready-scan',
    chip: 'Which tools are ready for agents?',
    messages: [
      { role: 'user', text: 'Which tools are ready for agents?' },
      {
        role: 'agent',
        text: 'Image Prepper is agent-ready. WordPress Manager needs setup. Document Converter is manual-only — launchable by you, no agent interface declared.',
      },
    ],
    tools: library('Running', 'Ready on http://127.0.0.1:4173'),
    featuredToolId: 'image-prepper',
    gaps: [PDF_GAP],
    shelfNote: 'Honest readiness — not every Running tool is agent-ready.',
  },
  running: {
    id: 'running',
    chip: 'Which tools are currently running?',
    messages: [
      { role: 'user', text: 'Which tools are currently running?' },
      {
        role: 'agent',
        text: 'Image Prepper is Running on :4173. Local WordPress Manager is Ready but not started. Process status stays separate from agent readiness.',
      },
    ],
    tools: library('Running', 'Ready on http://127.0.0.1:4173'),
    featuredToolId: 'image-prepper',
    gaps: [],
    shelfNote: 'Truthful process status from the shared library.',
  },
}

/** Chips shown under the demo (prepared states only). */
export const DEMO_PROMPT_CHIPS: { beatId: DemoBeatId; label: string }[] = [
  { beatId: 'import', label: DEMO_BEATS.import.chip },
  { beatId: 'launch', label: DEMO_BEATS.launch.chip },
  { beatId: 'capability', label: DEMO_BEATS.capability.chip },
  { beatId: 'gap', label: DEMO_BEATS.gap.chip },
  { beatId: 'ready-scan', label: DEMO_BEATS['ready-scan'].chip },
  { beatId: 'running', label: DEMO_BEATS.running.chip },
]

/** @deprecated Prefer DEMO_BEATS — kept for narrative static examples. */
export const IMAGE_PREPPER: DemoTool = {
  ...IMAGE_PREPPER_BASE,
  status: 'Running',
  logLine: 'Ready on http://127.0.0.1:4173',
}

export const DEMO_LIBRARY: DemoTool[] = library(
  'Running',
  'Ready on http://127.0.0.1:4173',
)

export const EXAMPLE_TOOLS = [
  { name: 'Image Prepper', blurb: 'Resize and optimize client photos.' },
  { name: 'Local WordPress Manager', blurb: 'Docker Compose preview stacks.' },
  { name: 'Document Converter', blurb: 'PDF batches to markdown.' },
  { name: 'Screenshot Auditor', blurb: 'Capture and annotate UI diffs.' },
  { name: 'Client Intake Processor', blurb: 'Normalize form exports.' },
  { name: 'Development Proxy', blurb: 'Local HTTPS front for APIs.' },
  { name: 'Mini Documentary Engine', blurb: 'Assemble short cuts from clips.' },
  { name: 'Data Cleanup Utility', blurb: 'Deduplicate messy CSVs.' },
] as const

export const IMPORT_SUGGESTIONS = [
  { label: 'Name', value: 'Image Prepper' },
  { label: 'Launch', value: 'npm run dev -- --port 4173' },
  { label: 'Port', value: '4173' },
  { label: 'Tags', value: 'Image · Utility' },
  { label: 'Capabilities', value: 'batch-optimize images' },
  { label: 'Agent access', value: 'CLI · ready' },
  { label: 'Package', value: 'npm' },
  { label: 'DESIGN.md', value: 'Detected' },
] as const

export const GRAVEYARD_ITEMS = [
  'Forgotten npm run dev',
  'Which .venv was it?',
  'Port already in use',
  'docker compose… where?',
  '~/Projects/old-tools/…',
  'Rebuilt it last month',
] as const
