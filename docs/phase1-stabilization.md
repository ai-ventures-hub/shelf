# Phase 1 stabilization

Implemented September 11, 2026 on `codex/phase1-stabilize`, based on `7143503`.

Prepared for Shelf 1.5.0. The checks below describe pre-release verification. Signing, notarization, publication, and website deployment are tracked in the repository release and deployment histories. Implementation tests used isolated data and did not replace the installed app or real client connection files.

## Changes and acceptance evidence

| Area | Result | Main files |
| --- | --- | --- |
| Shared output | Commands, logs, receipts, exports, and diagnostic reports use shared redaction. Configured secret values and quoted database URLs are covered. Pipe fragments are combined before masking; oversized lines are omitted. API identifiers and status values remain usable even when an environment value happens to match them. | `shared/types.ts`, `process-runtime-support.ts`, `receipt-store.ts`, `receipt-export.ts`, `launch-diagnostics.ts`, `mcp/result.ts` |
| Client configuration | All four client integrations use one atomic writer with private config/backup permissions and checks against stale file contents. Disabled Codex entries and missing configured executables cannot qualify as matching connections. | `shared/client-config-file.ts`, the four client integration modules |
| Sharing | Git bundles include tracked source plus `shelf.json`; non-Git projects respect ignore files. Private stores and recovery markers are excluded. Desktop export previews the exact frozen file list before choosing an export destination. Credential-bearing repository URLs are rejected. | `shared/zip.ts`, `shared/tool-share.ts`, `electron/main.ts` |
| Runtime dependencies | Electron is updated from 36.9.5 to 44.3.0; Next and its ESLint config are updated to 16.3.4. Both complete dependency audits report zero known vulnerabilities. CI/release audits include Electron, and build jobs now use Node 22. Development requires Node 22.12 or newer. | Package manifests and lockfiles, CI/release workflows, `README.md` |
| Lifecycle | Per-tool leases serialize independent Shelf hosts. Stop cancels queued/in-flight starts. An owned existing instance is adopted even when port reassignment was requested. Stop supervises the process group after its shell exits, and failed termination retains ownership and a retryable PID. | `shared/process-operation.ts`, `process-identity.ts`, `process-manager.ts`, `process-lifecycle.ts`, `process-reconcile.ts` |
| Honest status | Printed URLs require a verified owned listener. A lost listener is distinguished from a live process. Connection configuration is labelled **Configured**; recent observed client activity is labelled **Client seen**. Simple mode no longer changes port-conflict policy. | Runtime modules, `shared/client-observation.ts`, `electron/mcp-connect-ipc.ts`, `src/lib/mcpConnectionStatus.ts`, `src/hooks/useLibrary.tsx` |
| Concurrent edits | Full tool saves require the current revision; runtime metadata uses patches against the latest record. Launch timestamps do not reset editorial revisions. Dirty forms survive external edits, show conflicts, and require explicit confirmation before discarding a draft. | `shared/library-store.ts`, `src/pages/ToolFormPage.tsx` |
| Library recovery | Invalid records are quarantined while valid tools remain available. Original data and its location are retained. Future schemas are refused. Filesystem failures during normalization/migration do not reset a valid library or receipt file. | `shared/library-validation.ts`, `library-store.ts`, `receipt-store.ts`, library IPC/UI |
| Shared run evidence | Desktop and MCP hosts read the same private per-run logs. Storage retains five runs per tool, capped at 2 MiB per run; reads/rendering are capped at 3,000 lines. The open detail page refreshes shared logs once per second without overlapping reads. Storage failures expose locally retained output with a warning. | `shared/run-log-store.ts`, `process-runtime-support.ts`, `src/pages/ToolDetailPage.tsx` |
| Diagnostics | Copying a launch report first opens a native modal preview. Escape restores focus to the invoking control. | `src/components/DiagnosticReportDialog.tsx`, detail page and overlay styles |
| Import recovery | A registration failure after moving files preserves the destination and a durable journal. Shelf offers Resume import after restart and reuses those files without another download. Environment inputs are not saved in the journal. | `shared/import-journal.ts`, sharing service/IPC, `StudioShell.tsx`, `AddSharedToolDialog.tsx` |
| Update recovery | Updates pin the reviewed commit and working-tree state. Destructive updates preserve a Git restore ref and refuse untracked-file collisions. Durable phases allow metadata/save/setup recovery; successful setup steps are skipped on explicit resume. Changed tracked files block recovery until reconciled. A moved remote does not prevent finishing an already-applied pinned revision. | `shared/update-journal.ts`, sharing service/IPC, `UpdateSheet.tsx` |

## Verification

The following completed successfully against isolated fixtures:

- `npm run typecheck` across renderer, shared, Electron, and MCP projects.
- `npm run smoke:all`, including the existing process, import, ownership, health, sharing, catalog, Electron, MCP, design, contention, and stress checks.
- Two added suites: `scripts/smoke-phase1.mjs` and `scripts/smoke-recovery.mjs`, included in the standard smoke gate.
- `npm run build` and unsigned arm64 packaging with Electron Builder.
- Packaged application startup from `release/mac-arm64/Shelf.app`, with its renderer loading from `app.asar` and an isolated library.
- A separate client against the packaged MCP bundle: initialize, register, launch, retrieve shared/redacted logs, stop, and remove.
- Site lint and production build on Next 16.3.4; rendered home and download-route checks.
- Complete desktop and site npm audits: zero vulnerabilities at verification time.
- `git diff --check`.

New fault-injection cases verify:

1. Two simultaneous OS processes produce one owned run, not two launches.
2. A cross-host Stop invalidates a start before it can launch late.
3. A refused termination retains a retry target; the next Stop can succeed.
4. A surviving descendant is terminated after its shell has already exited.
5. Printed fake readiness cannot produce a running service or persist a false port.
6. Split/quoted synthetic credentials do not appear in exported output.
7. Stale config/tool writes preserve newer edits.
8. Malformed records, future schemas, and migration write failures preserve recoverable data.
9. Import registration and update metadata failures resume from preserved files.
10. Failed setup retries only incomplete commands; intervening tracked edits block resume.
11. Noisy logs stay within retention limits, and write failure leaves local evidence accessible.

Rendered desktop checks verified shared agent logs, startup cancellation, dirty-form preservation and stale-save rejection, diagnostic preview/redaction, import resumption, bundle preview/cancellation, and neutral Configured labels. Screenshots are viewport evidence, not full-page captures or proof of every OS integration.

Verification artifacts include the gate/build/package/audit outputs, a packaged MCP smoke, and rendered screenshots. Local unsigned review builds are generated at `release/mac-arm64/Shelf.app`; public downloads come from the signed release workflow.

## Limits and rollout risks

- The Electron major-version change still needs a signed release check for Gatekeeper/notarization, login items, menu-bar behavior, global shortcut, and automatic updates. The unsigned fixture launch emitted a macOS login-item permission denial. Signing protections in the release workflow remain enabled; local packaging deliberately skipped signing and notarization.
- Local rendering/build success is not production deployment verification. Check the production deployment against the published commit.
- The site retains one existing `next/no-img-element` lint warning. Vite retains its large-bundle warning (about 1.26 MB minified / 279 KB gzip). Neither was hidden by relaxing a check.
- Existing runs created before this version cannot recover output that was never persisted. Current APIs default to the latest run; a historical log browser is future UX work.
- Redaction is a guardrail, not a general source-code secret scanner. Bundle and diagnostic previews remain important when sharing arbitrary source or text.
- Quarantine preserves malformed data; it does not guess how to repair it. Restoring invalid records and reconciling edits made during a paused update remain deliberate recovery work.
- Setup commands can have external side effects. Recovery tracks completed commands, but a command interrupted before its completion was recorded may require inspection before retry. There is no claim of exactly-once shell execution.
- A configured client is not authenticated proof of usability. Last-seen records describe observed, self-reported client activity; they are not authorization.
- Coordination uses the local data root and cooperative file locks. It does not introduce a daemon, database, or coordination across separate machines.

## Next step

Publish through the signed release workflow and verify the public downloads and website deployment. Then begin Phase 2 consolidation, using these regression cases as the behavior contract.
