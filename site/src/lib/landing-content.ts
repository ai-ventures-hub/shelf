/**
 * Static narrative-section data for the landing beats.
 * Server-only: imported by server components exclusively, so none of this
 * rides into the client bundle (interactive mocks have their own module,
 * landing-demos.ts).
 */

export type PillTone = 'accent' | 'success' | 'warning' | 'neutral' | 'danger'

/** #how — the three numbered cards under the drop-demo window. */
export const HOW_CARDS = [
  {
    n: '01',
    title: 'Drop a folder',
    body: 'Anything your AI tool built — a Next.js site, a Python script, a Docker stack.',
  },
  {
    n: '02',
    title: 'Shelf reads the setup',
    body: 'Launch command, packages, ports — detected, fixed when busy, remembered forever.',
  },
  {
    n: '03',
    title: 'It runs — and stays found',
    body: 'One click to launch, always. Your AI tools can find and use it too.',
  },
] as const

/** Honest cards — process status and agent access, separately. */
export const HONEST_CARDS = [
  {
    id: 'image-prepper',
    letter: 'I',
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
    letter: 'L',
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
    letter: 'D',
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
  letter: string
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

/**
 * #agents — the chat vignette. A bubble is a list of parts so the one
 * highlighted phrase ("portfolio-site is running") can carry its own tone.
 */
export const CHAT_BUBBLES = [
  { role: 'user', parts: [{ text: 'Launch my portfolio site' }] },
  {
    role: 'agent',
    parts: [
      { text: 'Done — ' },
      { text: 'portfolio-site is running', tone: 'success' },
      { text: '. Opened it in your browser.' },
    ],
  },
  { role: 'user', parts: [{ text: 'What do I have that resizes images?' }] },
  {
    role: 'agent',
    parts: [{ text: 'Image Prepper on your shelf does batch resizing — it’s ready to use.' }],
  },
] as const satisfies readonly {
  role: 'user' | 'agent'
  parts: readonly { text: string; tone?: 'success' }[]
}[]

/** #design — the three proof points under the lead. */
export const DESIGN_POINTS = [
  {
    title: 'DTCG tokens.',
    body: 'Standard design-token JSON — colors, type, radius — any agent can consume.',
  },
  {
    title: 'A brief agents can read.',
    body: 'A markdown brand brief rides along: voice, personality, the rules that don’t fit in a hex code.',
  },
  {
    title: 'Drafts you approve.',
    body: 'Your agent can extract a brand it saw and save a draft. You review. Agents never set the default.',
  },
] as const satisfies readonly { title: string; body: string }[]
