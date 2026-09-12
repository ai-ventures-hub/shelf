export type {
  AgentAccess,
  AgentAccessKind,
  AppearanceMode,
  CapabilityGap,
  CapabilityGapExample,
  CapabilityGapStatus,
  CapabilityReadinessState,
  Collection,
  DesignAsset,
  DesignAssetKind,
  DesignMdResult,
  DesignProfile,
  DesignToken,
  DesignTokenGroup,
  LaunchAlternative,
  LaunchErrorCode,
  LaunchOrigin,
  LaunchOriginKind,
  LogLine,
  McpTransport,
  OnboardingSubmission,
  OnboardingSubmissionInput,
  ProjectImportSuggestion,
  ReceiptOutcome,
  RemedyKind,
  RunReceipt,
  SortMode,
  Tool,
  ToolHealth,
  ToolReadiness,
  ToolRuntimeState,
  ToolSource,
  ToolStatus,
  UiMode,
  UiPrefs,
  ViewMode,
} from './contracts'
import type {
  AgentAccessKind,
  CapabilityGap,
  Collection,
  DesignProfile,
  LaunchOrigin,
  McpTransport,
  RunReceipt,
  Tool,
  ToolReadiness,
  UiPrefs,
} from './contracts'
/** Shared tool and process types for Electron, MCP, and smokes. */

import { DEFAULT_GLOBAL_SHORTCUT } from './global-shortcut'

/** Sanitized copy of a declared access method, safe for agent-facing output. */
export interface AgentAccessSummary {
  kind: AgentAccessKind
  transport?: McpTransport
  entrypoint: string
  setupRequired: boolean
}

export interface CapabilityMatch {
  toolId: string
  name: string
  capabilities: string[]
  accessKinds: AgentAccessKind[]
  readiness: ToolReadiness
  /** Declared access methods, sanitized — how an agent connects to the tool itself. */
  access: AgentAccessSummary[]
  score: number
  reasons: string[]
  /** 'manual_use' is deprecated and no longer emitted; kept for old readers. */
  suggestedAction: 'launch' | 'configure' | 'manual_use'
  /** How the tool is used once running: driven by agents or through its own UI. */
  interaction: 'agent_direct' | 'human_ui'
}

export { isDesignToken } from './design-tokens'

export interface DesignProfilesFile {
  version: 1
  profiles: DesignProfile[]
}

export interface ReceiptsFile {
  version: 1
  receipts: RunReceipt[]
}

export interface CapabilityGapsFile {
  version: 1
  gaps: CapabilityGap[]
}

/** Current on-disk library schema (v1/v2 migrate to v3 on read). */
export interface LibraryFile {
  version: 3
  tools: Tool[]
  collections: Collection[]
}

export const DEFAULT_UI_PREFS: UiPrefs = {
  appearance: 'system',
  viewMode: 'grid',
  sort: 'name',
  uiMode: 'developer',
  sidebarWidth: 250,
  sidebarCollapsed: false,
  defaultIconLucide: 'Box',
  defaultIconColor: '#ffffff',
  defaultIconBackground: '#3b82f6',
  menuBarEnabled: true,
  closeToMenuBar: true,
  launchAtLogin: false,
  globalShortcutEnabled: true,
  globalShortcut: DEFAULT_GLOBAL_SHORTCUT,
}

/**
 * Human label for a launch origin. Client names are self-reported by MCP
 * clients, so map known ids (most specific first) and fall back to the raw
 * name. `externalUnknown` covers adopted runs whose receipt predates startedBy.
 */
const MCP_CLIENT_LABELS: Array<[string, string]> = [
  ['claude-code', 'Claude Code'],
  ['claude-desktop', 'Claude Desktop'],
  ['claude-ai', 'Claude'],
  ['claude', 'Claude'],
  ['cursor', 'Cursor'],
  ['codex', 'Codex'],
  ['windsurf', 'Windsurf'],
  ['vscode', 'VS Code'],
  ['zed', 'Zed'],
]

export function launchOriginLabel(
  origin?: LaunchOrigin,
  opts: { externalUnknown?: boolean } = {},
): string | null {
  if (!origin) return opts.externalUnknown ? 'Another agent' : null
  if (origin.kind === 'gui' || origin.kind === 'tray') return 'You'
  const raw = (origin.client || '').trim()
  if (!raw) return 'Agent'
  const key = raw.toLowerCase()
  for (const [id, label] of MCP_CLIENT_LABELS) {
    if (key === id || key.includes(id)) return label
  }
  return raw
}

/**
 * Bare credentials carrying a recognizable vendor prefix — a pasted token
 * needs no KEY= assignment to be a leak. Case-sensitive on purpose: the
 * prefixes are exact vendor formats, and an `i` flag would let ordinary
 * words swallow the entropy tails. containsLikelySecret (refusal) must stay
 * at least as broad as this masking.
 */
export const BARE_SECRET_SOURCE = [
  // Hyphenated tails must demand digits, or kebab-case identifiers
  // (sk-color-brand-primary, xoxb-like-token-name) read as credentials —
  // real vendor keys always carry digits; design-token names rarely do.
  'sk-(?=[A-Za-z0-9_-]*\\d[A-Za-z0-9_-]*\\d)[A-Za-z0-9_-]{20,}', // OpenAI / Anthropic style
  'sk_(?:live|test)_[A-Za-z0-9]{16,}', // Stripe
  'gh[pousr]_[A-Za-z0-9]{36,}', // GitHub tokens
  'github_pat_[A-Za-z0-9_]{22,}',
  'xox[baprs]-(?=[A-Za-z0-9-]*\\d)[A-Za-z0-9-]{10,}', // Slack
  'npm_[A-Za-z0-9]{36,}',
  '(?:AKIA|ASIA)[0-9A-Z]{16}', // AWS access key ids
  'eyJ[A-Za-z0-9_-]{10,}\\.eyJ[A-Za-z0-9_-]{6,}\\.[A-Za-z0-9_-]{10,}', // JWT
  '-----BEGIN [A-Z ]*PRIVATE KEY-----',
].join('|')

/**
 * Boundary for BARE_SECRET_SOURCE. NOT `\b`: `\b` needs a word char before
 * `-----BEGIN`, so a PEM block after a newline/space would never match, and
 * `^` alone only covers index 0. The lookbehind also rejects `--sk-…` CSS
 * custom-property references outright.
 */
export const BARE_SECRET_BOUNDARY = '(?<![\\w-])'

/**
 * Control, zero-width, and bidi characters that can hide inside a display
 * name. Stripped before a name is stored so nothing renders invisibly in the
 * sidebar, and before it is folded for comparison.
 */
const INVISIBLE_CHARS =
  /[\p{Cc}\p{Cf}\p{Co}\p{Cs}\u00AD\u034F\u115F\u1160\u17B4\u17B5\u180B-\u180E\u2800\u3164\uFE00-\uFE0F\uFFA0\uFFF9-\uFFFB\u{E0100}-\u{E01EF}]/gu

export function stripInvisibleChars(value: string): string {
  return value.replace(INVISIBLE_CHARS, '')
}

/**
 * Fold a display name for OWNERSHIP comparisons (agent write paths).
 * Case and whitespace alone are not enough: an agent could otherwise create
 * "Client Prod\u200B" beside the user's "Client Prod" — indistinguishable in
 * the sidebar, and one click away from launching the wrong stack. NFKC
 * reconciles composed/decomposed forms, and dropping Latin combining marks
 * closes the accent look-alikes (Café/Cafe, İstanbul/Istanbul). It does NOT
 * close homoglyphs — Cyrillic "Асmе" still folds distinctly from "Acme";
 * catching those needs script-mixing detection, which is its own feature.
 * Deliberately aggressive:
 * this only ever makes an agent's create/rename fail closed with guidance,
 * and never restricts what the user can name something in the GUI.
 */
export function foldDisplayName(name: string): string {
  return stripInvisibleChars(name.normalize('NFKC'))
    .toLowerCase()
    .normalize('NFD')
    // Latin combining marks ONLY. Stripping every \p{M} also collapsed
    // ガ/カ, हिन्दी/हनद, שָׁלוֹם/שלום and كِتاب/كتاب, which made an agent's own
    // draft silently retarget a different one for non-Latin names.
    .replace(/[\u0300-\u036F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Env keys whose values are operational, not secret. */
const SAFE_ENV_KEYS = /^(PORT|HOST|HOSTNAME|NODE_ENV|DEBUG|CI|TZ|LANG|LC_ALL|FORCE_COLOR)$/i
const ASSIGNMENT_VALUE = `(?:"(?:\\\\.|[^"\\\\])*"|'[^']*'|[^\\s]+)`

/** One output boundary for logs, commands, history, URLs, and diagnostics. */
export function maskSecrets(text: string, knownValues: readonly string[] = []): string {
  let safe = text
  for (const value of [...new Set(knownValues)].filter(Boolean).sort((a, b) => b.length - a.length)) {
    safe = safe.split(value).join('***')
  }
  return safe
    .replace(new RegExp(`\\b([A-Z][A-Z0-9_]{2,})\\s*=\\s*${ASSIGNMENT_VALUE}`, 'g'),
      (whole, key: string) => SAFE_ENV_KEYS.test(key) ? whole : `${key}=***`)
    .replace(new RegExp(`\\b([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_KEY|ACCESS_KEY)[A-Z0-9_]*)\\s*=\\s*${ASSIGNMENT_VALUE}`, 'gi'), '$1=***')
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi, '$1***@')
    .replace(/([?&](?:token|key|api_key|access_token|password|secret|signature|sig)=)[^&#\s]*/gi, '$1***')
    .replace(/\b(Bearer)\s+[A-Za-z0-9\-._~+/]+=*/gi, '$1 ***')
    .replace(new RegExp(`${BARE_SECRET_BOUNDARY}(?:${BARE_SECRET_SOURCE})`, 'g'), '***')
}

/** Includes unknown env names and quoted values in the command prefix. */
export function maskCommandEnvPrefix(command: string): string {
  return command.replace(new RegExp(`^(?:\\s*(?:env\\s+)?[A-Za-z_][A-Za-z0-9_]*=${ASSIGNMENT_VALUE})+`),
    (prefix) => prefix.replace(new RegExp(`([A-Za-z_][A-Za-z0-9_]*)=${ASSIGNMENT_VALUE}`, 'g'),
      (whole, key: string) => SAFE_ENV_KEYS.test(key) ? whole : `${key}=***`))
}

export function toolSecretValues(tool?: Pick<Tool, 'env' | 'launchCommand' | 'stopCommand'>): string[] {
  if (!tool) return []
  const values = Object.entries(tool.env || {}).filter(([key]) => !SAFE_ENV_KEYS.test(key)).map(([, value]) => value)
  for (const command of [tool.launchCommand, tool.stopCommand || '']) {
    for (const match of command.matchAll(new RegExp(`\\b([A-Z][A-Z0-9_]{2,})=${ASSIGNMENT_VALUE}`, 'g'))) {
      if (SAFE_ENV_KEYS.test(match[1])) continue
      const value = match[0].slice(match[0].indexOf('=') + 1)
      values.push(/^["']/.test(value) ? value.slice(1, -1) : value)
    }
  }
  return values.filter(Boolean)
}

// Identifiers, enums, and timestamps are API contracts, not free-form output.
// An env value such as "error" must not corrupt a runtime status or tool id.
const OUTPUT_METADATA_KEYS = new Set(['id', 'toolId', 'runId', 'receiptId', 'status', 'outcome', 'kind', 'stream', 'origin', 'transport', 'at', 'createdAt', 'updatedAt', 'startedAt', 'endedAt', 'lastLaunchedAt', 'processStartedAt'])

/** Sanitize nested output copies; never mutate the private source record. */
export function sanitizeOutput<T>(value: T, knownValues: readonly string[] = []): T {
  if (typeof value === 'string') return maskSecrets(value, knownValues) as T
  if (Array.isArray(value)) return value.map((item) => sanitizeOutput(item, knownValues)) as T
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sanitizeOutput(item, OUTPUT_METADATA_KEYS.has(key) ? [] : knownValues)])) as T
  }
  return value
}

/**
 * Strip secrets from a tool record for agent-facing serialization.
 * ALL env values are masked (a key-name allowlist misses
 * DATABASE_URL=postgres://user:pass@host, and agents never need the
 * values — keys say what is configured; tool.port/url carry the
 * operational facts). launchCommand/stopCommand mask their env-prefix
 * and notes mask env-style assignments — inline `KEY=value` in the
 * adjacent fields is the same secret in a different pocket. The GUI
 * editor reads the raw record over its own IPC (same-machine owner).
 */
export function sanitizeToolForOutput(tool: Tool): Tool {
  const env: Record<string, string> | undefined = tool.env ? {} : undefined
  if (tool.env && env) {
    for (const key of Object.keys(tool.env)) env[key] = '***'
  }
  return sanitizeOutput({
    ...tool,
    ...(env ? { env } : {}),
    launchCommand: maskSecrets(maskCommandEnvPrefix(tool.launchCommand)),
    ...(tool.stopCommand
      ? { stopCommand: maskSecrets(maskCommandEnvPrefix(tool.stopCommand)) }
      : {}),
    ...(tool.notes ? { notes: maskSecrets(tool.notes) } : {}),
  }, toolSecretValues(tool))
}
