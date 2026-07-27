/**
 * Static narrative-section data for the landing beats.
 * Server-only: imported by server components exclusively, so none of this
 * rides into the client bundle (the demo has its own module, demo-states.ts).
 */

export type PillTone = 'accent' | 'success' | 'warning' | 'neutral' | 'danger'

/** Beat 02 — the tool graveyard ledger. */
export const LEDGER_ROWS = [
  {
    name: 'pdf-batch-thing',
    seen: 'March, maybe',
    ritual: 'npm run dev (port unknown)',
    status: 'Unknown',
    tone: 'neutral',
    shelved: false,
  },
  {
    name: 'client-photo-resizer v1',
    seen: 'Rebuilt as v2 instead',
    ritual: 'some .venv incantation',
    status: 'Unknown',
    tone: 'neutral',
    shelved: false,
  },
  {
    name: 'wp preview stack',
    seen: 'Two clients ago',
    ritual: 'docker compose up — which folder?',
    status: 'Unknown',
    tone: 'neutral',
    shelved: false,
  },
  {
    name: 'csv de-duper',
    seen: 'It’s in ~/Downloads somewhere',
    ritual: 'python cleanup.py …flags?',
    status: 'Unknown',
    tone: 'neutral',
    shelved: false,
  },
  {
    name: 'Image Prepper',
    seen: 'On the shelf',
    ritual: 'one click · npm run dev · :4173',
    status: 'Agent-ready',
    tone: 'success',
    shelved: true,
  },
] as const satisfies readonly {
  name: string
  seen: string
  ritual: string
  status: string
  tone: PillTone
  shelved: boolean
}[]

/** Beat 03 — smart import steps and the suggestion sheet. */
export const IMPORT_STEPS = [
  {
    n: '01',
    title: 'Choose a project folder',
    sub: 'Or drop it on the window',
    raised: false,
  },
  {
    n: '02',
    title: 'Shelf scans and suggests',
    sub: 'Scripts, ports, package manager, DESIGN.md',
    raised: true,
  },
  {
    n: '03',
    title: 'Accept what looks right',
    sub: 'The tool lives in your library',
    raised: false,
  },
] as const

export const IMPORT_FIELDS = [
  { label: 'NAME', value: 'Image Prepper', mono: false, hi: false },
  { label: 'LAUNCH', value: 'npm run dev -- --port 4173', mono: true, hi: false },
  { label: 'PORT', value: '4173', mono: true, hi: false },
  { label: 'TAGS', value: 'image · utility', mono: false, hi: false },
  { label: 'CAPABILITIES', value: 'batch-optimize images', mono: false, hi: true },
  { label: 'AGENT ACCESS', value: 'CLI · ready', mono: false, hi: true },
  { label: 'PACKAGE', value: 'npm', mono: true, hi: false },
  { label: 'DESIGN.MD', value: 'Detected', mono: false, hi: false },
] as const

/** Beat 04 — honest cards: process status and agent access, separately. */
export const HONEST_CARDS = [
  {
    id: 'image-prepper',
    name: 'Image Prepper',
    status: 'Running',
    statusTone: 'success',
    edge: 'success',
    line: ':4173 · Ready on http://127.0.0.1:4173',
    body: 'Port answering and agent access declared. The only card where both facts are green.',
    readiness: 'Agent-ready',
    readinessTone: 'success',
    action: 'Open · Logs · Stop',
  },
  {
    id: 'wp-manager',
    name: 'Local WordPress Manager',
    status: 'Ready',
    statusTone: 'neutral',
    edge: 'neutral',
    line: ':8080 · docker compose up',
    body: 'Starts fine when you ask. Agents cannot reach it yet — the MCP entrypoint needs setup.',
    readiness: 'Needs setup',
    readinessTone: 'warning',
    action: 'Start · Configure',
  },
  {
    id: 'doc-converter',
    name: 'Document Converter',
    status: 'Stopped',
    statusTone: 'neutral',
    edge: 'neutral',
    line: 'one-shot · .venv/bin/python convert.py',
    body: 'A one-shot script with no port. Launchable by you; never advertised to agents.',
    readiness: 'Manual only',
    readinessTone: 'neutral',
    action: 'Run once',
  },
] as const satisfies readonly {
  id: string
  name: string
  status: string
  statusTone: PillTone
  edge: 'success' | 'neutral'
  line: string
  body: string
  readiness: string
  readinessTone: PillTone
  action: string
}[]

/** Beat 06 — hub diagram: the shelf rows and connected clients. */
export const HUB_SHELF_ROWS = [
  { name: 'image-prepper', state: 'running :4173', live: true },
  { name: 'wp-manager', state: 'ready :8080', live: false },
  { name: 'doc-converter', state: 'manual only', live: false },
] as const

export const HUB_CLIENTS = [
  { mono: 'C', name: 'Claude Desktop' },
  { mono: 'Cu', name: 'Cursor' },
  { mono: 'Cx', name: 'OpenAI Codex' },
] as const

/** Beat 07 — the local-first receipt. */
export const RECEIPT_FILES = [
  { name: 'library.json', note: 'your tools' },
  { name: 'capability-gaps.json', note: 'unmet needs' },
  { name: 'run-receipts/', note: 'what launched, when' },
] as const

export const RECEIPT_FACTS = [
  { name: 'cloud account', note: 'none' },
  { name: 'secrets in logs', note: 'masked' },
  { name: 'root required', note: 'no' },
  { name: 'license', note: 'MIT, complete without a subscription' },
] as const
