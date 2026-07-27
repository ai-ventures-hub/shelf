/**
 * Electron re-exports shared types so main/preload stay on the electron compile unit.
 */
export type {
  ToolStatus,
  Tool,
  Collection,
  ToolRuntimeState,
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
} from '../shared/types'
export { DEFAULT_UI_PREFS } from '../shared/types'
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
  CursorMcpStatus,
  CursorConnectResult,
} from '../shared/cursor-mcp'
export { CURSOR_TEST_PROMPT } from '../shared/cursor-mcp'
export type {
  CodexMcpStatus,
  CodexConnectResult,
} from '../shared/codex-mcp'
export { CODEX_TEST_PROMPT } from '../shared/codex-mcp'
