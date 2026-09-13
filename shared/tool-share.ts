/** Public sharing API. Transaction stages live in focused modules. */
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
} from './contracts'
export { confirmStagedShare } from './tool-share-confirm'
export { GIT_MISSING_REMEDY, ShareError } from './tool-share-errors'
export {
  ExportManifestResult,
  exportToolBundle,
  exportToolManifest,
  prepareToolBundle,
} from './tool-share-export'
export {
  CloneFailureKind,
  GitRun,
  buildShareLink,
  classifyCloneFailure,
  cloneFailure,
  detectGitRemote,
  gitFailure,
  githubHelperArgs,
  requireGit,
  resolveGhBinary,
  resolveGitBinary,
  runGit,
  sshUrlForHttps,
  validateRepoUrl,
} from './tool-share-git'
export {
  cleanStagingRoot,
  defaultToolsRoot,
  stagingRoot,
  uniqueDestination,
  validateDestination,
} from './tool-share-paths'
export { MAX_STAGED_BYTES, discardStagedShare, stageSharedTool } from './tool-share-stage'
export { applyToolUpdate } from './tool-share-update'
export { checkToolUpdates, workingTreeFingerprint } from './tool-share-update-check'
