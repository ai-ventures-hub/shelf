# Project verification

Shelf can save and run a project's finite checks without changing its launch command. This extends project memory and handoffs from Phase 4. It does not add a general automation builder.

## User flow

1. Open a tool and choose **Verify project**.
2. Add commands manually or discover existing `typecheck`, `lint`, `test`, and `build` scripts in package.json. Discovery only adds a draft; it never installs dependencies or runs scripts. Commands use the detected package manager.
3. Name and order up to ten checks. Each timeout is between one second and one hour; the initial suggestion is ten minutes. Configure test scripts to finish once rather than watch for changes.
4. Save commands, then **Review & run**. The review shows the exact shell commands, project folder, configured environment key names, timeouts, and order. Commands execute against the current working tree with the tool's environment and Shelf's inherited login-shell environment.
5. Each step must exit successfully and its process group must finish cleanup before the next starts. A failure, timeout, cancellation, or supervision error skips remaining checks. Running again creates a new run beginning with step one and requires another review.
6. Inspect per-step output or prepare an editable failure handoff with saved project memory, effective design context, the selected run, and bounded failed-step output. Review, then copy; nothing is sent to another agent automatically.

Verification remains visible across routes while running. Navigation and renderer reload do not cancel a run. Normal app quit, update installation, and tool removal await cancellation and process cleanup. A refused cleanup prevents a new run and can be retried.

## Boundaries and files

- `shared/verification-contracts.ts`: browser-safe workflow and result contracts.
- `shared/verification-store.ts`: schema-validated, revision-checked, private atomic records under `<Shelf data root>/verification/<tool hash>.json`. Ten retained runs per project; each run has its own log directory. Historical commands are masked before persistence; editable commands remain private local configuration.
- `shared/verification-runner.ts`: desktop-owned execution, sequential steps, process identity checks, interruption recovery, cancellation, and lifecycle integration. Reuses the launcher's login shell, process-group termination, complete-line redaction, and bounded log storage. Verification never enters the normal launch receipt store or modifies a tool's launch configuration.
- `shared/verification-handoff.ts`: adds explicitly selected verification evidence to the existing memory handoff. Includes up to 100 failed-step lines and 20,000 output characters.
- `src/pages/VerificationPage.tsx`: command editor, unsaved-change guard, explicit review, and revision pinning.
- `src/components/VerificationResults.tsx`: history, step output, cancellation, and reviewed handoff copying.
- `src/components/VerificationActivity.tsx`: event-refreshed activity notice across routes. Output polling is limited to the active verification page.
- `electron/main.ts`, `electron/preload.ts`, `shared/desktop-api.ts`: typed IPC and awaited shutdown/update/removal cleanup.
- `mcp/project-context-tools.ts`: `shelf_get_verification` and `shelf_prepare_verification_handoff`. Both are read-only. MCP cannot save or execute workflows. Agents can inspect recorded results and prepare a brief; recorded active status may be stale after host interruption.

Logs retain up to 3,000 lines / 2 MiB per step. Removing an old history entry prunes its logs. Configuration and history reject malformed/future data instead of silently replacing it. A disk failure halts execution and keeps local ownership available for recovery. Configured secrets and recognizable credentials are masked; users should still inspect all shared output.

## Recovery and deliberate limits

- Reviews pin the workflow revision and tool configuration timestamp. Changed configuration requires a fresh review. Shelf does not freeze project files or expand package-script definitions into a source snapshot.
- Abrupt application termination is not a successful verification. On the next read, Shelf marks it interrupted, or requests cleanup if its recorded child/group may remain alive. It never automatically reruns commands.
- Recovery signals a surviving child only when its recorded process identity still matches. If the group leader is gone or identity cannot be proven, Shelf asks the user to inspect/stop the process in Terminal. It refuses to kill a potentially unrelated process.
- Commands should be finite and keep descendants in their process group. A command that intentionally detaches into a different session is outside this supervisor's ownership guarantee. Inherited output pipes that stay open after cleanup produce a failed step with an explicit warning.
- Workflows and history are local to this Shelf installation. They are not written to repository files, exported in tool bundles, or synchronized between machines.
- Retrying runs all steps again. There is no automatic retry, partial resume, scheduler, dependency installation, deployment, or publishing step.

## Verification

`node scripts/smoke-verification.mjs` runs after Electron and bundled MCP compilation, and is included in `npm run smoke:all` after the MCP build. All commands use disposable fixture directories.

Coverage includes command ordering, first-failure skipping, exact exit codes, stale review/save rejection, duplicate execution guards, restart history, secret values split across output chunks, final partial lines, timeouts, immediate and active cancellation, surviving descendant cleanup, private and bounded storage, corrupt-data preservation, failed history writes, failed termination and retry, interrupted-child identity checks and safe cleanup, plus actual bundled MCP discovery and handoffs.

Desktop QA used an isolated `SHELF_DATA_ROOT` and checked package-script discovery, unsaved navigation protection, command review, failed/skipped results, editable handoff and copy feedback, navigation during a run, cancellation, normal quit cleanup with persisted cancellation and an absent process group, restart history, a successful rerun, compact 900 × 600 layout, and results focus after starting. Typecheck, production build, and the full smoke suite are the release gates.
