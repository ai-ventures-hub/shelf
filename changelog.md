# Changelog

## 1.5.0 - 2026-09-11

- **Starts and stops stay coordinated.** Shelf and connected agents share a
  per-tool operation lock. Simultaneous launches reuse an owned process,
  Stop cancels pending startup, and failed termination stays visible and retryable.
- **Agent launches have shared logs.** The desktop and MCP clients read the
  same bounded run logs. Diagnostic reports open for review before copying,
  and configured credentials are masked across logs, reports, and history.
- **Status reflects evidence.** Printed URLs require an owned listener.
  Connections show Configured until Shelf observes client activity. Simple
  and Developer modes now use the same port-conflict policy.
- **Edits survive concurrent work.** Stale saves cannot overwrite a newer
  tool record, and external changes preserve unsaved form fields. Invalid
  library records are set aside with a recovery notice while valid tools remain available.
- **Sharing is safer to recover.** Bundle exports show their exact file list
  and respect source-control membership and ignore rules. Imports and updates
  retain recovery records after partial failures, and update retries skip
  setup commands already recorded as complete.
- **Runtime and release hardening.** Client configuration and backups use
  private atomic writes. Electron is updated to 44.3.0 and the website to
  Next.js 16.3.4. Release audits include the shipped Electron runtime.
  Building Shelf from source now requires Node.js 22.12 or newer.

## 1.4.1 — 2026-08-27

- **The Team Tools field looks like the rest of the app.** The box you
  paste a catalog URL into was rendering with the browser's own styling
  instead of Shelf's, so it sat on the page as a plain white-bordered
  rectangle next to a styled button. It now matches every other field in
  the app, and it greys out while a catalog is being fetched.

## 1.4.0 — 2026-08-26

- **Your team's tools, in one list.** Sharing a tool used to mean
  remembering to send someone a link, and links scroll away. Now a team is
  a git repo holding a `catalog.json`, and everyone points Shelf at it
  once. **Team Tools** shows everything your teammates published, and
  Install runs the same consent sheet as any other shared tool: the full
  source, the exact setup and launch commands, an input for each env key,
  and nothing running until you approve. Anyone who can clone the repo is
  on the team, so access is whatever your git host already says it is. No
  Shelf server, no account, no registry.
- **Share with team.** On a tool with a git remote, the ⋯ menu adds your
  entry to a catalog and pushes it. What travels is a pointer — the name,
  what it does, its capabilities, and the repo. No launch command, no setup
  steps, no env keys; those still come from the tool's own `shelf.json`
  when someone installs it, and a catalog can never change what a tool
  runs. Shelf refuses to publish a name, description, or capability that
  looks like it holds a credential, the same way Share already refuses to
  export one.
- **The catalog file stays the team's.** Shelf edits the one entry it owns
  and leaves the rest of the file alone, including fields and rows this
  version doesn't understand. If a push doesn't go through, your entry
  stays committed on your Mac and Shelf tells you how to finish it. If the
  catalog moved on while you were away, Shelf rebuilds your entry on top
  of it instead of getting stuck.

## 1.3.0 — 2026-08-23

- **Agents can build collections now.** `shelf_upsert_collection` lets a
  connected agent create a collection and put tools in it, so "make a
  Movie Studio shelf with these three tools" works without you opening
  the app. It follows the same draft-and-adopt rule as design profiles:
  what an agent creates is marked **From agent** in Shelf, you can keep
  editing it there, and the moment you do it becomes yours and agents
  can no longer change it. Agents never bind a design profile to a
  collection, and never edit one you own. (Removing a tool from your
  library still removes it from every collection, as it always has.)
- **No look-alike names.** Names that render identically to something you
  already own can no longer be created by an agent. A collection or
  design profile whose name differs from yours only by an invisible
  character, an accent form, or extra spaces is refused, and invisible
  characters are stripped from every stored name, so nothing an agent
  writes can masquerade as yours in the sidebar or in Quick Open. Tool
  names fold invisible characters too, while keeping genuinely different
  names distinct. This covers invisible characters, compatibility forms,
  spacing, case, and Latin accents; it does not attempt to catch
  look-alike letters borrowed from other alphabets.

## 1.2.1 — 2026-08-23

- **Private repos share cleanly.** When you Add a tool from a private
  GitHub repo, Shelf now borrows the GitHub CLI’s sign-in for that one
  clone — the token stays with `gh`, never touches Shelf, and nothing is
  written to your global git config. If git still can’t reach it, the old
  raw “could not read Username… terminal prompts disabled” is replaced by
  a plain explanation and three ways forward: sign git in to GitHub
  (`gh auth login && gh auth setup-git`, one-click copy), use the SSH
  address Shelf shows you, or take a bundle. Same treatment for “Check for
  updates” on a private repo.

## 1.2.0 — 2026-08-23

If a tool works on your Shelf, a coworker gets it working on theirs in
two clicks — and no part of it runs on a server Shelf operates.

- **Share this tool.** On a tool's page, **Share** writes a `shelf.json`
  manifest into the project (launch command, port, tags, capabilities,
  agent access, setup steps, and env **names**) and, when the project has
  a git remote, copies a `shelf://add?repo=…` link to the clipboard. Env
  values are stripped structurally — the manifest is built from your
  env *keys* only, and there is no code path that can write a value.
  Share refuses when a free-text field looks like a credential. **Export
  bundle** (⋯ menu) zips the project with the manifest inside, minus
  `node_modules`, `.git`, and `.env*` files. Over MCP: `shelf_export_tool`.
- **Add from a link, URL, or bundle.** Opening a `shelf://add` link shows
  the source and waits for you to click **Fetch** — a link alone never
  downloads anything. Fetch (also from **Add from…** in the Library)
  pulls the project into a scratch folder and shows **one consent sheet**: the full source, the destination
  (default `~/Shelf Tools/<name>`, changeable), the exact setup and
  launch commands verbatim, the sender's notes, and an empty input per
  env key. Nothing runs or persists until you approve; approval runs the
  existing register → consented setup → launch pipeline with port
  healing. Repo URLs are allow-listed (https/ssh/git/`git@host:path`),
  manifest URLs must be localhost, and a manifest can never pick a
  folder outside the destination. If git is missing, Shelf points you at
  the Command Line Tools installer instead of failing silently.
- **Provenance and explicit updates.** Shared tools remember where they
  came from (`Shared from …` on the tool page). **Check for updates**
  fetches and shows the incoming commits and the manifest diff — nothing
  changes until you click **Update**, and manifest metadata only updates
  fields you hadn't edited locally. A diverged copy is said plainly:
  keep yours, or take theirs. Never automatic.
- **Deliberately not built:** an agent-driven receive (`shelf_add_shared_tool`)
  — it would skip the consent sheet by construction. The GUI is the only
  receive surface.

## 1.1.2 — 2026-08-16

One fix, a common one: launches no longer sit in **Starting** for 60
seconds when the app is already serving.

- **IPv6-only listeners are detected immediately.** Frameworks that bind
  `localhost` — Vite's default — often listen on IPv6 loopback (`::1`)
  only on macOS. Shelf's readiness probe only checked IPv4, so the card
  stalled in Starting for the full 60-second timeout (then recovered via
  log sniffing as "Running · port N (from logs)") while the app worked
  fine in your browser the whole time. The probe now checks both loopback
  stacks and flips to Running within about half a second of the
  framework's ready line. Machines without IPv6 are unaffected, and a
  regression test pins the fix.

## 1.1.1 — 2026-08-13

A security and hardening release. An external audit was independently
verified finding-by-finding; everything real is fixed, plus two issues
the audit missed that our verification found.

- **No env values reach agents, period.** Tool env vars were masked by
  key name (`*_TOKEN`, `*_SECRET`, …), which let secrets under other
  names — `DATABASE_URL=postgres://user:password@host` — through MCP
  output verbatim. Every env value is now `***` for agents, inline
  `KEY=value` prefixes in launch/stop commands and notes mask too, and
  an agent echoing a masked read back through upsert restores your real
  values instead of saving placeholders. Keys stay visible, and the
  in-app editor still shows your real values.
- **Log masking survives chunk boundaries.** Child output is masked per
  assembled line, with partial lines held until their newline arrives —
  a secret split across two pipe chunks used to evade redaction. The
  "Copy report for your AI tool" payload now also masks the launch
  command, matching run history.
- **Deleting a running tool can no longer orphan its process.** A
  failing custom stop command used to abort termination entirely; now it
  logs and the process is still killed. Delete (GUI and MCP) waits for
  the stop and refuses to remove the tool if stopping failed.
- **Tighter renderer boundary.** The renderer now runs fully sandboxed
  with all navigation and window-opening denied; an unused internal
  protocol that could read arbitrary files is gone, and icon loading is
  contained to Shelf's own icon folder (as brand assets already were).
- **Design profile ids are validated** before any filesystem path is
  derived from them — a traversal-shaped id planted in a hand-edited
  design-profiles.json now heals to a UUID instead of reaching a
  recursive delete.
- **Releases fail closed.** The release workflow refuses to build
  without signing credentials (an unsigned artifact can never reach the
  auto-update channel), always runs Gatekeeper verification, and gates
  the shipped artifact on the full smoke suite. CI now also builds the
  app and site and audits production dependencies.
- **Dependency refresh.** All production-dependency advisories cleared
  (React Router, MCP SDK transitive packages, js-yaml, Next.js on the
  site). Most were in code paths Shelf never executes; they are patched
  regardless, and CI now keeps them at zero.
- The MCP server now reports the real app version to connected clients
  (it had been introducing itself as 0.1.0).

## 1.1.0 — 2026-08-13

The Design Engine grows project roots: your brand can now come straight
out of your own code — plus stack context for agents and honest launch
health on every card.

- **Extract tokens from your project**: Shelf deterministically parses
  the design tokens a project already declares — CSS custom properties
  (including Tailwind v4 `@theme`, `.dark`/`[data-theme]` scopes, and
  `prefers-color-scheme` blocks, mapped to light/dark modes) and Tailwind
  config literals. Nothing is guessed: component-scoped and computed
  values are skipped and reported, `var()` references resolve against the
  final cascade, and identical input always produces identical output.
- **New profile wizard**: creating a profile now asks where to start —
  Blank (the starter palette) or From a project, which seeds the profile
  with only the extracted tokens, so an imported brand never carries
  starter leftovers. In the editor, **Import from project** stays
  additive by design: resync a profile without losing hand-set tokens.
- **The preview wears your real fonts**: font files imported as brand
  assets now render in the live preview via `@font-face`, matched to
  your declared families by filename — registered under preview-only
  names so they can never shadow the app's own fonts. Asset thumbnails
  also refresh correctly when you re-import the same filename.
- **`shelf_get_collection`**: one MCP call gives an agent a stack's full
  working context — members with readiness and live runtime state, and
  the brand profile the collection resolves to.
- **Launch health on every card**: an amber chip warns when Launch won't
  work right now — project folder missing, no launch command, or the
  tool's port taken by another process. One batched port scan covers the
  whole library; healthy tools show nothing (no decorative green).
- **Agent write path hardened**: profile ownership is now checked inside
  the store's write lock (no check-then-write race with GUI saves),
  agent drafts have size caps, and bare vendor credentials (`ghp_…`,
  `sk-…`, AWS keys, JWTs, private-key blocks) are refused on write and
  masked in logs and briefs — no `KEY=` needed.

## 1.0.0 — 2026-08-12

The Design Engine: Shelf becomes the local source of truth for how your
tools look and feel. Say "build it with my branding" in any connected
agent and it just works — no copy-paste, no design context from you.

- **Design profiles**: brand colors (with light/dark mode overrides),
  typography, spacing/radii, a markdown direction brief (voice,
  personality, do/don't), and logo assets — stored locally as W3C
  Design Tokens (DTCG), never in the cloud.
- **"Build this using my branding" over MCP**: agents discover
  `shelf_get_design_profile` from the tool description alone. A
  zero-argument call resolves your default profile and returns both the
  raw tokens (for wiring CSS/Tailwind) and a paste-ready markdown brand
  brief. Resolution precedence: explicit profile → tool's collection →
  collection → default. A project's own `DESIGN.md` still wins on
  conflict, and capability-gap build briefs now carry a Brand section.
- **A design editor that shows, not tells**: the new Design section
  edits colors with swatches, mode overrides with inherited/override
  affordances, fonts, dimensions, and direction prose — next to a live
  preview that repaints your brand on every keystroke, before anything
  saves. Everything auto-saves; assets import by picker or drag-and-drop;
  raw DTCG JSON paste lives behind a Developer-mode disclosure.
- **Show an agent a brand you love**: give your agent a URL or
  screenshot and it can save the extracted brand back via
  `shelf_upsert_design_profile` — as a draft. Agents can never set your
  default profile and can never modify a profile you own or have edited;
  making a draft the default adopts it as yours and locks agents out.
  Credential-looking content is refused in every field.
- **Collections carry a brand**: bind a profile to a collection and
  agents building for those tools resolve it automatically.
- **Stress-tested before shipping**: a new release gauntlet hammers the
  store with concurrent processes, 300-token profiles, hostile
  hand-edited files, 400-op churn, and 46 simultaneous MCP resolutions —
  and the robustness gaps it found are fixed in this release.

## 0.9.0 — 2026-08-10

The gap → build loop closes: what your agent couldn't do becomes a work
order, and what it builds comes back as a suggestion — with you making
the final call.

- **Copy brief for your AI tool**: every capability gap generates a
  paste-ready build brief — the task, requested capabilities, related
  existing tools (so agents extend rather than duplicate), and
  register-back instructions. Agents fetch the same brief directly via
  the new `shelf_get_gap_brief` MCP tool.
- **Tool suggestions in the Library**: when a newly registered (or
  newly capable) tool covers something an agent recorded as missing, a
  standalone suggestion card appears in the Library grid — uniform with
  your tool cards but clearly a notification, linking to the Capability
  gaps page where you resolve or dismiss. Suggestions are deterministic
  capability matches, deduped per tool, hidden during search/filtering,
  and never auto-resolve: resolution is always your click, and it
  records which tool closed the need.
- **Agents can plan, never decide**: the new
  `shelf_update_capability_gap` lets an agent mark a gap planned and
  attach the tool it is building — and nothing else. Resolved and
  dismissed are user-only; a user-decided gap cannot be reopened by an
  agent; unknown tool ids are rejected loudly instead of ignored.
- **Suggestion correctness hardening** (from the pre-release audit):
  tools track when their *capabilities* last changed, so launching or
  renaming an old tool never re-qualifies it as a suggestion; corrupt
  timestamps fail closed; gaps beyond the list cap still get briefs and
  suggestions; resolving with a just-deleted tool errors instead of
  losing provenance.

## 0.8.0 — 2026-08-09

Collections become stacks, and Shelf finally answers "who started this?" —
all on a hardened launch pipeline.

- **Start stack / Stop stack**: one control on a collection launches every
  member in order (already-running tools are skipped, never restarted) and
  stops everything Shelf owns on the way down — with a per-tool outcome
  summary and a live running counter. The tray gets a **Collections**
  section with the same stack controls, plus a global **Stop all**.
  Simple mode heals busy ports during stack launches, same as single
  launches; Developer mode surfaces the conflict per tool.
- **Agent provenance**: running cards now carry a chip showing who launched
  the tool — **You**, **Claude Code**, **Cursor**, or any other MCP client
  (identity captured from the MCP initialize handshake and stored on the
  run receipt). Visible in both Experience modes, in the list view, in
  Recent run history, and in tray labels ("via Claude Code"). Runs adopted
  from pre-0.8 receipts honestly show "Another agent".
- **Launch pipeline hardening**: concurrent launches of the same tool
  (a GUI click racing an agent's MCP call, or a stack launch) now coalesce
  into one process instead of double-spawning; port reassignment decisions
  are serialized so parallel launches can't claim the same free port; and
  external-process detection uses structured state instead of parsing
  status-message text.
- **Dev-only**: Chromium's HTTP cache is disabled in dev launches, so a
  wrong server squatting the vite port can never poison future launches
  into a blank window.
- **New pre-ship gates**: a stack/provenance smoke (double-start
  coalescing, adoption provenance, port-conflict fail/reassign paths) and
  a bridge-parity smoke that fails the build if the renderer contract,
  preload bridge, and IPC handlers ever drift apart.

## 0.7.0 — 2026-08-08

Simple Mode + the guided experience: Shelf now serves people entering vibe
coding, not just developers — without changing anything for developers.

- **Experience toggle (Simple / Developer)**: new first panel in Settings.
  Simple mode hides agent-integration surfaces (Capability Intelligence,
  Capability Gaps, MCP advanced panel, URL-scheme docs) and softens labels
  ("AI Connections", "Add a tool"). Existing users stay in Developer Mode
  untouched; new users get a mode derived from their onboarding answers.
  Presentation-only: the engine, data files, and MCP server behave
  identically in both modes.
- **Drop a folder, it runs**: drag a project folder anywhere onto the window
  (a dashed overlay invites the drop) — Shelf inspects it, saves it,
  installs missing packages with your consent (streamed into Live logs,
  never silently), launches, and opens the browser. Re-dropping the same
  folder updates instead of duplicating. Agents get the same one-shot flow
  via the new `shelf_register_project` MCP tool (`dryRun`/`runSetup` gated).
- **Plain-language launch failures**: failures now carry structured codes
  (deps_missing, port_in_use, port_timeout, bad_launch_command, …) shown as
  friendly remedy cards — "Launch on a free port", "Edit launch command",
  and **Copy report for your AI tool** (a paste-ready, secrets-masked
  failure report). `shelf_launch_tool` / `shelf_get_status` include the same
  `code` for agents.
- **Claude Code joins one-click connect** (user scope `~/.claude.json`,
  merge-only with backup), with installed-client detection so Simple mode
  shows only the AI apps on this Mac. Official brand marks (with dark-theme
  variants) replace the lettermark tiles, with attribution.
- **No more "Node needed"**: when no system Node exists, connect entries run
  the MCP server on Shelf's own bundled runtime (`ELECTRON_RUN_AS_NODE`) —
  zero-step connect on Macs without a dev toolchain.
- **Live library**: the GUI watches the shared data files and refreshes the
  moment an agent adds a tool or writes a receipt — no more relaunch to see
  what your agent just registered. Tray reflects it too.
- **Library cards**: inline controls (launch / stop / open in browser) with
  semantic colors, and the favorite star is now a one-click gold toggle on
  the card instead of a text prefix. Simple mode hides the tag/port chips
  for a cleaner grid. GUI launches in Simple mode heal busy ports
  automatically (developer keeps the explicit conflict).
- **Menu bar**: favorites now launch from the tray; the tray glyph lights up
  in brand indigo while any tool is running. New "Start Shelf when you log
  in" setting (packaged builds).
- **UI system pass**: one icon system (lucide) replaces text-glyph icons; a
  square icon-button primitive with normalized line-heights ends the
  slightly-off-center controls; Inter is self-hosted (no Google Fonts call
  at launch — metrics are deterministic offline and the privacy posture
  holds); light-mode fixes (empty-state slab, theme-aware tokens); AI
  Connections page fills the content width in a responsive two-column grid;
  a pulsing Starting pill while ports come up.
- Note: restart your MCP clients (Claude Desktop/Claude Code/Cursor/Codex)
  after updating so they load the new Shelf server bundle.

## 0.6.0 — 2026-07-29

- Agent clarity: every readiness surface now states that launching via
  `shelf_launch_tool` is always available. `manual_only` is rewritten to mean
  "no child interface declared", never "cannot launch"; responses gain
  `launchable`, `shelfActions`, `childInterface`, `interaction`, and a
  sanitized `access` list (kind/transport/entrypoint). The deprecated
  `suggestedAction: manual_use` is no longer emitted.
- Smart Import + `shelf_inspect_project` detect MCP interfaces a project
  provides (Node `@modelcontextprotocol/sdk`/`fastmcp`, Python `mcp` servers,
  project-local mcp.json configs) and prefill `agentAccess` so agents know how
  to connect to the tool after launching it. Shelf still never connects to or
  invokes child servers itself.
- Cross-process adoption hardening: ownership verification now walks process
  ancestry (bounded, all listeners must verify), fixing "port already in use"
  when a tool launched by your agent's MCP server has a deeper process tree
  (npm/vite workers, zsh job control). Portless tools are adopted via live
  run receipts instead of spawning duplicates; port-drift falls back to
  ancestry-verified adoption and heals the receipt; external stops finalize
  the other process's receipt.
- Quitting the Shelf GUI (or restarting for an update) no longer stops tools
  launched by your agent's MCP server — they stay running under the agent's
  ownership.
- Note: restart your MCP clients (Claude/Cursor/Codex) after updating so they
  load the new Shelf server bundle.

## 0.5.2 — 2026-07-28

- Auto-update: Shelf now checks the public GitHub releases feed in the
  background (on launch and every 4 hours), downloads updates silently
  (differential via blockmaps), and shows a restart banner when one is
  ready. Dismissing is safe — the update installs on the next quit.
  Running tools are stopped cleanly before the update relaunch.

## 0.5.1 — 2026-07-28

- In-app brand: the official Shelf mark (Brand Standard v1.0) replaces the
  prototype marks in the sidebar and onboarding — one shared component,
  gradient tile + ink glyph with the sanctioned glow.
- Onboarding copy overhaul: conversational questions with human step headers
  ("About you · Step 3 of 5"), refreshed answer options (AI-powered builder,
  "I'm just getting started", X (Twitter), Web search), consistent buttons
  ending in **Get Started**, "Your name" / "Email address" labels, and a
  lock-icon trust line — "Local-first · No account required · Privacy
  respected" — under the mark.

## 0.5.0 — 2026-07-27

- First public download release: builds are signed with a Developer ID Application certificate, notarized by Apple, and stapled — Gatekeeper-clean installs from a plain browser download.
- First-launch onboarding: one-time, fully skippable survey (optional name/email + four questions) gating the first run; answers POST once to shelfmcp.com/api/onboarding via the main process and queue offline for silent retry. The app's only user-data network call (PRODUCT.md → Distribution & privacy).
- Distribution: DMG + zip targets with a drag-to-Applications background, hardened runtime + entitlements, notarization wired (env-credential driven, degrades to unsigned when creds are absent), version-free artifact names for a stable `releases/latest` URL, and a tag-triggered GitHub release workflow.
- Marketing site: `/api/onboarding` endpoint (Neon `onboarding_responses`); Download-primary CTA + `/download` page replace the waitlist (deploys once the repo is public).
- Invite-ready pack for Community 0.4.0: `docs/INVITE.md` (Gatekeeper install, Connect agents, example prompts, soft-launch checklist + draft GH release notes).
- Annotated the maintainer’s real library tools with capabilities + agentAccess so `shelf_find_capability` returns useful matches (library data only; backup under Application Support).
- Marketing site Phase 2: interactive Capability Intelligence demo (match + readiness pills, Capability Gaps beat, prompt chips, Running vs agent-ready); benefit-first copy; redeploy shelf-site.

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
