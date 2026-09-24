/**
 * Static narrative-section data for the landing beats.
 * Server-only: imported by server components exclusively, so none of this
 * rides into the client bundle (interactive mocks have their own module,
 * landing-demos.ts).
 */

export type PillTone = 'accent' | 'success' | 'warning' | 'neutral' | 'danger'

/** #how — the three numbered cards under the real product recording. */
export const HOW_CARDS = [
  {
    n: '01',
    title: 'Drop a folder',
    body: 'A site, a script, or a Docker stack.',
  },
  {
    n: '02',
    title: 'You approve the command',
    body: 'Shelf suggests how it runs. Nothing installs until you accept.',
  },
  {
    n: '03',
    title: 'It stays found',
    body: 'Launch it again next month. Your agents can find it too.',
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
  readiness: string
  readinessTone: PillTone
  action: string
}[]

/** #share — the Tool Sharing proof points (1.2). */
export const SHARE_POINTS = [
  {
    title: 'Secrets never travel',
    body: 'Key names only. Values stay on your Mac.',
  },
  {
    title: 'One consent sheet',
    body: 'The command is on the sheet. Nothing runs before you approve.',
  },
  {
    title: 'Git carries it',
    body: 'A link to the repo you already use. No Shelf account.',
  },
  {
    title: 'Updates you approve',
    body: 'You see the diff. Shelf never pulls it for you.',
  },
] as const satisfies readonly { title: string; body: string }[]

/** #share — rows of the static consent-sheet mock (label + value + kind). */
export const SHARE_SHEET_ROWS = [
  { label: 'Source', value: 'github.com/your-team/image-prepper', kind: 'path' },
  { label: 'Folder', value: '~/Shelf Tools/Image Prepper', kind: 'path' },
  { label: 'Will run first', value: 'npm install', kind: 'cmd' },
  { label: 'Launch', value: 'npm run dev', kind: 'cmd' },
  { label: 'OPENAI_API_KEY', value: 'you fill this in, stays on your Mac', kind: 'env' },
] as const satisfies readonly {
  label: string
  value: string
  kind: 'path' | 'cmd' | 'env'
}[]

/** #collections — the agent-built collections proof points (1.3). */
export const COLLECTION_POINTS = [
  {
    title: 'Agents draft. You decide.',
    body: 'It arrives marked From agent. One edit makes it yours.',
  },
  {
    title: 'Start in order',
    body: 'Each port answers before the next command. A missing key stops the rest.',
  },
  {
    title: 'Or start together',
    body: 'Launch every member at once. Tools already running stay up.',
  },
  {
    title: 'Delete the list, keep the tools',
    body: 'The collection is a name. The tools stay in the library.',
  },
] as const satisfies readonly { title: string; body: string }[]

/** #collections — member rows of the static collection-page mock. */
export const COLLECTION_ROWS = [
  { letter: 'S', name: 'Script Room', line: ':5174 · npm run dev' },
  { letter: 'V', name: 'Voice Bench', line: ':8000 · uvicorn app:app' },
  { letter: 'R', name: 'Render Queue', line: 'one-shot · node render.js' },
] as const satisfies readonly { letter: string; name: string; line: string }[]

/**
 * #share — the Team Tools band (1.4). Stage 2 of sharing: rows of a team
 * catalog as the pane renders them. `state` drives the right-hand chip, and
 * the claim under the rows (a pointer, never a command or a key) is the whole
 * reason a catalog is safe to subscribe to.
 */
export const TEAM_ROWS = [
  {
    name: 'Image Prepper',
    detail: 'batch-optimize images',
    state: 'Install',
    tone: 'action',
  },
  {
    name: 'Doc Converter',
    detail: 'convert documents',
    state: 'On your shelf',
    tone: 'quiet',
  },
  {
    name: 'Render Queue',
    detail: 'render video jobs',
    state: 'Install',
    tone: 'action',
  },
] as const satisfies readonly {
  name: string
  detail: string
  state: string
  tone: 'action' | 'quiet'
}[]
