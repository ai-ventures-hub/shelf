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

## Soft-launch readiness (Community)

**Done enough for soft launch:** library + lifecycle, MCP (Claude/Cursor/Codex), tray/`shelf://`, receipts, smoke gate, MIT license, CI typecheck+smoke.

**Before public soft launch:**

1. Initialize git + GitHub remote; tag releases (`v0.3.x`)
2. Landing page + brand domain (download / waitlist — unsigned local build is fine for invitees)
3. ~~Prefer MCP path `/Applications/Shelf.app/...` over Desktop copy when both exist~~ (**0.3.15**)
4. ~~Code size follow-ups (keep TS/TSX under ~500 lines)~~ (**0.3.19** — process-manager split, ToolForm extract, `app.css` feature barrel; `mcp/server.ts` already under bar)
5. Signed/notarized macOS build + auto-update (later Community)

## Shelf Profiles (future add-on)

Separately licensed commercial add-on — **not** required for Community use. Planned value:

- Central reusable Design Profiles, inheritance, versioning
- Assign profiles by tool/tag/collection
- Compile tokens, drift checks, agent receipts

Do not weaken or paywall Community capabilities to sell Profiles.

## Later Community enhancements

1. Signed macOS distribution / auto-update

## Security posture

User-authored commands only; no root; secrets masked in logs; folder pickers over blanket Full Disk Access; not App Store sandboxed (arbitrary child processes).
