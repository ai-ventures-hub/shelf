# Phase 4: Project memory and agent handoffs

This first Phase 4 increment implements project memory and reviewable handoffs on `codex/phase4-project-context`, based on Shelf 1.7.0, and is prepared for the signed 1.8.0 release. Reusable workflow execution remains a later increment. No dependencies or library migrations are added. The release workflow separately gates signing, notarization, and publication.

## User flow

Open a tool and choose **Memory & handoff**. Save its purpose, conventions, decisions, known issues, and next steps. Each field is optional and limited to 4,000 characters. Saved time is visible, and notes are explicitly user-authored context rather than current verification.

Describe the next task and choose whether to include fresh environment checks, effective design direction, and a retained run. Run evidence defaults to excluded. Output requires a separate choice and is limited to the most recent 100 lines and 20,000 characters. A handoff uses the selected run's recorded command and outcome, never another run's logs or today's idle state. Missing or expired selections require a new choice.

Review and optionally edit the generated Markdown before copying. Editing the preview does not change memory. Nothing is sent to an agent, committed to a repository, or executed automatically. Existing operating notes remain in the tool configuration and are also included in the handoff.

## Agent access

- `shelf_get_project_memory({ id })` returns saved notes with their timestamp and revision, or `memory: null` if none were saved.
- `shelf_prepare_handoff({ id, options })` uses the same builder as the desktop. Options are `task`, `includeEnvironment`, `includeDesign`, `runId`, and `includeLogs`. Optional evidence is excluded unless requested through MCP.
- Both tools are annotated read-only. There is no agent memory-write tool. This keeps user decisions from being overwritten by an agent's interpretation of a session.
- Agent reads and generated briefs use Shelf's existing credential masking, including configured secret values. Raw user-authored notes are stored locally; they are not a credential vault. Review remains necessary before sharing arbitrary notes or output.

## Storage and recovery

`project-memory.json` is a separate, versioned local store under Shelf's existing data root. Records use stable tool IDs, so renaming a tool or updating its folder keeps its memory. Two tools in the same folder have independent memory. Tool bundles and manifests do not export this store.

Writes use the existing private atomic writer and cross-process file lock. Saves require the revision originally loaded, including `null` for the first save. A conflicting save preserves the draft and rejects the overwrite. The editor requires an explicit choice before replacing a dirty draft with saved content. Navigation, reload, and quit guard unsaved notes and the handoff task.

Invalid JSON, duplicate records, unsupported versions, and oversized stores fail closed. The original file is preserved, and the UI offers retry after repair. A handoff refuses to label an outdated snapshot as current if the tool or its memory changes during environment inspection. Failed optional environment or design reads are explicitly marked unavailable.

Memory is retained locally when a tool is removed, like historical evidence; it is not reassigned by folder or name. To erase saved text, use **Clear fields**, then **Save memory**, before removing the tool. This increment does not add automatic pruning, revision history, cloud sync, or automatic collection of repository contents.

## File map

| Area | Files |
| --- | --- |
| Shared contracts | `shared/project-context-contracts.ts`, `shared/contracts.ts`, `shared/desktop-api.ts` |
| Persistence and brief generation | `shared/project-memory-store.ts`, `shared/project-handoff.ts` |
| Desktop transport | `electron/main.ts`, `electron/preload.ts` |
| MCP discovery and reads | `mcp/project-context-tools.ts`, `mcp/server.ts` |
| Editor, review, and navigation | `src/pages/ProjectContextPage.tsx`, `src/pages/ToolDetailPage.tsx`, `src/App.tsx`, `src/styles/detail.css` |
| Regression gate | `scripts/smoke-phase4.mjs`, `scripts/smoke-all.mjs` |

## Verification

- Typecheck and production build pass; no new dependency is installed. The existing entry-bundle warning remains.
- Full `smoke:all` passes, including the new Phase 4 test, Phase 1–3 regressions, real Electron/MCP, ownership, sharing, catalogs, and design stress tests. Focused tests and bridge parity are repeated after final changes.
- Phase 4 tests exercise persisted reads across store instances, file permissions, stale revisions, bounded/strict input, malformed/future/duplicate file preservation, secret masking, explicit run identity, optional/bounded logs, partial diagnostic failures, context changing during preparation, and real MCP discovery/read/error behavior.
- Native QA uses an isolated data root with OS integrations disabled. Save/readback, renderer reload and app restart persistence, unsaved navigation, handoff review/copy/paste readback, selected historical run/output, focus containment/Escape/restoration, external-save conflict preservation, explicit saved-version recovery, and cancelling quit with an uncopied task are verified. The editor and preview were inspected at the 900 × 600 minimum window size.

The installed app and personal library remain unchanged. Signed distribution, updater installation, and use from a person's existing agent session are release-stage checks. These tests do not prove arbitrary project commands, API access, or the truth of saved notes.

## Next step

Release this increment through the existing signed/notarized pipeline, then use real handoffs to choose the first reusable workflows. Begin with explicit command sequences, visible results, and failure recovery; avoid automatic project-memory updates until proposals and review have a clear ownership model.
