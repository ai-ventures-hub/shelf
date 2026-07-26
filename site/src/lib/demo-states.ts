/**
 * Prepared landing-demo states — deterministic, no live Shelf/MCP.
 * Phase 2 can drive these via a client state machine.
 */

export type DemoToolStatus = 'Added' | 'Ready' | 'Starting' | 'Running' | 'Stopped'

export type DemoTool = {
  id: string
  name: string
  command: string
  port: number
  tags: string[]
  notes: string
  status: DemoToolStatus
  logLine?: string
}

export const IMAGE_PREPPER: DemoTool = {
  id: 'image-prepper',
  name: 'Image Prepper',
  command: 'npm run dev -- --port 4173',
  port: 4173,
  tags: ['Image', 'Utility'],
  notes: 'Resize and optimize client photos before upload.',
  status: 'Running',
  logLine: 'Ready on http://127.0.0.1:4173',
}

export const DEMO_AGENT_MESSAGES = [
  {
    role: 'user' as const,
    text: 'I finished building the image-preparation tool.',
  },
  {
    role: 'agent' as const,
    text: 'I found its launch command, detected port 4173, tagged it as Image and Utility, and added it to Shelf.',
  },
  {
    role: 'agent' as const,
    text: 'Shelf shows Image Prepper as Running — same library you see in the app.',
  },
]

export const DEMO_LIBRARY: DemoTool[] = [
  IMAGE_PREPPER,
  {
    id: 'wp-manager',
    name: 'Local WordPress Manager',
    command: 'docker compose up',
    port: 8080,
    tags: ['WordPress', 'Client'],
    notes: 'Spin up a local WP stack for client previews.',
    status: 'Ready',
  },
  {
    id: 'doc-converter',
    name: 'Document Converter',
    command: '.venv/bin/python convert.py',
    port: 0,
    tags: ['Docs', 'Utility'],
    notes: 'Batch convert PDFs to markdown.',
    status: 'Stopped',
  },
]

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
