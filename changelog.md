# Changelog

## Unreleased

- Invite-ready pack for Community 0.4.0: `docs/INVITE.md` (Gatekeeper install, Connect agents, example prompts, soft-launch checklist + draft GH release notes).
- Annotated the maintainer’s real library tools with capabilities + agentAccess so `shelf_find_capability` returns useful matches (library data only; backup under Application Support).
- Marketing site follow-ups: incorporate Capability Intelligence into landing Phase 2+ narrative (see `docs/LANDING.md`).

## 0.4.0 — 2026-07-26

- Community Capability Intelligence: task-oriented tool capabilities, declared agent access and readiness, explainable MCP discovery (`shelf_find_capability`), and a local Capability Gaps inbox.
- Library schema v3 migration (v2 backup on upgrade); gaps persist separately in `capability-gaps.json`.
- Tool form Advanced + Tool Detail surface capabilities/access/readiness; System nav adds Capability gaps.
- Child MCP activation/invocation remains out of scope — metadata and discovery only.
- Marketing site (`site/`): waitlist-first landing on Vercel (**shelf-site**); Domain: shelfmcp.com. Landing vision Phase 1 dual-surface demo shipped earlier on `main`.

## 0.3.20 — 2026-07-26

- Pre-launch process safety: only verified Shelf-owned process groups can be adopted/stopped; unrelated port listeners are refused.
- Correct lifecycle reporting for clean one-shot exits, early server exits, stubborn-process escalation, and URL-open failures.
- Confirm external `shelf://` launch/stop/restart actions and restrict tool URLs to HTTP(S).
- Serialize Electron/MCP JSON updates, use collision-free atomic writes, and back up corrupt library/preferences/receipt files before recovery.
- Preserve live ownership receipts during history cleanup and across Electron/MCP host startup.
- Run the full smoke gate against an isolated temporary data root; add library recovery and lifecycle regressions.
- Debounce window geometry writes and persist sidebar width once per drag.

## 0.3.19 — 2026-07-25

- Soft-launch code hygiene: split `process-manager` helpers (`process-lifecycle`, `process-runtime-support`); ToolForm helpers + Advanced component; `app.css` feature imports; MCP `result` helper.
- Keep TS/CSS modules near the ~500-line Community soft-launch bar.

## 0.3.18 — 2026-07-25

- Library first-run empty: “Your shelf is empty” with Add tool + Connect agents, ⌘N hint; hide search/filter toolbar when there are no tools.
- Tighter empty copy for Favorites / Running / Recent / Collections and filter-no-match.

## 0.3.17 — 2026-07-25

- Add/Edit tool form: folder-first **Essentials** (name, launch, URL/port, favorite); icons, tags, env, stop command, and notes under collapsed **Advanced**.
- Edit auto-opens Advanced when power-user fields already have content; explicit collapse (`localStorage` `'0'`) is respected across remounts.

## 0.3.16 — 2026-07-25

- Tool Detail action bar: context-aware primary (Launch when stopped, Stop when running), **Open** menu for folder/editor/Terminal (URL when idle), **⋯** for Restart / Remove.
- Shared `OverflowMenu` supports labeled triggers; styles live in `app.css` for detail + MCP Connections.

## 0.3.15 — 2026-07-25

- Prefer MCP server path `/Applications/Shelf.app/...` over `~/Desktop/Shelf.app` when both exist (Connect + Advanced copy).
- Desktop→Applications mismatch shows an Update hint; Connect rewrites client configs to the durable path.
- `install:desktop` installs Applications first and recommends opening from there; smoke `smoke:mcp-path`.

## 0.3.14 — 2026-07-25

- Redesign **MCP Connections**: overview summary, compact client rows (one primary action + ⋯ menu), Advanced collapsed by default.
- Sidebar: Library / Collections / **System** (MCP Connections + Settings once).
- Progressive disclosure: server path, deep links, manual guides, and tool list live under Advanced only.
- Advanced section spacing: wider gaps between blocks, list items, code blocks, and copy actions.
- Advanced disclosure uses a clear SVG chevron (sidebar stroke weight); MCP nav mark is a plug icon.
- Library list mode: keep Launch/Open on one row (flex inside the cell, not on the `<td>`); table scrolls horizontally when needed.

## 0.3.13 — 2026-07-25

- One-click **Connect Codex**: surgical upsert of `[mcp_servers.shelf]` in `~/.codex/config.toml` (preserves other servers/env tables; backup on change).
- MCP Connect UI: shared connect heroes + client guides module; Electron MCP IPC extracted to `mcp-connect-ipc.ts`.
- Soft-launch hardening: TOML section helpers (`shared/toml-section.ts`); smoke `smoke:codex-connect`; size audit notes in PRODUCT.

## 0.3.12 — 2026-07-25

- Product depth: one-click **Connect Cursor** (mirrors Claude — merges `mcpServers.shelf` into `~/.cursor/mcp.json` with backup + Disconnect).
- Receipt filters (All / Stopped / Problems / Active) + Export JSON/CSV from Recent and Settings.
- Richer menu-bar Running list: per-tool submenu with port label, Open in Shelf, Open URL, Stop.
- MCP Connect: `shelf://` deep-link examples; Quick Open shows recent-run receipts (↵ open, ⌘↵ launch/stop).
- Shared `node-resolve` for Claude/Cursor Connect; smokes: `smoke:cursor-connect`, `smoke:receipt-export`.

## 0.3.11 — 2026-07-25

- Claude Connect honesty: distinguish “installed in config” vs “Live in Claude” (detect MCP logs); clearer Quit Claude guidance — Settings → Connectors web list is not where local `shelf` appears.

## 0.3.10 — 2026-07-25

- Fix Claude Connect stuck on “Checking…”: resolve Node via filesystem candidates first (avoid hanging `zsh -lc`); always settle status; keep Connect clickable after status loads.

## 0.3.9 — 2026-07-25

- One-click **Connect Claude Desktop** on MCP Connect: merges `mcpServers.shelf` into Claude’s config, detects Node via login shell, shows Connected status, Disconnect, Open Claude, and a copyable test prompt.
- Safe merge preserves other MCP servers; backup written to `claude_desktop_config.json.shelf-backup` when replacing an existing file.
- Smoke: `npm run smoke:claude-connect` (included in `smoke:all`).

## 0.3.8 — 2026-07-25

- Adopt-by-port: when MCP (or another ProcessManager) launches a tool, Shelf detects the listening port, shows Running (external), and Stop kills that PID — no relaunch required.
- Default launch on a busy configured port adopts the listener instead of erroring; `onPortConflict=reassign` still starts on a free port.
- Smoke: `npm run smoke:adopt` (included in `smoke:all`).

## 0.3.7 — 2026-07-25

- Fix New collection: Electron does not support `window.prompt` (always null). Sidebar and Quick Open now use an in-app name dialog.

## 0.3.6 — 2026-07-24

- Polish / hardening: MIT LICENSE, scrub personal MCP path placeholder, GitHub Actions CI (`typecheck` + `smoke:all` on macOS).
- Menu bar Template icon (`TrayIconTemplate.png` / `@2x`) instead of force-templating the Dock mark.
- Global shortcut conflict UX: status banner, preset chips, blur/Enter commit, startup notification when registration fails.

## 0.3.5 — 2026-07-24

- Menu bar tray: open Shelf, Quick Open, stop running tools, Settings, Quit; click toggles window.
- Global show/hide shortcut (default ⌘⇧Space) with Settings toggles; close-to-menu-bar option.
- OS `shelf://` URL scheme: open, quick-open, tools/{id}[/launch|/stop|/restart], launch?name=.
- Single-instance lock so Dock/`shelf://` reopens forward into the running app.

## 0.3.4 — 2026-07-24

- Run receipts: durable launch history in `receipts.json` (capped at 400), written on start/stop/crash/timeout.
- UI: Recent shows launch receipts; tool detail has Run history; Settings can clear all.
- MCP: `shelf_list_receipts`, `shelf_clear_receipts` + smoke coverage.

## 0.3.3 — 2026-07-24

- Lucide icon picker with background + icon color (tool form + Settings defaults).
- Tools store `iconLucide` / `iconColor` / `iconBackground`; Lucide marks render ahead of custom image paths.
- MCP upsert accepts the new icon fields.
- Fix empty Lucide picker grid: icons are forwardRef components, not functions.

## 0.3.2 — 2026-07-24

- Smart project import: choosing a folder (or Suggest) scans for package scripts, package manager, Python/Docker markers, ports, tags, and DESIGN.md.
- Busy preferred ports are rewritten to a free port with pinned launch flags; review card can apply all or fill empty fields only.
- MCP `shelf_inspect_project` + `npm run smoke:import` (included in `smoke:all`).

## 0.3.1 — 2026-07-24

- Quick Open (`⌘K`): command palette for tools, collections, and common actions.
- Enter opens a match; `⌘↵` launches or stops the selected tool. Menu: View → Quick Open…
- Ranking smoke (`npm run smoke:quick-open`) included in `smoke:all`.

## 0.3.0 — 2026-07-24

- Community UI polish: sidebar IA (Running/Recent/Collections/Settings), tag filters moved out of the sidebar, compact toolbar with search/filter/list-grid, system/light/dark appearance, persisted prefs.
- Collapsed sidebar is an icon rail (labels/counts hidden; tooltips + aria-labels keep names).
- Collections with library.json v2 migration (backup + atomic writes).
- Project-local DESIGN.md detection in tool detail + MCP (`shelf_get_design_md`, `shelf://tools/{id}/design-md`).
- Profiles commerce remains deferred; Community keeps full library/MCP capabilities.

## 0.2.6 — 2026-07-22

- Port safety for MCP register/launch: `shelf_find_free_port`, upsert `checkPort` warnings + optional `autoFixPort`, launch `onPortConflict=reassign`, log sniffing when frameworks hop ports, and skill guidance to pin free ports.

## 0.2.5 — 2026-07-22

- Bundle the MCP server with esbuild into a standalone `dist-mcp/mcp/server.js` so Cursor/Claude can launch it from Shelf.app without project `node_modules`.

## 0.2.4 — 2026-07-22

- Align sidebar brand mark and macOS app icon with the geometric periwinkle S used on the Dock.

## 0.2.3 — 2026-07-22

- Fix desktop install crash: Node `fs.cpSync` rewrote Electron Framework relative symlinks to absolute paths, causing missing `icudtl.dat` / GPU process death. Install now uses `ditto` and clears quarantine xattrs.

## 0.2.2 — 2026-07-22

- Package Shelf as a macOS `.app` via electron-builder (`npm run package:mac` / `npm run install:desktop`).
- Dev mode now requires `SHELF_DEV=1` so production/packaged launches load the built UI instead of Vite.
- Install helper copies Shelf.app to Desktop (and Applications when permitted).

## 0.2.1 — 2026-07-22

- Add MCP Connect page with setup guides for Cursor, Claude Desktop, Codex, Windsurf, and generic stdio clients.
- Expose absolute MCP server path via IPC for copy/paste into client configs.

## 0.2.0 — 2026-07-22

- Extract shared library/process core used by Electron and MCP.
- Add Shelf stdio MCP server (`shelf_*` tools) for agent registration and launch control.
- Add Cursor skill `.cursor/skills/shelf-register`.
- Add `npm run smoke:mcp` and `npm run smoke:all` pre-product gate.

## 0.1.3 — 2026-07-22

- Fix library appearing empty after relaunch: pin a stable Application Support path and migrate tools from the legacy nested `shelf/Shelf/library.json` location.

## 0.1.2 — 2026-07-22

- Fix missing tool icons: CSP blocked `shelf-icon://`, so images failed and fell back to the letter mark.
- Load icons via IPC data URLs (`tools:iconDataUrl`) which CSP already allows.

## 0.1.1 — 2026-07-22

- Fix broken tool icons: pass absolute paths as a query param so Chromium does not treat `%2FUsers…` as a hostname.
- Fall back to the letter mark when an icon fails to load.
- Improve env parsing for wrapped continuation lines.
- Clarify Python venv launch guidance and `.env.local` usage in the tool form.

## 0.1.0 — 2026-07-22

- Initial Shelf Electron + Vite + React prototype.
- Suds System Studio design tokens and Studio shell.
- Local tool library with JSON persistence under Application Support.
- Launch / stop / restart with live logs, status pills, and port readiness polling.
- Open URL, Finder, Cursor/VS Code, and Terminal actions.
- Sample fixture tool and smoke tests (`npm run smoke`, `npm run smoke:electron`).
- Product brief in `docs/PRODUCT.md`.
