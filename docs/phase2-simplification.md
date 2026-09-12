# Phase 2 simplification

Phase 2 keeps Shelf's Electron, React, standalone MCP, and local JSON-store architecture. The work consolidates rules that had drifted between hosts and separates existing transaction steps so they can be reviewed independently.

## Where changes belong

| Rule or responsibility | Canonical home | Callers and compatibility |
| --- | --- | --- |
| Tool fields, ports, and declared access validation | `shared/tool-validation.ts` | Library validation permits omitted legacy fields; MCP tightens required input fields using the same schemas. Tool types are inferred from validation. |
| Cross-host data contracts | `shared/contracts.ts` | Renderer and backend re-export the same declarations. No Node runtime dependencies. |
| Desktop bridge payloads and callbacks | `shared/desktop-api.ts` | Preload must satisfy `ShelfApi`; the bridge smoke also checks channel/key parity. |
| Client config replacement, backups, and permissions | `shared/client-config-file.ts` | Phase 1's guarded writer remains authoritative. Client adapters retain format-specific parsing. Redundant status reads were removed. |
| Credential redaction | `shared/types.ts` | Existing Phase 1 output sanitizers remain authoritative. |
| Package metadata, package-manager priority, and installed dependency facts | `shared/project-facts.ts` | Import, registration, preflight, first setup, and update setup planning share observations. |
| Port-conflict policy | `shared/process-port-policy.ts` | ProcessManager retains launch serialization and delegates the decision. |
| Receipt and listener ownership | `shared/process-run-ownership.ts` | Reuses existing PID identity/ancestry checks and receipt storage. |
| Lifecycle and readiness | `shared/process-manager.ts`, `shared/process-lifecycle.ts`, `shared/process-reconcile.ts` | Existing APIs, cancellation, ownership checks, and state transitions are preserved. |
| Runtime/log persistence | `shared/process-runtime-support.ts`, `shared/receipt-store.ts`, `shared/run-log-store.ts` | Existing stores and recovery behavior remain unchanged. |
| Sharing | `shared/tool-share.ts` | Public facade over export, staging, confirmation, update inspection/application, Git, and path modules. |
| Interrupted transactions | `shared/import-journal.ts`, `shared/update-journal.ts` | Existing journals remain the recovery authority for the split sharing modules. |
| Archive execution | `shared/archive-tasks.ts`, `shared/archive-worker.ts` | Existing ZIP inclusion, path, symlink, and size rules stay in `shared/zip.ts`. |
| Preference defaults and shortcut presets | `shared/types.ts`, `shared/global-shortcut.ts` | Renderer uses the actual defaults and presets rather than maintained copies. |
| Design-token traversal | `shared/design-tokens.ts` | Editor and agent briefs use the same flattening and token predicate. Editor-only mutation helpers remain in the renderer. |
| Relative-time display | `src/lib/relativeTime.ts` | Cards, receipts, tool detail, and catalogs share the calculation while keeping their existing empty labels and thresholds. |

## Behavior boundaries

- Simultaneous full-library runtime reads share one reconciliation pass. A later read probes again; there is no new time-based stale cache. Tray updates reuse already available runtime evidence.
- Archive compression and extraction run outside the main event loop. Each host serializes archive requests, enforces a five-minute timeout, and waits for worker termination before rejecting a failed or cancelled operation. The staging owner can then remove partial files safely.
- Bundle review still freezes both the file list and the bytes. Export does not reread source after review.
- The build emits a standalone archive worker next to the MCP bundle. Packaged Electron loads that worker from Resources rather than inside the asar archive.
- Project inspection remains read-only. Initial setup installs missing dependencies; explicitly requested update setup can reinstall existing dependencies. Package-manager precedence remains pnpm, yarn, bun, npm.
- The library schema still accepts legacy omitted fields and preserves unknown stored fields. It does not introduce a migration or change the library version.
- Renderer defaults now match persisted defaults. Existing saved preferences continue to win once loaded.
- No dependencies were added. No UI routes, MCP tool names, or storage files were replaced.

## Verification

`scripts/smoke-phase2.mjs` is part of `npm run smoke:all`. It verifies browser bundling without backend runtime imports, schema bounds and legacy compatibility, consistent project detection/setup planning, concurrent runtime read coalescing and retry, and archive responsiveness, frozen bytes, exclusions, containment, byte limits, cancellation, and queue recovery.

Release gates remain `npm run typecheck`, `npm run smoke:all`, and `npm run build`. The existing suite covers independent process hosts, ownership refusal, start/stop races, secure config writes, redaction, malformed library recovery, sharing consent, update recovery, and MCP integration. Electron compilation also passes with unused-local and unused-parameter checks enabled.

Final verification on September 12, 2026:

- Typecheck, the complete smoke suite, production build, and Electron/MCP unused-symbol checks passed.
- An unsigned arm64 Mac app packaged successfully. Its asar-loaded archive client exported and extracted through the standalone Resources worker in Electron, preserving secret-file exclusions.
- The packaged MCP server passed initialize, tool registration, launch, shared redacted logs, stop, and removal using a disposable library.
- The real Electron renderer and preload passed fixture launch, live logs, Stop, finalized receipt, Settings, mode persistence across reload, profile creation, token editing, and token persistence across reload. Saved JSON and the agent-facing brand brief both contained the edited color. The running tool and profile editor were visually inspected at the test window size.
- The desktop fixture disabled OS login items, global shortcut registration, and menu-bar integration. Its test wrapper suppressed protocol-handler registration to preserve the installed app's association. These OS integrations were not retested visually in this phase.
- `git diff --check` passed. The existing Vite large-chunk warning remains.

This phase is a local implementation, not a published release.

## Deliberate limits

The renderer's large-bundle warning remains. This phase removes redundant probes and moves archive work off the event loop; it does not claim a measured cold-start improvement or reduce the full renderer bundle. Archive buffers remain bounded but in memory. Streaming archives, broader UX changes, and end-to-end environment guidance belong in a later scoped change.

The installed app, personal library, AI-client configurations, and live website are not Phase 2 test fixtures. Verification uses temporary data roots. A signed/notarized release and auto-update delivery require the subsequent publishing step.
