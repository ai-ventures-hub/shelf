# Shelf — Product Brief

**Positioning:** A personal command center for the tools you build. Organize, launch, monitor, and maintain every local app from one place.

## Problem

AI-assisted builders accumulate many local utilities. Each is used infrequently, lives in a different folder, and requires a forgotten launch ritual (`npm run dev`, venv, Docker Compose, custom shell). Platypus packages individual scripts as `.app` files but does not provide a central library with lifecycle, logs, or documentation.

## Opportunity

Sit between productivity launchers (Raycast/Alfred), script wrappers (Platypus), and developer project dashboards (DevHub, Localhost Hub): a calm, App Store–like home screen for *your* tools with truthful process status.

## Personas

1. AI-assisted builder
2. Indie developer / consultant
3. Automation specialist
4. Designer-developer hybrid

## Shelf Community (current focus)

Free, local-first, no account required:

- Tool library with launch, stop, restart, status, and logs
- First-run empty Library (Add tool + Connect agents)
- Open URL, folder, editor, and Terminal
- MCP tools for agent registration and lifecycle control
- Search, filters, tags, collections, list/grid view
- Quick Open (`⌘K`) for tools, collections, and actions
- Smart project import (scripts, port, tags, DESIGN.md suggestions)
- Add/Edit form: essentials + Advanced (icons, env, tags, notes)
- Lucide tool icons with customizable background / glyph colors
- Run receipts / launch history (local, capped)
- Menu bar tray, global show/hide shortcut, OS `shelf://` URL scheme
- One-click Connect Claude Desktop, Cursor, and Codex (compact MCP Connections UI; Advanced for paths/tools)
- MCP path prefers `/Applications/Shelf.app` over Desktop when both exist
- Run receipt filters + JSON/CSV export; Quick Open recent-run actions
- Menu bar Running submenu (open / URL / stop) and `shelf://` deep-link docs
- System, light, and dark appearance
- Detect a project-local `DESIGN.md` and expose it to the current agent (`shelf_get_design_md`, `shelf://tools/{id}/design-md`)
- Capability Intelligence (0.4.0): task capabilities, declared agent access, readiness, `shelf_find_capability`, Capability Gaps inbox
- Design Engine (1.0.0): design profiles (DTCG tokens + direction + assets) with live-preview editor, collection binding, brand briefs over MCP, and agent-extracted draft profiles (`shelf_upsert_design_profile`, user-owned wins)

## Soft-launch readiness (Community)

**Done enough for soft launch:** library + lifecycle, MCP (Claude/Cursor/Codex), tray/`shelf://`, receipts, smoke gate, MIT license, CI typecheck+smoke.

**Before public soft launch:**

1. ~~Initialize git + GitHub remote; tag releases (`v0.4.0`)~~ — done (`v0.4.0` / `c6dad98`)
2. ~~Landing page + brand domain~~ — waitlist site in [`site/`](../site/) on Vercel **shelf-site**; live at **https://shelfmcp.com**. Phase 2+ should incorporate Capability Intelligence (see [`LANDING.md`](LANDING.md)).
3. ~~Prefer MCP path `/Applications/Shelf.app/...` over Desktop~~ (**0.3.15**)
4. ~~Code size follow-ups~~ (**0.3.19**)
5. Invite wave — see [`INVITE.md`](INVITE.md) (Gatekeeper, Connect, example prompts). Optional private GitHub Release notes for `v0.4.0`. Prefer small private invites over a public blast until Connect + discovery are proven with strangers.
6. Signed/notarized macOS build + auto-update (later Community)

## Shelf Profiles (future add-on)

Separately licensed commercial add-on — **not** required for Community use. Planned value:

- Central reusable Design Profiles, inheritance, versioning
- Assign profiles by tool/tag/collection
- Compile tokens, drift checks, agent receipts

Do not weaken or paywall Community capabilities to sell Profiles.

**Community/commercial split decided 2026-08-09** — the Design Engine core
(profiles, tokens, brand briefs, agent read path, collection binding) is
free Community in v1.0; Profiles keeps the agency tier (inheritance,
versioning, drift checks, compiled outputs). See
[`DESIGN-ENGINE.md`](DESIGN-ENGINE.md).

## Community Phase — Capability Intelligence (v0.4.x)

Free, local-first evolution from launcher to capability catalog:

- Task-oriented capabilities and declared CLI, MCP, or HTTP API access on each tool
- Deterministic, explainable agent discovery through `shelf_find_capability`
- Honest readiness: ready, needs setup, manual only, or unavailable
- Dedicated Capability Gaps inbox for unmet agent needs, recurrence, planning, and related tools
- Local schema-v3 migration with a v2 backup; gaps remain separate in `capability-gaps.json`
- No embeddings, hosted inference, accounts, child-MCP proxy, automatic installation, or tool invocation

**Approval gate:** existing libraries migrate without loss; connected agents can find a suitable
tool or record one deduplicated gap; all results explain the match and distinguish declared agent
access from GUI-only use.

Only after real usage demonstrates demand should Shelf consider curated one-click activation for
selected MCP tools. A universal child-MCP gateway remains out of scope.

## Roadmap

- **v0.9 — Gap → Build loop** (shipped 2026-08-10): agent briefs from
  capability gaps, resolve suggestions (never auto-resolve), agent
  `planned` status. See [`PLAN-0.9.md`](PLAN-0.9.md).
- **v1.0 — Design Engine** (shipped 2026-08-12): Shelf as the local source
  of truth for brand/design context; "build this using my branding" over
  MCP, GUI editor with live preview, and agent-extracted draft profiles.
  See [`DESIGN-ENGINE.md`](DESIGN-ENGINE.md).
- **v1.1 — Project roots** (shipped 2026-08-13): deterministic token
  extraction from a project's CSS variables / Tailwind config, the
  new-profile wizard (blank vs project-seeded), imported fonts in the
  live preview, `shelf_get_collection` stack context, launch-health
  chips on library cards, and agent write-path hardening.
- **v1.2 candidate — `shelf_upsert_collection`**: make "create a
  collection named X and build these N tools into it" work end-to-end
  over MCP. Ownership mirrors design profiles (agents draft, you
  decide): agent-created collections stay agent-editable until any GUI
  edit adopts them; agents may only add tools they registered
  themselves, and never bind or unbind a design profile on a
  user-owned collection.

## Later Community enhancements

1. Signed macOS distribution / auto-update

## Distribution & privacy

- Signed + notarized DMG (Apple Silicon) from public GitHub Releases; shelfmcp.com/download links `releases/latest`.
- First launch shows a one-time, fully skippable survey (optional name/email + four questions). Completing it sends **one** POST to shelfmcp.com/api/onboarding containing the chosen answers, optional contact info, app version, and platform. That is the only user-data network call Shelf makes — nothing else ever leaves the Mac, and "no account required" remains true (skipping contact still sends the anonymous answers).

## Security posture

User-authored commands only; no root; secrets masked in logs; folder pickers over blanket Full Disk Access; not App Store sandboxed (arbitrary child processes).
