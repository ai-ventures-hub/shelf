/** Shared tool and process types for Electron, MCP, and smokes. */

import { DEFAULT_GLOBAL_SHORTCUT } from './global-shortcut'

export type ToolStatus = 'stopped' | 'starting' | 'running' | 'error'

export type AppearanceMode = 'system' | 'light' | 'dark'
export type ViewMode = 'grid' | 'list'
export type SortMode = 'name' | 'recent' | 'status'

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
  state: CapabilityReadinessState
  summary: string
  reasons: string[]
}

export interface CapabilityMatch {
  toolId: string
  name: string
  capabilities: string[]
  accessKinds: AgentAccessKind[]
  readiness: ToolReadiness
  score: number
  reasons: string[]
  suggestedAction: 'launch' | 'configure' | 'manual_use'
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
}

/** Curated library destination; a tool may belong to many collections. */
export interface Collection {
  id: string
  name: string
  description?: string
  toolIds: string[]
  createdAt: string
  updatedAt: string
}

export interface ToolRuntimeState {
  toolId: string
  status: ToolStatus
  pid?: number
  startedAt?: string
  message?: string
  exitCode?: number | null
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
}

export const DEFAULT_UI_PREFS: UiPrefs = {
  appearance: 'system',
  viewMode: 'grid',
  sort: 'name',
  sidebarWidth: 250,
  sidebarCollapsed: false,
  defaultIconLucide: 'Box',
  defaultIconColor: '#ffffff',
  defaultIconBackground: '#3b82f6',
  menuBarEnabled: true,
  closeToMenuBar: true,
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
  confidence: 'high' | 'medium' | 'low'
  signals: string[]
}

/** Redact likely secrets before returning tool/log payloads to agents or UI. */
export function maskSecrets(text: string): string {
  return text
    .replace(
      /\b([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_KEY|ACCESS_KEY)[A-Z0-9_]*)\s*=\s*([^\s]+)/gi,
      '$1=***',
    )
    .replace(/\b(Bearer)\s+[A-Za-z0-9\-._~+/]+=*/gi, '$1 ***')
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
