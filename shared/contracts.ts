export type { ProjectMemory, ProjectMemoryFields, SaveProjectMemoryInput, ProjectHandoffOptions, ProjectHandoff } from './project-context-contracts'
export type { AgentAccess, AgentAccessKind, McpTransport, Tool, ToolSource } from './tool-validation'
import type { AgentAccess, AgentAccessKind, Tool, ToolSource } from './tool-validation'
/** Browser-safe data contracts shared by renderer, Electron, and MCP.
 * Runtime services re-export these names for compatibility.
 */

export type ToolStatus = 'stopped' | 'starting' | 'stopping' | 'running' | 'error'

export type AppearanceMode = 'system' | 'light' | 'dark'

export type ViewMode = 'grid' | 'list' | 'compact'

export type SortMode = 'name' | 'recent' | 'status'

/**
 * Presentation mode for the desktop shell. 'simple' hides agent-integration
 * surfaces for non-developers; the engine and MCP server behave identically
 * in both modes.
 */
export type UiMode = 'simple' | 'developer'

export type CapabilityReadinessState =
  | 'ready'
  | 'needs_setup'
  | 'manual_only'
  | 'unavailable'

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

/** Curated library destination; a tool may belong to many collections. */
/**
 * One member of a stack contract. Order is the collection's toolIds, not
 * this array. Only key names are stored. Values stay on the tool.
 */
export interface StackStep {
  toolId: string
  requireEnvKeys?: string[]
}

/**
 * How a collection launches. Absent means the original concurrent start.
 * Agents may read it. A GUI save is the only write.
 */
export interface StackContract {
  /**
   * Start members in toolIds order. ProcessManager already waits for a
   * member's port before start() resolves, so the next command does not
   * run until that wait finishes. A failed or blocked step skips the rest.
   */
  ordered: boolean
  steps: StackStep[]
}

export interface Collection {
  id: string
  name: string
  description?: string
  toolIds: string[]
  /** Design Engine binding — additive optional, no library version bump. */
  designProfileId?: string
  /**
   * 'agent' = created over MCP and still an agent draft; agents may keep
   * editing it. Absent = user-owned (GUI-created, or a GUI edit has since
   * adopted it) and agents must not touch it. Mirrors DesignProfile.origin.
   * Additive optional — no library version bump.
   */
  origin?: 'agent'
  /**
   * Optional launch contract. Additive optional, no library version bump.
   * Omitted when the collection still starts every member together.
   */
  stack?: StackContract
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
  | 'stop_command_failed'

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

/**
 * Launchability snapshot behind the library card health glyph. Distinct from
 * readiness (agent setup state): this answers "will Launch work right now".
 */
export interface ToolHealth {
  toolId: string
  launchable: boolean
  /** Plain-language blockers, most severe first; empty when launchable. */
  problems: string[]
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
  id?: string
  runId?: string
  toolId: string
  stream: 'stdout' | 'stderr' | 'system'
  text: string
  at: string
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

/** Result of resolving a project-local DESIGN.md for agents/UI. */
export interface DesignMdResult {
  found: boolean
  path?: string
  content?: string
  projectPath?: string
  toolId?: string
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
  processStartedAt?: string
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

/** The on-disk manifest. Unknown fields are preserved on read (see `extra`). */
export interface ToolManifest {
  shelfManifest: 1
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

export interface ManifestFieldDiff {
  field: string
  before?: string
  after?: string
}

// ---------------------------------------------------------------------------
// Receive (staged)
// ---------------------------------------------------------------------------

export type ShareSource =
  | { kind: 'git'; repo: string }
  | { kind: 'bundle'; bundlePath: string }

export type ShareErrorCode =
  | 'git_missing'
  | 'invalid_repo'
  | 'clone_failed'
  | 'auth_required'
  | 'repo_not_found'
  | 'bundle_invalid'
  | 'manifest_invalid'
  | 'destination_invalid'
  | 'stage_missing'
  | 'import_incomplete'
  | 'export_refused'
  | 'folder_missing'
  // Catalog paths (v1.4). They share ShareError so the GUI's existing
  // remedy rendering (prose + one-click command) works unchanged.
  | 'catalog_invalid'
  | 'catalog_missing'
  | 'catalog_unpushed'
  | 'push_failed'

/** IPC-safe failure shape (a thrown ShareError loses code/remedy over IPC). */
export interface ShareFailure {
  ok: false
  code: ShareErrorCode | 'unknown'
  message: string
  /** Plain-language fix (prose). */
  remedy?: string
  /** A shell command the fix needs, offered as a one-click copy in the UI. */
  remedyCommand?: string
}

export interface ConfirmShareInput {
  /** Final destination (validated here). */
  destination: string
  /** User-typed env values, keyed by manifest env key. Empty values are dropped. */
  env: Record<string, string>
  /** Run `stage.setupSteps` — the user saw them; this is the consent. */
  runSetup: boolean
  /** Launch after saving (default true). */
  launch?: boolean
}

export interface ConfirmShareResult extends RegisterProjectResult {
  destination: string
}

// ---------------------------------------------------------------------------
// Updates
// ---------------------------------------------------------------------------

export interface UpdateCommit {
  sha: string
  subject: string
}

export type UpdateCheck =
  | { state: 'recovery_required'; operationId: string; message: string; input: ApplyUpdateInput }
  | { state: 'not_shared' }
  | { state: 'folder_missing' }
  | { state: 'git_missing'; message: string; remedy: string }
  | { state: 'not_git' }
  | { state: 'no_remote' }
  | { state: 'no_target_branch'; remote: string }
  | { state: 'fetch_failed'; message: string }
  | { state: 'up_to_date'; ref: string; remote: string; dirty: boolean }
  | {
    state: 'updates_available'
    workingTree: string
    ref: string
    remoteRef: string
    target: string
    behind: number
    commits: UpdateCommit[]
    manifestDiff: ManifestFieldDiff[]
    /**
     * Setup commands to offer after updating: ones the incoming manifest
     * adds, plus every declared step when dependency files changed.
     */
    newBootstrap: string[]
    /** Dependency manifests (package.json, lockfiles, requirements…) changed. */
    depsChanged: boolean
    /** Env keys the incoming manifest adds (values still needed). */
    newEnvKeys: string[]
    remote: string
  }
  | {
    state: 'diverged'
    workingTree: string
    ref: string
    remoteRef: string
    target: string
    ahead: number
    behind: number
    dirty: boolean
    commits: UpdateCommit[]
    manifestDiff: ManifestFieldDiff[]
    newBootstrap: string[]
    depsChanged: boolean
    newEnvKeys: string[]
    remote: string
  }

export interface ApplyUpdateInput {
  expectedRef: string
  expectedTargetRef: string
  expectedWorkingTree: string
  resumeOperationId?: string
  /** 'fast_forward' for a clean copy; 'take_theirs' discards local commits/changes. */
  mode: 'fast_forward' | 'take_theirs'
  /** Remote target shown on the sheet (e.g. origin/main). */
  target: string
  /** Consent to run `setupCommands` after pulling (exactly what was shown). */
  runSetup?: boolean
  setupCommands?: string[]
}

export interface ApplyUpdateResult {
  operationId?: string
  restoreRef?: string
  ok: boolean
  message: string
  tool?: Tool
  ref?: string
  /** Fields changed on the tool from the new manifest. */
  applied: string[]
  /** Manifest changes NOT applied because the local value differs (local edits win). */
  skipped: { field: string; reason: string }[]
  /** Env keys the new manifest needs that still have no value. */
  missingEnvKeys: string[]
  setup?: { command: string; ok: boolean }[]
  /** The tool was running when the files changed — it needs a restart to pick them up. */
  running: boolean
}

/** One tool in a team catalog. `repo` is the only actionable field. */
export interface CatalogEntry {
  name: string
  description?: string
  capabilities: string[]
  repo: string
}

/** A subscribed catalog as persisted and as the renderer sees it. */
export interface TeamCatalog {
  id: string
  /** Clone URL, already through validateRepoUrl when it was added. */
  url: string
  /** The catalog file's own name when it has one, else derived from the URL. */
  name: string
  addedAt: string
  lastFetchedAt?: string
  /** Last refresh failure in plain language; cleared by the next success. */
  lastError?: string
  /** Normalizer warnings from the last successful read (skipped rows, caps). */
  warnings?: string[]
  /** True when a local "Share with team" commit has not reached the remote. */
  hasUnpushedEntry?: boolean
  entries: CatalogEntry[]
}

/** IPC shape for catalog:add / catalog:refresh (the ok side). */
export interface CatalogSyncView {
  ok: true
  catalog: TeamCatalog
  warnings: string[]
  empty: boolean
}

export interface PublishResult {
  action: 'added' | 'updated'
  /** False when the commit is local because the push failed or was refused. */
  pushed: boolean
  /** Why the push didn't happen, in plain language. */
  pushProblem?: string
  pushRemedy?: string
  pushRemedyCommand?: string
  count: number
}

export interface SaveDesignProfileInput {
  id?: string
  name: string
  isDefault?: boolean
  tokens?: DesignTokenGroup
  modes?: { light?: DesignTokenGroup; dark?: DesignTokenGroup }
  direction?: string
  assets?: DesignAsset[]
  /**
   * 'agent' marks/keeps the profile agent-owned; 'user' transfers ownership
   * to the user (any GUI save passes this); omitted preserves the current
   * owner. GUI/seed callers use save(); the agent write path must go through
   * upsertFromAgent(), which enforces the ownership policy under the lock.
   */
  origin?: 'agent' | 'user'
  sourceNote?: string
}

export interface ExtractedTokens {
  tokens: DesignTokenGroup
  modes: { light: DesignTokenGroup; dark: DesignTokenGroup }
  /** Leaf counts, for the GUI summary. */
  counts: { color: number; typography: number; dimension: number; light: number; dark: number }
  /** Relative file paths that contributed declarations, in scan order. */
  sources: Array<{ file: string; declarations: number }>
  /** Human-readable notes on what was deliberately not extracted. */
  skipped: string[]
}

export interface ShortcutStatus {
  ok: boolean
  accelerator: string
  /** Present when registration failed (usually another app owns the key). */
  error?: string
}

export interface ClaudeDesktopStatus {
  /** Shelf entry present in claude_desktop_config.json. */
  connected: boolean
  /** True when shelf entry exists and points at this Shelf MCP bundle. */
  matches: boolean
  /**
   * True when Claude’s MCP logs show it actually spawned Shelf.
   * Config can be installed while Claude still needs a full Quit/relaunch.
   */
  claudeLoaded: boolean
  configPath: string
  configExists: boolean
  serverPath: string
  serverOk: boolean
  nodeCommand: string
  nodeOk: boolean
  nodePath?: string
  message: string
}

export interface ClaudeConnectResult {
  status: ClaudeDesktopStatus
  /** Written only when we overwrite an existing config file. */
  backupPath?: string
}

export type DetectableMcpClient = 'claude' | 'claude-code' | 'cursor' | 'codex'

export interface McpClientDetection {
  kind: DetectableMcpClient
  installed: boolean
  /** Path that proved installation (first hit). */
  evidence?: string
}

export interface ClaudeCodeMcpStatus {
  /** Shelf entry present in ~/.claude.json. */
  connected: boolean
  /** True when shelf entry exists and points at this Shelf MCP bundle. */
  matches: boolean
  configPath: string
  configExists: boolean
  serverPath: string
  serverOk: boolean
  nodeCommand: string
  nodeOk: boolean
  nodePath?: string
  message: string
}

export interface ClaudeCodeConnectResult {
  status: ClaudeCodeMcpStatus
  /** Written only when we overwrite an existing config file. */
  backupPath?: string
}

export interface CursorMcpStatus {
  /** Shelf entry present in ~/.cursor/mcp.json. */
  connected: boolean
  /** True when shelf entry exists and points at this Shelf MCP bundle. */
  matches: boolean
  configPath: string
  configExists: boolean
  serverPath: string
  serverOk: boolean
  nodeCommand: string
  nodeOk: boolean
  nodePath?: string
  message: string
}

export interface CursorConnectResult {
  status: CursorMcpStatus
  /** Written only when we overwrite an existing config file. */
  backupPath?: string
}

export interface CodexMcpStatus {
  /** Shelf table present in config.toml. */
  connected: boolean
  /** True when shelf points at this Shelf MCP bundle. */
  matches: boolean
  configPath: string
  configExists: boolean
  serverPath: string
  serverOk: boolean
  nodeCommand: string
  nodeOk: boolean
  nodePath?: string
  message: string
}

export interface CodexConnectResult {
  status: CodexMcpStatus
  backupPath?: string
}

export interface GapResolveSuggestion {
  gapId: string
  toolId: string
  toolName: string
  /** Gap capabilities (display form) the tool covers. */
  matched: string[]
  /** Total capabilities the gap requested. */
  total: number
}

export type RegisterOutcome =
  /** Saved and running; url (when known) is on the tool. */
  | 'launched'
  /** Saved; launch skipped because autoLaunch was false. */
  | 'saved'
  /** Saved; needs dependency install / Docker before it can run. */
  | 'needs_setup'
  /** Saved as a draft; detection was not confident enough to auto-run. */
  | 'saved_needs_review'
  /** Saved; launch (or consented setup) was attempted and failed. */
  | 'saved_launch_failed'
  /** Nothing saved; the folder does not exist or is not a directory. */
  | 'invalid_folder'
  /** Nothing saved; inspection-only run (dryRun). */
  | 'dry_run'

export interface RegisterProjectOptions {
  /** Launch after saving (default true). */
  autoLaunch?: boolean
  /** Default 'reassign' — the one-shot flow heals port conflicts silently. */
  onPortConflict?: PortConflictPolicy
  /** Force the review outcome even at high confidence. */
  forceReview?: boolean
  /**
   * Consent to run detected setup steps (package install). Without it,
   * setup needs surface as 'needs_setup' and nothing is executed.
   */
  runSetup?: boolean
  /** Inspect and gate only; save nothing, launch nothing. */
  dryRun?: boolean
  /** Icon defaults applied to newly created tools (GUI passes prefs). */
  toolDefaults?: Partial<
    Pick<Tool, 'iconLucide' | 'iconColor' | 'iconBackground'>
  >
  /** Manifest-seeded fields (shared tools). */
  overrides?: RegisterOverrides
  /**
   * Exactly the setup steps to run when `runSetup` is true — replaces
   * detection so what a consent sheet showed is what executes. An empty
   * array means "run nothing".
   */
  setupSteps?: BootstrapStep[]
  /** Provenance recorded on the saved tool (shared tools). */
  source?: ToolSource
}

/**
 * An agent registration that is not in the library yet.
 * Env values are never stored. Accept is what calls registerProject.
 */
export interface ToolDraft {
  id: string
  projectPath: string
  name: string
  launchCommand: string
  port?: number
  url?: string
  envKeys: string[]
  client?: string
  createdAt: string
  updatedAt: string
}

export interface RegisterProjectResult {
  outcome: RegisterOutcome
  /** Saved tool (present for every outcome that persisted). */
  tool?: Tool
  /** Runtime state after a launch attempt. */
  state?: ToolRuntimeState
  /** Raw inspection result (Developer Mode shows this in full). */
  suggestion?: ProjectImportSuggestion
  /** Whether the gate allowed auto-run, and why. */
  autoRunnable: boolean
  autoRunReason: string
  /** Detected setup steps (empty when none). */
  setupNeeds: BootstrapStep[]
  /** Results of consented setup runs, in order. */
  bootstrap?: { step: BootstrapStep; result: BootstrapResult }[]
  /** Preflight problems in plain language. */
  issues: PreflightIssue[]
  /** True when a new library entry was created (vs updating an existing one). */
  created: boolean
}

export type PortConflictPolicy = 'fail' | 'reassign'

export interface StartOptions {
  /**
   * When the configured port is busy:
   * - fail (default): refuse to start
   * - reassign: pick a free port, rewrite launch/url, persist, then start
   */
  onPortConflict?: PortConflictPolicy
  /** Who initiated this launch; falls back to the manager's defaultOrigin. */
  origin?: LaunchOrigin
}

export type CollectionToolOutcome =
  | 'started'
  | 'already_running'
  | 'failed'
  | 'stopped'
  | 'not_running'
  /** Running listener Shelf does not own — left alone (stop_refused_not_owner). */
  | 'skipped_external'
  /** Ordered contract refused this member before any command ran. */
  | 'blocked'
  /** Ordered contract stopped because an earlier step failed or was blocked. */
  | 'skipped'

export interface CollectionToolResult {
  toolId: string
  name: string
  outcome: CollectionToolOutcome
  state?: ToolRuntimeState
  /** Why a step was blocked or skipped. Key names only, never values. */
  message?: string
}

export interface CollectionActionResult {
  collectionId: string
  name: string
  results: CollectionToolResult[]
}

export interface BootstrapStep {
  /** Shell command run from the project folder (login zsh, no sudo). */
  command: string
  /** Plain-language description shown in the consent prompt. */
  label: string
}

export interface BootstrapResult {
  ok: boolean
  exitCode: number | null
  /** 'timeout' | 'cancelled' | undefined on natural exit. */
  endedBy?: 'timeout' | 'cancelled'
}

export interface PreflightIssue {
  code: LaunchErrorCode
  /** Plain-language, non-developer wording; the GUI shows this verbatim. */
  message: string
}

export interface StagedShare {
  stageId: string
  /** Where the fetched files currently live (scratch). */
  stagePath: string
  source: ShareSource
  manifestFound: boolean
  manifest: ToolManifest
  warnings: string[]
  /** Proposed destination; the user may change the parent folder. */
  destination: string
  /** Exactly the setup commands that will run on approval, in order. */
  setupSteps: BootstrapStep[]
  /** Commit sha at fetch time (git sources). */
  ref?: string
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

/**
 * Fields seeded from a shared manifest (Tool Sharing, 1.2). Applied on top
 * of inspection for NEW entries; an existing entry for the same folder keeps
 * its own values (mergeIntoExisting rules). `env` here is the receiver's
 * own typed values — a manifest never carries values.
 */
export interface RegisterOverrides {
  name?: string
  description?: string
  launchCommand?: string
  port?: number
  url?: string
  tags?: string[]
  capabilities?: string[]
  agentAccess?: AgentAccess[]
  notes?: string
  env?: Record<string, string>
}

export type CatalogPublishResult = PublishResult
export type StagedShareView = Omit<StagedShare, 'stagePath'>

export interface ToolEnvironment {
  checkedAt: string
  checks: { label: string; status: 'ready' | 'missing' | 'unknown'; detail: string }[]
  setupSteps: BootstrapStep[]
}

export interface AppUpdateState {
  status: 'unsupported' | 'idle' | 'checking' | 'downloading' | 'ready' | 'error'
  currentVersion: string
  version?: string
  percent?: number
  checkedAt?: string
  error?: string
}

export type { VerificationStep, VerificationWorkflow, VerificationRun, VerificationState, SaveVerificationInput, StartVerificationInput } from './verification-contracts'
