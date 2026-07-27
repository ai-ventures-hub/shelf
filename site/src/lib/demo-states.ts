/**
 * Prepared landing-demo states — deterministic, no live Shelf/MCP.
 * Five beats matching the redesign canvas: import → launch → capability
 * match → gap → readiness scan. Copy is the canvas script, verbatim.
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
  /** 0 = one-shot script with no port. */
  port: number
  status: DemoToolStatus
  readiness: DemoReadiness
}

export type DemoGap = {
  task: string
  reason: string
}

/** Interactive / auto-tour beats visitors can jump to via chips. */
export type DemoBeatId = 'import' | 'launch' | 'capability' | 'gap' | 'ready'

export type DemoBeat = {
  id: DemoBeatId
  /** Chip label (visitor-facing prompt). */
  chip: string
  /** The YOU message. */
  user: string
  /** The AGENT reply. */
  agent: string
  tools: DemoTool[]
  /** Warning card in the Shelf panel, when the ask has no match. */
  gap: DemoGap | null
  /** Callout band under the Shelf header. */
  shelfNote: string
}

export const READINESS_LABEL: Record<DemoReadiness, string> = {
  ready: 'Agent-ready',
  needs_setup: 'Needs setup',
  manual_only: 'Manual only',
  unavailable: 'Unavailable',
}

const WP_MANAGER: DemoTool = {
  id: 'wp-manager',
  name: 'Local WordPress Manager',
  command: 'docker compose up',
  port: 8080,
  status: 'Ready',
  // Process can start; agent MCP entrypoint still needs setup.
  readiness: 'needs_setup',
}

const DOC_CONVERTER: DemoTool = {
  id: 'doc-converter',
  name: 'Document Converter',
  command: '.venv/bin/python convert.py',
  port: 0,
  status: 'Stopped',
  readiness: 'manual_only',
}

const PDF_GAP: DemoGap = {
  task: 'Fill PDF forms',
  reason: 'No tool declares this capability — recorded, deduped.',
}

function library(imageStatus: DemoToolStatus): DemoTool[] {
  return [
    {
      id: 'image-prepper',
      name: 'Image Prepper',
      command: 'npm run dev -- --port 4173',
      port: 4173,
      status: imageStatus,
      readiness: 'ready',
    },
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
  'ready',
]

export const DEMO_BEATS: Record<DemoBeatId, DemoBeat> = {
  import: {
    id: 'import',
    chip: 'Add the tool I just built',
    user: 'I finished the image-preparation tool. Add it to Shelf.',
    agent:
      'Found npm run dev on port 4173, tagged it Image · Utility, declared batch-optimize images, and shelved it.',
    tools: library('Added'),
    gap: null,
    shelfNote: 'Smart import — same library your agents share.',
  },
  launch: {
    id: 'launch',
    chip: 'Launch Image Prepper',
    user: 'Launch Image Prepper.',
    agent: 'Launched — Running on :4173. That is process status, not agent readiness.',
    tools: library('Running'),
    gap: null,
    shelfNote: 'Running = process up. Agent-ready = declared access.',
  },
  capability: {
    id: 'capability',
    chip: 'What can optimize images?',
    user: 'What can batch-optimize images?',
    agent:
      'Matched Image Prepper — declares batch-optimize images, readiness ready (CLI). Explainable match, no proxying.',
    tools: library('Running'),
    gap: null,
    shelfNote: 'Capability match — discovery only, scores explainable.',
  },
  gap: {
    id: 'gap',
    chip: 'Can anything fill PDF forms?',
    user: 'Can anything fill PDF forms?',
    agent:
      'Nothing declares that capability. Recorded one deduped row in Capability Gaps so it becomes a plan.',
    tools: library('Running'),
    gap: PDF_GAP,
    shelfNote: 'Unmet needs stay local in capability-gaps.json.',
  },
  ready: {
    id: 'ready',
    chip: 'Which tools are agent-ready?',
    user: 'Which tools are ready for agents?',
    agent:
      'Image Prepper is agent-ready. WordPress Manager needs setup. Document Converter is manual-only.',
    tools: library('Running'),
    gap: PDF_GAP,
    shelfNote: 'Honest readiness — not every Running tool is agent-ready.',
  },
}
