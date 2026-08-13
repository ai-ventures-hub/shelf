/** Shared tool and process types for Electron, MCP, and smokes. */

import { DEFAULT_GLOBAL_SHORTCUT } from './global-shortcut'

export type ToolStatus = 'stopped' | 'starting' | 'running' | 'error'

export type AppearanceMode = 'system' | 'light' | 'dark'
export type ViewMode = 'grid' | 'list'
export type SortMode = 'name' | 'recent' | 'status'
/**
 * Presentation mode for the desktop shell. 'simple' hides agent-integration
 * surfaces for non-developers; the engine and MCP server behave identically
 * in both modes.
 */
export type UiMode = 'simple' | 'developer'

export type AgentAccessKind = 'cli' | 'mcp' | 'http-api'
export type McpTransport = 'stdio' | 'streamable-http'
export type CapabilityReadinessState =
  | 'ready'
  | 'needs_setup'
  | 'manual_only'
  | 'unavailable'

/** Declarative agent access metadata. Shelf does not invoke these endpoints in v0.4. */
export interface AgentAccess {
  id: string
  kind: AgentAccessKind
  /** Command for CLI/stdio MCP, URL for HTTP API/Streamable HTTP MCP. */
  entrypoint: string
  transport?: McpTransport
  setupRequired: boolean
  notes?: string
}

export interface ToolReadiness {
  /** Describes the tool's OWN agent interface — never whether Shelf can launch it. */
  state: CapabilityReadinessState
  summary: string
  reasons: string[]
  /** True unless the project folder is missing or the launch command is empty. */
  launchable: boolean
  /** Shelf MCP tools that work for this tool regardless of readiness state. */
  shelfActions: string[]
  /** What `state` is about: the tool's declared child interface. */
  childInterface: 'none' | 'declared' | 'incomplete' | 'needs_setup'
}

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

export interface Tool {
  id: string
  name: string
  description?: string
  /** Absolute path to a custom image icon (optional). */
  iconPath?: string
  /** Lucide icon PascalCase name, e.g. "Wrench". Preferred over iconPath when set. */
  iconLucide?: string
  /** Hex color for the Lucide glyph, e.g. "#ffffff". */
  iconColor?: string
  /** Hex background behind the Lucide glyph, e.g. "#3b82f6". */
  iconBackground?: string
  tags: string[]
  /** Task-oriented phrases used for agent capability discovery. */
  capabilities: string[]
  /** Declared access methods; informational until a user/client configures them. */
  agentAccess: AgentAccess[]
  favorite: boolean
  projectPath?: string
  launchCommand: string
  stopCommand?: string
  url?: string
  port?: number
  env?: Record<string, string>
  notes?: string
  lastLaunchedAt?: string
  createdAt: string
  updatedAt: string
  /**
   * When `capabilities` last actually changed. Gap resolve-suggestions
   * compare against THIS — `updatedAt` bumps on every launch/edit, which
   * would re-qualify old tools a gap already deemed insufficient.
   */
  capabilitiesUpdatedAt?: string
}

/** Curated library destination; a tool may belong to many collections. */
export interface Collection {
  id: string
  name: string
  description?: string
  toolIds: string[]
  /** Design Engine binding — additive optional, no library version bump. */
  designProfileId?: string
  createdAt: string
  updatedAt: string
}

/** DTCG-format leaf token (W3C Design Tokens: $value/$type). */
export interface DesignToken {
  $value: string | number
  $type?: string
  $description?: string
}

/** DTCG nested group; leaves are DesignToken ($value present). */
export interface DesignTokenGroup {
  [key: string]: DesignToken | DesignTokenGroup
}

export function isDesignToken(node: DesignToken | DesignTokenGroup): node is DesignToken {
  return typeof node === 'object' && node !== null && '$value' in node
}

export type DesignAssetKind = 'logo' | 'wordmark' | 'icon' | 'other'

/** Brand asset copied into <dataRoot>/brand-assets/<profileId>/. */
export interface DesignAsset {
  kind: DesignAssetKind
  path: string
  mime: string
}

/**
 * A design/brand profile (design-profiles.json — never mixed into
 * library.json). `tokens` are the base values (Shelf's brand is dark-first);
 * `modes` carry per-mode token overrides.
 */
export interface DesignProfile {
  id: string
  name: string
  isDefault: boolean
  tokens: DesignTokenGroup
  modes: { light: DesignTokenGroup; dark: DesignTokenGroup }
  /** Markdown prose direction — personality, voice, do/don't rules. */
  direction: string
  assets: DesignAsset[]
  /**
   * 'agent' = created over MCP and still agent-owned; agents may update it.
   * Absent = user-owned (GUI/seed, or a user has since edited it) — agents
   * must not touch it. Any GUI save transfers ownership to the user.
   */
  origin?: 'agent'
  /** Where an extracted brand came from (URL, screenshot, style guide). */
  sourceNote?: string
  createdAt: string
  updatedAt: string
}

export interface DesignProfilesFile {
  version: 1
  profiles: DesignProfile[]
}

/**
 * Structured launch/stop failure classes. `message` stays the human string;
 * `code` lets the GUI and agents branch without regex-ing prose.
 */
export type LaunchErrorCode =
  | 'tool_not_found'
  | 'folder_missing'
  | 'no_launch_command'
  | 'deps_missing'
  | 'runtime_missing'
  | 'docker_not_running'
  | 'port_in_use'
  | 'port_reassign_failed'
  | 'bad_launch_command'
  | 'app_crashed'
  | 'port_timeout'
  | 'stop_refused_not_owner'

/** What the UI can offer for a coded failure. */
export type RemedyKind =
  | 'install_deps'
  | 'reassign_port'
  | 'open_docker'
  | 'repick_folder'
  | 'edit_command'
  | 'install_runtime'
  | 'copy_ai_report'

/**
 * Who initiated a launch. 'gui'/'tray' are the human in the Shelf app;
 * 'mcp' is an agent client, identified by the (self-reported) name from the
 * MCP initialize handshake, e.g. "claude-code" or "cursor".
 */
export type LaunchOriginKind = 'gui' | 'tray' | 'mcp'

export interface LaunchOrigin {
  kind: LaunchOriginKind
  client?: string
}

export interface ToolRuntimeState {
  toolId: string
  status: ToolStatus
  pid?: number
  startedAt?: string
  message?: string
  exitCode?: number | null
  /** Present on coded failures (and timeout stops); absent on success paths. */
  code?: LaunchErrorCode
  remedy?: RemedyKind
  /** Live port once known (may differ from the configured port after reassign/sniff). */
  port?: number
  /** 'local' = this manager spawned it; 'external' = adopted from another Shelf process. */
  origin?: 'local' | 'external'
  /** Provenance carried from the run receipt; absent for pre-0.8 receipts. */
  startedBy?: LaunchOrigin
}

export interface LogLine {
  toolId: string
  stream: 'stdout' | 'stderr' | 'system'
  text: string
  at: string
}

/**
 * Durable launch history entry (receipts.json — not mixed into library.json).
 * Open receipts have no endedAt; finalized ones capture duration + outcome.
 */
export type ReceiptOutcome =
  | 'starting'
  | 'running'
  | 'stopped'
  | 'error'
  | 'failed'
  | 'interrupted'

export interface RunReceipt {
  id: string
  toolId: string
  toolName: string
  launchCommand: string
  port?: number
  url?: string
  pid?: number
  startedAt: string
  endedAt?: string
  durationMs?: number
  outcome: ReceiptOutcome
  exitCode?: number | null
  message?: string
  /** Who initiated the launch; absent on receipts written before 0.8. */
  startedBy?: LaunchOrigin
}

export interface ReceiptsFile {
  version: 1
  receipts: RunReceipt[]
}

export type CapabilityGapStatus = 'open' | 'planned' | 'resolved' | 'dismissed'

export interface CapabilityGapExample {
  task: string
  at: string
}

export interface CapabilityGap {
  id: string
  capabilities: string[]
  task: string
  reason: string
  relatedToolIds: string[]
  suggestedAccess?: AgentAccessKind
  status: CapabilityGapStatus
  occurrenceCount: number
  examples: CapabilityGapExample[]
  createdAt: string
  updatedAt: string
  lastRequestedAt: string
  /** Tools the user declined as resolve suggestions (suggestion hidden, gap stays open). */
  suggestionDismissedToolIds?: string[]
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

/** UI prefs live in prefs.json — never mixed into library.json. */
export interface UiPrefs {
  appearance: AppearanceMode
  viewMode: ViewMode
  sort: SortMode
  /** Presentation mode; existing prefs without the key resolve to 'developer'. */
  uiMode: UiMode
  sidebarWidth: number
  sidebarCollapsed: boolean
  /** Defaults applied when creating a tool with a Lucide mark. */
  defaultIconLucide?: string
  defaultIconColor: string
  defaultIconBackground: string
  /** Show Shelf in the macOS menu bar. */
  menuBarEnabled: boolean
  /** Hide to menu bar instead of quitting when the window closes. */
  closeToMenuBar: boolean
  /** Start Shelf automatically at macOS login (packaged builds only). */
  launchAtLogin: boolean
  /** Register a global hotkey to show/hide Shelf. */
  globalShortcutEnabled: boolean
  /** Electron accelerator, e.g. Command+Shift+Space. */
  globalShortcut: string
  windowBounds?: {
    width: number
    height: number
    x?: number
    y?: number
  }
  /** App version at which first-launch onboarding was completed or skipped. */
  onboardingCompletedVersion?: string
  /** Submission captured while offline; main flushes it on next launch. */
  pendingOnboardingSubmission?: OnboardingSubmission
}

/** Renderer-side onboarding payload (main stamps version/platform/time). */
export interface OnboardingSubmissionInput {
  name?: string
  email?: string
  answers: {
    firstShelve?: string
    persona?: string
    heardFrom?: string
    agents: string[]
  }
  /** True when the contact screen was skipped or left empty. */
  skippedContact: boolean
}

/**
 * The one-time first-launch survey POSTed to shelfmcp.com/api/onboarding —
 * the only user-data network call the app makes. See docs/PRODUCT.md.
 */
export interface OnboardingSubmission extends OnboardingSubmissionInput {
  appVersion: string
  platform: string
  submittedAt: string
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

/** Result of resolving a project-local DESIGN.md for agents/UI. */
export interface DesignMdResult {
  found: boolean
  path?: string
  content?: string
  projectPath?: string
  toolId?: string
}

/** Suggested tool fields from smart folder import (see shared/project-import). */
export interface LaunchAlternative {
  command: string
  label: string
}

export interface ProjectImportSuggestion {
  projectPath: string
  name?: string
  description?: string
  launchCommand?: string
  launchAlternatives: LaunchAlternative[]
  port?: number
  portPreferred?: number
  portFree?: boolean
  url?: string
  tags: string[]
  designMd: { found: boolean; path?: string }
  notesHint?: string
  /** Detected agent interfaces the project provides (already normalized). */
  agentAccess: AgentAccess[]
  confidence: 'high' | 'medium' | 'low'
  signals: string[]
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
  'sk-[A-Za-z0-9_-]{16,}', // OpenAI / Anthropic style
  'sk_(?:live|test)_[A-Za-z0-9]{16,}', // Stripe
  'gh[pousr]_[A-Za-z0-9]{36,}', // GitHub tokens
  'github_pat_[A-Za-z0-9_]{22,}',
  'xox[baprs]-[A-Za-z0-9-]{10,}', // Slack
  'npm_[A-Za-z0-9]{36,}',
  '(?:AKIA|ASIA)[0-9A-Z]{16}', // AWS access key ids
  'eyJ[A-Za-z0-9_-]{10,}\\.eyJ[A-Za-z0-9_-]{6,}\\.[A-Za-z0-9_-]{10,}', // JWT
  '-----BEGIN [A-Z ]*PRIVATE KEY-----',
].join('|')

/** Redact likely secrets before returning tool/log payloads to agents or UI. */
export function maskSecrets(text: string): string {
  return text
    .replace(
      /\b([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_KEY|ACCESS_KEY)[A-Z0-9_]*)\s*=\s*([^\s]+)/gi,
      '$1=***',
    )
    .replace(/\b(Bearer)\s+[A-Za-z0-9\-._~+/]+=*/gi, '$1 ***')
    .replace(new RegExp(`(?:^|\\b)(?:${BARE_SECRET_SOURCE})`, 'g'), '***')
}

/** Strip secret env values from a tool record for safe MCP/UI serialization. */
export function sanitizeToolForOutput(tool: Tool): Tool {
  if (!tool.env) return tool
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(tool.env)) {
    env[key] = /TOKEN|SECRET|PASSWORD|API_KEY|ACCESS_KEY/i.test(key) ? '***' : value
  }
  return { ...tool, env }
}
