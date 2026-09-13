# Phase 3 — Improve

Implemented on `codex/phase3-improve`, based on the published `v1.6.0` release. This phase improves existing desktop workflows. It adds no dependencies, changes no store format, and does not publish a release or change the installed app.

## What changed

- **Add a project:** Add tool and folder drops open the same inspection/review page. Inspection does not register, install, or launch anything. Users can adjust the name, purpose, and command; save without running; or explicitly approve the displayed setup commands and run. Existing registrations link to their detail page. Manual configuration remains available.
- **Run evidence:** Last run is prominent on the detail page. Select a retained run to read its logs and prepare a report using its recorded command and outcome. Reports still require review before copying. The project folder is explicitly identified as the current library value, because older receipts did not snapshot it. Intentional app quits now record stopped runs instead of failures.
- **Environment and design context:** Read-only checks identify missing folders, dependencies, package metadata, supported runtimes, Docker availability, and configured manifest environment keys. Values are not displayed. Setup has an explicit command-review dialog. The detail page identifies the effective design profile and whether it comes from a collection or the default.
- **Team setup:** Create a team catalog from selected local tools with Git remotes. Preview the validated file, save it through a native file dialog, and copy instructions for publishing through the user's Git host. Tools without remotes are explained and omitted. Existing catalog operations now recover from rejected requests and show retry feedback.
- **Keyboard and edit safety:** Shared native dialogs contain focus and restore it when closed. Card controls are siblings of the navigation link. Tool forms and unsaved design JSON have navigation guards; pending operations also block accidental navigation. Reload/close use native confirmation. Quit/update checks happen before stopping services, and cancelling quit preserves both the form and running tools.
- **Update visibility:** Settings shows current version, check/download state, progress, last successful check, errors, and retry. A downloaded update remains available after renderer reloads and later feed errors. Checks coalesce and installation requires a ready download. The banner handles installation failures.
- **Loading and performance:** Secondary routes and individual SVG icons load on demand. The picker uses icon-name metadata instead of importing every SVG. Failed routes offer reload/library recovery. Preferences and receipt loads report failures. Logs use debounced local events and poll only visible external running tools. Library reconciliation takes one listener snapshot instead of probing each tool separately; failed snapshots fall back to individual checks without changing ownership checks.
- **Landing copy:** Registration copy reflects review-before-install behavior. Manual tools are correctly described as discoverable and launchable through Shelf's MCP interface.

## File map

| Area | Main files |
| --- | --- |
| Registration | `src/pages/AddProjectPage.tsx`, `ToolFormPage.tsx`, `src/components/StudioShell.tsx`, `shared/register-project.ts` |
| Dialogs and navigation | `src/components/Modal.tsx`, existing name/Quick Open/sharing/design dialogs, `src/hooks/useUnsavedChanges.tsx`, `src/main.tsx`, `electron/main.ts` |
| Run output and reports | `src/pages/ToolDetailPage.tsx`, `src/components/LogPanel.tsx`, `src/hooks/useReceipts.ts`, `shared/process-runtime-support.ts`, `shared/launch-diagnostics.ts` |
| Environment | `shared/tool-environment.ts`, `src/components/ToolEnvironmentPanel.tsx` |
| Team catalog | `shared/catalog-starter.ts`, `src/components/sharing/CatalogStarterDialog.tsx`, `src/pages/TeamToolsPage.tsx` |
| Updates | `electron/auto-update.ts`, `shared/app-update-state.ts`, `src/hooks/useAppUpdate.ts`, `AppUpdatePanel.tsx`, `UpdateBanner.tsx` |
| Performance | `shared/ports.ts`, `process-manager.ts`, `process-reconcile.ts`, `process-run-ownership.ts`, `src/App.tsx`, `src/lib/selectedIcon.tsx`, `lucideCatalog.ts`, `LucideIconPicker.tsx` |
| Contracts and feedback | `shared/contracts.ts`, `shared/desktop-api.ts`, `electron/preload.ts`, `src/hooks/useLibrary.tsx`, `usePrefs.tsx`, onboarding gate, `AppErrorPage.tsx` |
| Styling and copy | `src/styles/{forms,library,detail,team,overlays}.css`, `site/src/lib/landing-content.ts` |
| Verification | `scripts/smoke-phase3.mjs`, `scripts/smoke-all.mjs`, `scripts/benchmark-desktop.cjs` |

## Verification

- `npm run typecheck` and `npm run build` pass.
- `npm run smoke:all` passes, including the Phase 1/2 regressions, ownership/adoption, real Electron and MCP process tests, sharing/catalog recovery, and design stress tests.
- Focused Phase 3 tests cover review/save consent, missing/malformed project diagnostics, secret exclusion, catalog validation, update-event recovery, concurrent update checks, ready retention, batch-listener fallback, historical report identity and masking, and intentional quit classification. Bridge and diagnostic tests were rerun after the report changes.
- Desktop dependency audit and the site production-dependency audit both report zero vulnerabilities.
- The landing site's lint and production build pass. Its existing `AppShowcase.tsx` image warning remains; there are no lint errors.
- Native desktop verification used a separate `SHELF_DATA_ROOT`, disabled login/shortcut/tray registration, and suppressed protocol registration. Verified folder selection, inspection, save-without-launch, one-shot launch, card launch without navigation, live logs, stop, historical logs after restart, historical report selection while another run was active, catalog preview/export/readback, icon rendering/search, update development state, modal Tab/Escape/focus restoration, unsaved navigation, and quit cancellation with a live PID. Final quit stopped the fixture process.

## Performance measurements

Compared the same disposable 16-tool library against a separately built `v1.6.0` checkout. The benchmark preserves Node's custom promisify behavior, so counting subprocesses does not change their results.

| Measurement | v1.6.0 | Phase 3 |
| --- | ---: | ---: |
| Initial JavaScript entry, minified | 1,262.86 kB | 539.12 kB |
| Initial JavaScript entry, gzip | 278.92 kB | 150.03 kB |
| Listener checks before populated renderer | 32 | 2 |
| Listener checks over 15 seconds idle | 49 | 3 |

The entry bundle is about 57% smaller and idle listener checks fall by about 94% in this fixture. These are entry-bundle and subprocess measurements, not total package-size or CPU claims. Warm-cache first-paint timings are recorded in the benchmark artifacts; a single warm-cache comparison does not establish cold-start performance. Vite still warns that the entry exceeds 500 kB, so that remaining budget is visible rather than suppressed.

## Release boundary and next step

The installed app, real library, team repositories, and public site were not modified. No catalog was pushed. The live GitHub update feed, signed updater handoff, notarized package, and first-install experience still need the normal release checks. Environment checks cannot prove arbitrary custom commands, project-loaded env files, remote API credentials, or real service readiness.

Next: prepare the next minor release, run the signed/notarized distribution checks, then publish the desktop release and landing-copy update. The larger project-memory, context-packet, and reusable-workflow ideas remain Phase 4 work.
