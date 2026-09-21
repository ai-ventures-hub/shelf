# Shelf 2.0.0 desktop polish

Implemented on `codex/shelf-2-desktop-polish`, based on published 1.9.0.
This is a local release candidate. Packaging, signing, notarization, and publication
remain the next release step.

## Changes

- **Updates:** A compact notice sits above AI Connections and Settings. Its popover
  shows checking, download progress, errors with retry, or an explicit restart
  button. Opening it never installs an update. Ready notices can be dismissed for
  that version for the session; Settings retains the installation action.
- **Shared state:** `AppUpdateProvider` owns one renderer subscription, prevents
  duplicate actions, and avoids overwriting newer events with an older read.
  A rejected restart leaves the downloaded update available and shows the error.
- **Navigation:** Each tool has Overview, Runs, Verify, and Memory & handoff links.
  Runs has its own route, output selection, report preparation, and history.
  Selected launch-run links survive reload and handoff navigation; verification
  run identifiers remain separate. Existing overview, context, verify, and edit
  routes remain intact. Sharing is in the existing More actions menu.
- **Settings:** General, Appearance, Shortcuts, Updates & About, and developer-only
  Advanced sections replace the long single page. Existing preference handlers
  and data remain unchanged.
- **Presentation:** Explicit button colors and states, 36px standard controls,
  32px compact controls, 28–32px page titles, sentence-case section titles, shared
  spacing, fixed sidebar footer, and independently scrolling primary navigation.
  Log and code panels now respect light appearance. Route changes reset page
  scroll without resetting selected-run changes within Runs.

## Files and boundaries

| Area | Main files |
| --- | --- |
| Shared update state and presentation | `src/hooks/useAppUpdate.tsx`, `shared/app-update-presentation.ts`, `src/components/SidebarUpdate.tsx`, `src/components/AppUpdatePanel.tsx` |
| Shell and route wiring | `src/App.tsx`, `src/components/StudioShell.tsx`, `shared/ui-navigation.ts` |
| Tool sections | `src/components/ToolPageHeader.tsx`, `src/pages/ToolDetailPage.tsx`, `src/pages/VerificationPage.tsx`, `src/pages/ProjectContextPage.tsx`, `src/components/ReceiptHistory.tsx` |
| Settings and copy | `src/pages/SettingsPage.tsx`, `src/pages/DesignListPage.tsx`, `src/pages/TeamToolsPage.tsx` |
| Shared styling | `src/styles/desktop.css`, `tokens.css`, `primitives.css`, `shell.css`, `library.css`, `detail.css`, `mcp-connect.css`, `app.css` |
| Regression checks and release metadata | `scripts/smoke-desktop-ui.mjs`, `scripts/smoke-all.mjs`, `package.json`, `package-lock.json`, `changelog.md` |

The old floating UpdateBanner and independently subscribed update hook were
removed. No dependencies, MCP capabilities, execution permissions, store formats,
process supervision, or updater installation rules changed.

## Verification

- `npm run typecheck`: passed.
- `npm run build`: passed. The existing main-bundle warning above 500 kB remains.
- `npm run smoke:all`: passed, including the new desktop presentation/navigation
  checks and existing process, recovery, security, sharing, memory, verification,
  Electron, and MCP suites.
- `node scripts/smoke-desktop-ui.mjs`: passed again after final presentation changes.
- `git diff --check`: passed.

Native Electron QA used temporary data roots, disposable project folders, and
isolated preferences. Updates were simulated through fixture IPC; the real updater
was not asked to download or install anything. Current/target version labels in
those screenshots are test values, not a claim that 2.0.0 has been published.

Screenshots were captured and inspected around 900×600 and 1280×860, in dark and
light appearance, covering Library, Overview, Runs, Verify, Memory & handoff,
Collections, Design Profiles, Team Tools, AI/MCP Connections, Add Project, and
Settings. Additional captures cover the update popover, progress, collapsed rail,
empty libraries, empty search, and list view. Artifacts are stored in the task's
`shelf-2-ui` visualization directory, outside the source repository.

Functional checks confirmed:

- Opening update details does not restart; rejected restart keeps the app open.
- Escape restores focus; Tab stays within popover controls; collapsed controls
  retain accessible labels. Dismissal moves focus to Settings. Long update errors
  scroll within the viewport, and keyboard navigation reaches Retry.
- Checking, 42% downloading, ready, error/retry, and unsupported states render
  correctly. Ready dismissal survives reload, remains available in Settings, and
  does not suppress a later version.
- A selected launch run survives direct-route reload and reaches handoff as the
  selected evidence. Missing output has a readable explanation.
- Memory and verification-command drafts both prompt before leaving. Stay retains
  the draft; Discard proceeds. No real notes were edited.
- A reviewed two-step fixture verification kept running across section navigation
  and finished with both steps passed.
- Simple mode hides Advanced settings. Long names, absent descriptions, fifteen
  collections, list view, empty libraries, and empty-search recovery remain usable.

Native review found and corrected inherited scroll position, tight output-control
spacing, stretched page-header buttons, and poor light-theme output contrast.

## Release boundary

The installed Shelf app, real library, client connection configuration, and public
website were not changed. The remaining delivery work is the normal signed and
notarized macOS package review and publication. Live GitHub download/install
behavior must be checked against that signed artifact; simulated UI states do not
prove the distribution channel.
