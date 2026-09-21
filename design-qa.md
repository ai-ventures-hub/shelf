# Compact library and warning popover

final result: passed

## Visual target and evidence

- Selected source: `/Users/cjm/.codex/generated_images/01a0913c-ad75-7253-a949-a1f18fd3cb03/exec-b2c9915f-9102-47af-814a-0dc79fdc47ec.png`.
- Approved behavior: smaller 24px icons and 13px titles, full 32px actions, a separate warning row, fewer columns as available width decreases. The previously selected warning opens details on click.
- Implementation captures: `/Users/cjm/.codex/visualizations/2026/09/11/01a0913c-ad75-7253-a949-a1f18fd3cb03/shelf-compact/`.
- Full comparison: `comparison-full.png`. Focused comparison: `comparison-warning.png`. Both contain source and implementation in one image and were opened for review.
- Source pixels: 1726×911. It was generated for a nominal 1440×760 content viewport. Full comparison normalizes it to 1440×760.
- Native Electron window sizes: 1800×910 and 900×600. Captured client sizes: 1800×878 and 900×568 at 1×. Native macOS title chrome accounts for the height difference.
- For the full comparison, the native content crop `(284,16,1488,785)` excludes the sidebar and is normalized to 1440×760. This is a content comparison, not a pixel-difference claim about the existing desktop shell.
- State: Library, Compact selected, dark and light themes, stopped/running tools, and a busy-port warning. Fixture data has 17 tools. The tool count, colors, and icons reflect fixture records rather than invented changes to real tool data.

## Findings and corrections

- Resolved P2: Escape could restore focus to the document after programmatic opening. The dialog now explicitly closes and focuses its badge. Close also clears renderer state immediately for rapid reopening. Native keyboard checks pass for Escape, Space, and Tab to Close warning. The fixture explicitly focuses its native window before sending keyboard events.
- Resolved P2: a scrolled anchor could place the popover below a short viewport. Placement now clamps both axes, responds to scrolling/resizing, and constrains long content. Post-fix `warning-dark-small.png` and `warning-light-small.png` show contained popovers.
- Resolved polish: programmatic reading focus drew a large outline around the entire popover. Only the dialog container suppresses that outline; interactive controls retain focus indicators. Final `warning-dark-wide.png` confirms the restrained border.
- No remaining actionable P0/P1/P2 findings in the reviewed states.

## Required visual checks

- Typography: existing Inter remains. Tile names are 13px/18px, with two-line truncation and full accessible names/native title text. Status is readable text, not color alone. The generated mock rendered icons larger than its written size; the implementation follows the approved 24px size.
- Spacing: 14px tile padding, 12px grid gaps, dedicated 26px warning slot, 8px row gaps. Tiles are about 140px tall so all three rows and padding fit without crowding. Minimum 220px columns preserve three 32px action buttons; narrow windows reduce columns. Six columns fit at wide size and two at 900px.
- Colors: existing light/dark tokens and semantic warning/running/action colors. No palette or theme changes. The selected mock's exaggerated amber glow is replaced with the existing restrained warning colors.
- Images/icons: existing `ToolIcon`, custom icon support, Lucide loading, and fallbacks remain. Initial main screenshot waits for all fixture icons to load. No new raster assets or dependencies.
- Copy/content: all original library controls, tool counts, and names remain data-driven. Compact hides descriptions and developer metadata; launch provenance remains visible when present. The full warning preserves every blocker in priority order. Unknown/empty blockers have safe readable fallback copy.

## Functional verification

`scripts/smoke-compact-ui.cjs` runs the production renderer and real preference store in an isolated Electron profile. Process actions and external navigation are mocked at IPC, so no user tool runs or browser opens.

Passed: saved Compact preference and reload; Settings default selector; favorite/launch/stop/open handlers; Grid and List compatibility; details link; keyboard opening, Escape focus return, Tab access; outside dismissal; viewport containment; long names; multiple blockers; warnings suppressed on running tools; compact suggestion cards; dark/light and narrow/wide layouts. Renderer console errors: zero.

`npm run typecheck`, `npm run build`, focused desktop/prefs checks, and `git diff --check` passed. Build retains the existing main-chunk size warning.

The initial full smoke run hit port 8766, occupied by an unrelated existing Python preview server. That server was left running. The MCP smoke now accepts `SHELF_SMOKE_MCP_PORT`. For release 2.0.1, `SHELF_SMOKE_MCP_PORT=18766 npm run smoke:all` passed as one complete run, including sharing, catalog, and design stress. Dependency audit reported zero vulnerabilities. CI and the signed release workflow also run the renderer gate after building.

## Implementation boundaries and files

- `shared/contracts.ts`: adds the saved `compact` view value, without a storage migration.
- `shared/tool-health-presentation.ts`, `src/components/ToolHealthWarning.tsx`: short warning labels and native top-layer detail popovers.
- `src/components/ToolCard.tsx`, `SuggestionGridCard.tsx`: reuse existing cards/actions for the compact presentation.
- `src/pages/LibraryPage.tsx`, `SettingsPage.tsx`: third view selection and saved preference.
- `src/styles/library.css`, `desktop.css`: compact spacing and popover styles; old health-chip CSS removed.
- `scripts/smoke-compact-ui.cjs`, `smoke-desktop-ui.mjs`, `smoke-prefs.mjs`, `smoke-mcp.mjs`, `package.json`: focused regression command, warning/persistence checks, and configurable MCP fixture port.

## Next step

Prepare the next patch release, package and verify the signed artifact, then publish when requested. This change does not install or publish an update.
