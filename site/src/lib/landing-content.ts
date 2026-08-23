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

/** #design — the proof points under the lead. */
export const DESIGN_POINTS = [
  {
    title: 'Extracted from your code.',
    body: 'Point Shelf at a project and it reads the tokens already there — CSS variables, Tailwind config. Deterministic: nothing guessed, skips reported.',
  },
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


/** #share — the Tool Sharing proof points (1.2). */
export const SHARE_POINTS = [
  {
    title: 'Secrets never travel.',
    body: 'Share writes the setup — launch command, port, capabilities, even which env keys are needed. Only the names. There is no code path that can put a value in the file.',
  },
  {
    title: 'One consent sheet.',
    body: 'Your coworker sees the exact commands, the destination folder, and an input for each key before anything happens. A link never runs anything on its own.',
  },
  {
    title: 'Your git host is the transport.',
    body: 'A shelf:// link points at the repo you already use — or send a bundle. No Shelf server, no account, no registry. Same promise as everything else here.',
  },
  {
    title: 'Updates you approve.',
    body: 'Check for updates shows the incoming commits and the manifest diff. You pull when you want; a diverged copy is said plainly. Never automatic.',
  },
] as const satisfies readonly { title: string; body: string }[]

/** #share — rows of the static consent-sheet mock (label + value + kind). */
export const SHARE_SHEET_ROWS = [
  { label: 'Source', value: 'github.com/your-team/image-prepper', kind: 'path' },
  { label: 'Folder', value: '~/Shelf Tools/Image Prepper', kind: 'path' },
  { label: 'Will run first', value: 'npm install', kind: 'cmd' },
  { label: 'Launch', value: 'npm run dev', kind: 'cmd' },
  { label: 'OPENAI_API_KEY', value: 'you fill this in — stays on your Mac', kind: 'env' },
] as const satisfies readonly {
  label: string
  value: string
  kind: 'path' | 'cmd' | 'env'
}[]
