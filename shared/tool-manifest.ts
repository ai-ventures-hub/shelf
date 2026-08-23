/**
 * Tool Sharing (1.2) — the `shelf.json` manifest that travels with a project.
 *
 * Two hard rules, both enforced here and nowhere else:
 *
 * 1. A manifest carries an env SCHEMA (keys + human hints), never values.
 *    `buildManifest` constructs `env` from the tool's KEYS only; the value
 *    side is a hint string that is itself refused if it looks like a
 *    credential or equals the stored value. There is no code path from
 *    `tool.env[key]` into the file.
 * 2. A manifest is UNTRUSTED INPUT. `normalizeManifest` turns arbitrary JSON
 *    into a bounded, display-safe record: nothing in it executes on parse,
 *    commands are preserved verbatim (minus control characters) so the
 *    consent sheet shows exactly what will run, env hints are never used as
 *    values, `url` must be loopback, and `name` is additionally reduced to a
 *    folder-safe form for the destination path.
 */
import fs from 'node:fs'
import path from 'node:path'
import { containsLikelySecret, normalizeAgentAccess } from './capability-intelligence'
import { normalizeCapabilities } from './capability-intelligence'
import { urlForPort } from './ports'
import type { AgentAccess, Tool } from './types'

export const MANIFEST_FILENAME = 'shelf.json'
export const MANIFEST_VERSION = 1 as const

/** The on-disk manifest. Unknown fields are preserved on read (see `extra`). */
export interface ToolManifest {
  shelfManifest: typeof MANIFEST_VERSION
  name: string
  description?: string
  /** Relative to the project root; rendered verbatim on the consent sheet. */
  launchCommand: string
  port?: number
  /** Loopback template; port-rewritten on receive by the existing healing. */
  url?: string
  tags: string[]
  capabilities: string[]
  agentAccess: AgentAccess[]
  /** Setup the receiver must consent to before anything runs. Verbatim. */
  bootstrap: string[]
  /** Env SCHEMA: key → human hint. Never a value. */
  env: Record<string, string>
  notes?: string
  exportedBy?: string
  exportedAt?: string
  /** Fields this Shelf does not understand, carried through untouched. */
  extra?: Record<string, unknown>
}

export interface NormalizedManifest {
  manifest: ToolManifest
  /** Plain-language notes about fields that were dropped or altered. */
  warnings: string[]
}

export type ManifestExportResult =
  | { ok: true; manifest: ToolManifest }
  | { ok: false; reason: string }

const KNOWN_FIELDS = new Set([
  'shelfManifest',
  'name',
  'description',
  'launchCommand',
  'port',
  'url',
  'tags',
  'capabilities',
  'agentAccess',
  'bootstrap',
  'env',
  'notes',
  'exportedBy',
  'exportedAt',
])

const MAX_NAME = 80
const MAX_DESCRIPTION = 500
const MAX_COMMAND = 500
const MAX_NOTES = 2000
const MAX_HINT = 200
const MAX_TAGS = 20
const MAX_CAPABILITIES = 40
const MAX_BOOTSTRAP = 10
const MAX_ENV_KEYS = 50
const MAX_AGENT_ACCESS = 10
const MAX_MANIFEST_BYTES = 256 * 1024

const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/

/** Strip C0/C1 control characters (keeps \n and \t when `multiline`). */
function stripControl(value: string, multiline = false): string {
  return multiline
    ? value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, '')
    : value.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
}

function cleanText(value: unknown, max: number, multiline = false): string | undefined {
  if (typeof value !== 'string') return undefined
  const cleaned = stripControl(value, multiline).trim()
  if (!cleaned) return undefined
  return cleaned.length > max ? cleaned.slice(0, max) : cleaned
}

function cleanList(value: unknown, max: number, itemMax: number): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  for (const item of value) {
    const cleaned = cleanText(item, itemMax)
    if (cleaned) out.push(cleaned)
    if (out.length >= max) break
  }
  return out
}

/**
 * Folder-safe form of a manifest name for `~/Shelf Tools/<name>`: no path
 * separators, no dot-leading segments, no traversal — a name can never pick
 * the destination's parent.
 */
export function folderNameFor(name: string): string {
  const cleaned = stripControl(name)
    // Conservative charset: the name also appears in paths we hand to git
    // and to the shell's cwd, so keep it boring — letters, digits, space,
    // dot, underscore, hyphen. Everything else collapses to a hyphen.
    .replace(/[^\p{L}\p{N} ._-]+/gu, '-')
    .replace(/\.{2,}/g, '.')
    .replace(/-{2,}/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.\-]+|[\s.\-]+$/g, '')
    .trim()
  const safe = cleaned || 'shared-tool'
  return safe.length > 64 ? safe.slice(0, 64).replace(/[\s.\-]+$/, '') || 'shared-tool' : safe
}

function portOfUrl(value: string): number | undefined {
  try {
    // Only an explicit port is meaningful here — a bare loopback url means
    // "whatever port this ends up on", not literally 80/443.
    const parsed = new URL(value)
    return parsed.port ? Number(parsed.port) : undefined
  } catch {
    return undefined
  }
}

function isLoopbackUrl(value: string): boolean {
  try {
    const parsed = new URL(value)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
    const host = parsed.hostname.toLowerCase()
    return (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '0.0.0.0' ||
      host === '[::1]' ||
      host === '::1'
    )
  } catch {
    return false
  }
}

/**
 * Parse + normalize untrusted manifest JSON. Throws only for "not a Shelf
 * manifest at all" (wrong shape/version); every other problem is repaired
 * and reported in `warnings` so the consent sheet can say what was dropped.
 */
export function normalizeManifest(raw: unknown): NormalizedManifest {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('shelf.json is not a JSON object.')
  }
  const input = raw as Record<string, unknown>
  if (input.shelfManifest !== MANIFEST_VERSION) {
    throw new Error(
      `Unsupported manifest version (${String(input.shelfManifest)}). This Shelf reads shelfManifest: ${MANIFEST_VERSION}.`,
    )
  }
  const warnings: string[] = []

  const name = cleanText(input.name, MAX_NAME)
  if (!name) warnings.push('The manifest has no usable name; the folder name is used instead.')

  const launchCommand = cleanText(input.launchCommand, MAX_COMMAND)
  if (!launchCommand) {
    warnings.push('The manifest has no launch command; Shelf will detect one from the project.')
  }

  let port: number | undefined
  if (input.port !== undefined) {
    const n = typeof input.port === 'number' ? input.port : Number(input.port)
    if (Number.isInteger(n) && n >= 1 && n <= 65535) port = n
    else warnings.push(`Ignored an invalid port (${String(input.port)}).`)
  }

  let url: string | undefined
  if (input.url !== undefined) {
    const candidate = cleanText(input.url, 300)
    if (candidate && isLoopbackUrl(candidate)) url = candidate
    else if (candidate) {
      warnings.push(`Ignored the manifest URL (${candidate}) — only localhost URLs are allowed.`)
    }
  }
  // port and url must agree: the launch path opens `url` as soon as `port`
  // answers, so a url on a different loopback port would hit whatever is
  // listening there. Derive the missing half; rewrite a mismatch.
  if (url) {
    const urlPort = portOfUrl(url)
    if (!port && urlPort) port = urlPort
    else if (port && urlPort !== port) {
      url = urlForPort(url, port)
      warnings.push(`The manifest URL pointed at a different port; it now follows port ${port}.`)
    }
  }

  const tags = cleanList(input.tags, MAX_TAGS, 40)
  const capabilities = normalizeCapabilities(cleanList(input.capabilities, MAX_CAPABILITIES, 120))

  // Agent access metadata goes through the same normalizer the store uses;
  // a single bad entry (credential in a note, non-http endpoint) is dropped
  // rather than failing the whole manifest.
  const agentAccess: AgentAccess[] = []
  if (Array.isArray(input.agentAccess)) {
    for (const entry of input.agentAccess.slice(0, MAX_AGENT_ACCESS)) {
      if (!entry || typeof entry !== 'object') continue
      const e = entry as Record<string, unknown>
      const kind = e.kind
      if (kind !== 'cli' && kind !== 'mcp' && kind !== 'http-api') {
        warnings.push('Dropped an agent access entry with an unknown kind.')
        continue
      }
      const transport =
        e.transport === 'stdio' || e.transport === 'streamable-http' ? e.transport : undefined
      try {
        const [normalized] = normalizeAgentAccess([
          {
            id: '',
            kind,
            entrypoint: cleanText(e.entrypoint, MAX_COMMAND) || '',
            transport,
            setupRequired: Boolean(e.setupRequired),
            notes: cleanText(e.notes, MAX_NOTES, true),
          },
        ])
        agentAccess.push(normalized)
      } catch (err) {
        warnings.push(
          `Dropped an agent access entry: ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    }
  }

  const bootstrapRaw = Array.isArray(input.bootstrap) ? input.bootstrap : []
  const bootstrap = cleanList(bootstrapRaw, MAX_BOOTSTRAP, MAX_COMMAND)
  if (bootstrapRaw.length > MAX_BOOTSTRAP) {
    warnings.push(`Only the first ${MAX_BOOTSTRAP} setup commands are shown; the rest were dropped.`)
  }

  // Env: keys must be identifiers; the value side is a HINT. A hint that
  // looks like a credential is the "value smuggled into env" case — discard
  // it. Hints are never used as values anywhere (inputs start empty).
  const env: Record<string, string> = {}
  if (input.env && typeof input.env === 'object' && !Array.isArray(input.env)) {
    for (const [key, hint] of Object.entries(input.env as Record<string, unknown>)) {
      if (Object.keys(env).length >= MAX_ENV_KEYS) {
        warnings.push(`Only the first ${MAX_ENV_KEYS} env keys are shown.`)
        break
      }
      if (!ENV_KEY.test(key)) {
        warnings.push(`Dropped env key “${stripControl(key).slice(0, 40)}” (not a valid variable name).`)
        continue
      }
      const cleaned = cleanText(hint, MAX_HINT) || ''
      if (cleaned && containsLikelySecret(cleaned)) {
        warnings.push(`The hint for ${key} looked like a credential and was discarded.`)
        env[key] = ''
      } else if (cleaned && !/\s/.test(cleaned) && containsLikelySecret(`${key}=${cleaned}`)) {
        // A secret-named key whose "hint" is one bare token reads as KEY=value
        // — that is a value, not a hint. Prose hints (with spaces) are fine.
        warnings.push(`The hint for ${key} looked like a value and was discarded.`)
        env[key] = ''
      } else {
        env[key] = cleaned
      }
    }
  }

  const extra: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input)) {
    if (!KNOWN_FIELDS.has(key)) extra[key] = value
  }

  return {
    manifest: {
      shelfManifest: MANIFEST_VERSION,
      name: name || '',
      description: cleanText(input.description, MAX_DESCRIPTION, true),
      launchCommand: launchCommand || '',
      port,
      url,
      tags,
      capabilities,
      agentAccess,
      bootstrap,
      env,
      notes: cleanText(input.notes, MAX_NOTES, true),
      exportedBy: cleanText(input.exportedBy, 60),
      exportedAt: cleanText(input.exportedAt, 40),
      ...(Object.keys(extra).length > 0 ? { extra } : {}),
    },
    warnings,
  }
}

/** Read + normalize `<projectPath>/shelf.json`; null when absent. */
export function readManifest(projectPath: string): NormalizedManifest | null {
  const file = path.join(projectPath, MANIFEST_FILENAME)
  let stat: fs.Stats
  try {
    stat = fs.lstatSync(file)
  } catch {
    return null
  }
  // A symlinked shelf.json in a cloned repo could point anywhere on the
  // receiver's disk; refuse rather than read through it.
  if (stat.isSymbolicLink()) throw new Error('shelf.json is a symlink; Shelf only reads a regular file.')
  if (stat.isDirectory()) throw new Error('shelf.json is a directory, not a file.')
  if (!stat.isFile()) return null
  if (stat.size > MAX_MANIFEST_BYTES) {
    throw new Error(`shelf.json is too large (${Math.ceil(stat.size / 1024)} KB).`)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    // Parser messages quote the file's text — keep it out of the sheet.
    throw new Error('shelf.json is not valid JSON.')
  }
  return normalizeManifest(parsed)
}

/**
 * Build the manifest for a tool. Env values are stripped STRUCTURALLY: only
 * keys are iterated; the hint comes from the previous manifest (so a sender
 * can hand-edit hints and keep them) and is refused when it equals the
 * stored value or looks like a credential. Refuses outright when any
 * free-text field trips containsLikelySecret — same policy as agent-access
 * metadata and design profiles.
 */
export function buildManifest(
  tool: Tool,
  opts: { appVersion: string; previous?: ToolManifest | null; now?: string },
): ManifestExportResult {
  const freeText: Array<[string, string | undefined]> = [
    ['name', tool.name],
    ['description', tool.description],
    ['launch command', tool.launchCommand],
    ['notes', tool.notes],
    ...tool.tags.map((t): [string, string] => ['tags', t]),
    ...tool.capabilities.map((c): [string, string] => ['capabilities', c]),
    ...tool.agentAccess.flatMap((a): Array<[string, string | undefined]> => [
      ['agent access entrypoint', a.entrypoint],
      ['agent access notes', a.notes],
    ]),
  ]
  for (const [label, text] of freeText) {
    if (text && containsLikelySecret(text)) {
      return {
        ok: false,
        reason: `The ${label} looks like it contains a credential. Move secrets into Environment variables (only their names are shared) and try again.`,
      }
    }
  }
  if (tool.launchCommand && /(^|\s)[A-Za-z_][A-Za-z0-9_]*=\S+/.test(tool.launchCommand)) {
    // KEY=value prefixes in the command are the same secret in another
    // pocket (1.1.1 adjacent-field lesson). PORT=… is operational, allow it.
    const assignments = tool.launchCommand.match(/(^|\s)([A-Za-z_][A-Za-z0-9_]*)=\S+/g) || []
    const risky = assignments.filter(
      (a) => !/^\s*(PORT|HOST|HOSTNAME|NODE_ENV|DEBUG|CI|TZ|LANG|LC_ALL|FORCE_COLOR)=/i.test(a),
    )
    if (risky.length > 0) {
      return {
        ok: false,
        reason: `The launch command sets ${risky
          .map((a) => a.trim().split('=')[0])
          .join(', ')} inline. Move it into Environment variables (only names are shared) and try again.`,
      }
    }
  }

  const env: Record<string, string> = {}
  const previousEnv = opts.previous?.env || {}
  for (const key of Object.keys(tool.env || {})) {
    if (!ENV_KEY.test(key)) continue
    const storedValue = tool.env?.[key] ?? ''
    const hint = (previousEnv[key] || '').trim()
    const hintSafe =
      hint &&
      hint !== storedValue &&
      !(storedValue && hint.includes(storedValue)) &&
      !containsLikelySecret(hint)
    env[key] = hintSafe ? hint : ''
  }

  const manifest: ToolManifest = {
    shelfManifest: MANIFEST_VERSION,
    name: tool.name,
    description: tool.description,
    launchCommand: tool.launchCommand,
    port: tool.port,
    url: tool.url && isLoopbackUrl(tool.url) ? tool.url : undefined,
    tags: tool.tags.slice(),
    capabilities: tool.capabilities.slice(),
    agentAccess: tool.agentAccess.map((a) => ({
      id: '',
      kind: a.kind,
      entrypoint: a.entrypoint,
      transport: a.transport,
      setupRequired: a.setupRequired,
      notes: a.notes,
    })),
    bootstrap: opts.previous?.bootstrap?.slice() || [],
    env,
    notes: tool.notes,
    exportedBy: `Shelf ${opts.appVersion}`,
    exportedAt: opts.now || new Date().toISOString(),
    ...(opts.previous?.extra ? { extra: opts.previous.extra } : {}),
  }
  // Unknown fields carried from a previous manifest must meet the same bar —
  // scan the whole subtree, not just top-level strings.
  if (manifest.extra && containsLikelySecret(JSON.stringify(manifest.extra))) {
    return {
      ok: false,
      reason: 'An extra field in the existing shelf.json looks like it contains a credential. Remove it and try again.',
    }
  }
  return { ok: true, manifest }
}

/** Serialize for disk: known fields in a stable order, extras spread last. */
export function serializeManifest(manifest: ToolManifest): string {
  const { extra, agentAccess, ...known } = manifest
  const ordered: Record<string, unknown> = {
    shelfManifest: known.shelfManifest,
    name: known.name,
    ...(known.description ? { description: known.description } : {}),
    launchCommand: known.launchCommand,
    ...(known.port ? { port: known.port } : {}),
    ...(known.url ? { url: known.url } : {}),
    tags: known.tags,
    capabilities: known.capabilities,
    agentAccess: agentAccess.map(({ id: _id, ...rest }) => rest),
    bootstrap: known.bootstrap,
    env: known.env,
    ...(known.notes ? { notes: known.notes } : {}),
    ...(known.exportedBy ? { exportedBy: known.exportedBy } : {}),
    ...(known.exportedAt ? { exportedAt: known.exportedAt } : {}),
    ...(extra || {}),
  }
  return `${JSON.stringify(ordered, null, 2)}\n`
}

/** Write `<projectPath>/shelf.json`; returns the manifest path. */
export function writeManifest(projectPath: string, manifest: ToolManifest): string {
  const file = path.join(projectPath, MANIFEST_FILENAME)
  fs.writeFileSync(file, serializeManifest(manifest), 'utf8')
  return file
}

export interface ManifestFieldDiff {
  field: string
  before?: string
  after?: string
}

function show(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (Array.isArray(value)) return value.length ? value.join(', ') : undefined
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
    return entries.length ? entries.map(([k, v]) => (v ? `${k} (${String(v)})` : k)).join(', ') : undefined
  }
  return String(value)
}

/** Human-readable field diff for the update sheet (comparison only). */
export function diffManifests(
  before: ToolManifest | null,
  after: ToolManifest | null,
): ManifestFieldDiff[] {
  const fields: Array<keyof ToolManifest> = [
    'name',
    'description',
    'launchCommand',
    'port',
    'url',
    'tags',
    'capabilities',
    'bootstrap',
    'env',
    'notes',
  ]
  const diffs: ManifestFieldDiff[] = []
  for (const field of fields) {
    const a = show(before?.[field])
    const b = show(after?.[field])
    if (a !== b) diffs.push({ field, before: a, after: b })
  }
  const accessBefore = (before?.agentAccess || [])
    .map((x) => `${x.kind}${x.transport ? `/${x.transport}` : ''}: ${x.entrypoint}`)
    .join(', ')
  const accessAfter = (after?.agentAccess || [])
    .map((x) => `${x.kind}${x.transport ? `/${x.transport}` : ''}: ${x.entrypoint}`)
    .join(', ')
  if (accessBefore !== accessAfter) {
    diffs.push({ field: 'agentAccess', before: accessBefore || undefined, after: accessAfter || undefined })
  }
  return diffs
}
