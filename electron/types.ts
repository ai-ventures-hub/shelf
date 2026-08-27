/**
 * Electron re-exports shared types so main/preload stay on the electron compile unit.
 */
export type {
  ToolStatus,
  Tool,
  Collection,
  ToolRuntimeState,
  ToolHealth,
  LogLine,
  LibraryFile,
  UiPrefs,
  OnboardingSubmission,
  OnboardingSubmissionInput,
  AppearanceMode,
  ViewMode,
  SortMode,
  DesignMdResult,
  LaunchAlternative,
  ProjectImportSuggestion,
  RunReceipt,
  ReceiptOutcome,
  ReceiptsFile,
  AgentAccess,
  AgentAccessKind,
  McpTransport,
  ToolReadiness,
  CapabilityReadinessState,
  CapabilityMatch,
  CapabilityGap,
  CapabilityGapStatus,
  CapabilityGapsFile,
  DesignToken,
  DesignTokenGroup,
  DesignAsset,
  DesignAssetKind,
  DesignProfile,
  DesignProfilesFile,
} from '../shared/types'
export { DEFAULT_UI_PREFS } from '../shared/types'
export type {
  UiMode,
  LaunchErrorCode,
  RemedyKind,
} from '../shared/types'
export type {
  RegisterOutcome,
  RegisterProjectOptions,
  RegisterProjectResult,
} from '../shared/register-project'
export type { BootstrapResult, BootstrapStep } from '../shared/project-bootstrap'
export type { PreflightIssue } from '../shared/launch-preflight'
export type { StartOptions, PortConflictPolicy } from '../shared/process-manager'
export type {
  LaunchOrigin,
  LaunchOriginKind,
} from '../shared/types'
export { launchOriginLabel } from '../shared/types'
export type {
  CollectionActionResult,
  CollectionToolOutcome,
  CollectionToolResult,
} from '../shared/collection-launch'
export type { GapResolveSuggestion } from '../shared/gap-suggest'
export type { ToolSource } from '../shared/types'
export type {
  ApplyUpdateInput,
  ApplyUpdateResult,
  ConfirmShareInput,
  ConfirmShareResult,
  ShareErrorCode,
  ShareFailure,
  ShareSource,
  StagedShare,
  UpdateCheck,
  UpdateCommit,
} from '../shared/tool-share'
export type { ManifestFieldDiff, ToolManifest } from '../shared/tool-manifest'
export type { CatalogEntry, TeamCatalogFile } from '../shared/team-catalog'
export type { TeamCatalog, TeamCatalogsFile } from '../shared/team-catalog-store'
export type {
  CatalogSyncView,
  PublishResult as CatalogPublishResult,
} from '../shared/team-catalog-sync'
export type { SaveDesignProfileInput } from '../shared/design-profile-store'
export type { ExtractedTokens } from '../shared/design-extract'
export type { ShortcutStatus } from '../shared/global-shortcut'
export {
  DEFAULT_GLOBAL_SHORTCUT,
  GLOBAL_SHORTCUT_PRESETS,
} from '../shared/global-shortcut'
export type {
  ClaudeDesktopStatus,
  ClaudeConnectResult,
} from '../shared/claude-desktop'
export { CLAUDE_TEST_PROMPT } from '../shared/claude-desktop'
export type {
  ClaudeCodeMcpStatus,
  ClaudeCodeConnectResult,
} from '../shared/claude-code-mcp'
export type {
  DetectableMcpClient,
  McpClientDetection,
} from '../shared/mcp-client-detect'
export type {
  CursorMcpStatus,
  CursorConnectResult,
} from '../shared/cursor-mcp'
export { CURSOR_TEST_PROMPT } from '../shared/cursor-mcp'
export type {
  CodexMcpStatus,
  CodexConnectResult,
} from '../shared/codex-mcp'
export { CODEX_TEST_PROMPT } from '../shared/codex-mcp'
