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
    body: 'Anything your AI tool built: a Next.js site, a Python script, a Docker stack.',
  },
  {
    n: '02',
    title: 'Shelf reads the setup',
    body: 'Shelf finds the launch command, installs the packages, moves the port when it’s busy, and remembers all of it.',
  },
  {
    n: '03',
    title: 'It runs, and stays found',
    body: 'One click to launch, today and next month. Your AI tools can find it too.',
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
    body: 'Starts fine when you ask. Agents can’t reach it yet, because the MCP entrypoint needs setup.',
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
    body: 'A one-shot script with no port. You can run it. Agents never see it.',
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

/** #design — the proof points under the lead. */
export const DESIGN_POINTS = [
  {
    title: 'Extracted from your code.',
    body: 'Point Shelf at a project and it reads the tokens already there, from CSS variables and Tailwind config. It guesses nothing, and tells you what it skipped.',
  },
  {
    title: 'DTCG tokens.',
    body: 'Standard design-token JSON: colors, type, radius. Any agent can read it.',
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
    body: 'Share writes the setup: launch command, port, capabilities, even which env keys the tool needs. Only the names. No code path can put a value in the file.',
  },
  {
    title: 'One consent sheet.',
    body: 'Your coworker sees the exact commands, the destination folder, and an input for each key before anything happens. A link never runs anything on its own.',
  },
  {
    title: 'Your git host is the transport.',
    body: 'A shelf:// link points at the repo you already use. Or send a bundle. No Shelf server, no account, no registry. Same promise as everything else here.',
  },
  {
    title: 'Updates you approve.',
    body: 'Check for updates shows the incoming commits and the manifest diff. You pull when you want. If your copy has drifted, Shelf says so instead of guessing. Never automatic.',
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
    body: 'Anything an agent builds arrives marked From agent. Edit it once in Shelf and it belongs to you, and agents can’t change it after that, by id or by name. They never attach a design profile to one either.',
  },
  {
    title: 'A collection grants nothing new.',
    body: 'It’s a named list of tools your agent could already see and launch. Delete the collection and every tool in it stays exactly where it was.',
  },
  {
    title: 'No look-alike names.',
    body: 'A name that differs from one of yours only by an invisible character, an accent form, spacing, or case is refused, and Shelf strips invisible characters out of every name it stores.',
  },
  {
    title: 'One button starts the stack.',
    body: 'Start stack brings up every tool in the collection at once and leaves the ones already running alone. Stop stack takes them down together.',
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
