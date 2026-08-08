---
name: shelf-register
description: >-
  Register a local project in Shelf (personal local-tools launcher) via the
  Shelf MCP server after building or discovering a tool. Use when the user asks
  to add, register, or save a project into Shelf, or to wire a finished local
  app into their tool library.
---

# Register a project in Shelf

Shelf is a macOS personal command center for local tools. After a project is
built, register it so the user can launch it later without remembering commands.

## Prerequisites

- Shelf MCP server configured in the client (Shelf → **MCP Connections** → Connect Claude / Cursor / Codex)
- Prefer absolute project paths

## Fast path (preferred)

Call `shelf_register_project` with the absolute `projectPath` — it inspects,
saves (idempotently: re-registering the same folder updates instead of
duplicating), and launches in one call with `onPortConflict: "reassign"` by
default. Read the `outcome`:

- `launched` — done; report the tool id and URL.
- `needs_setup` — dependencies missing (e.g. no `node_modules`). Ask the user,
  then call again with `runSetup: true`; setup never runs without that flag.
- `saved_needs_review` — detection was not confident. Fall back to the manual
  workflow below to confirm the launch command, then `shelf_upsert_tool`.
- `saved_launch_failed` — inspect `state.code` (e.g. `deps_missing`,
  `port_timeout`, `bad_launch_command`) and `shelf_get_logs`, then fix.
- Use `dryRun: true` to preview the gate without saving anything.

After a successful register, still add `capabilities` and verify `agentAccess`
via `shelf_upsert_tool` when the tool offers agent interfaces — the fast path
does not auto-generate capability phrases.

## Manual workflow (fine-grained control)

1. Call `shelf_inspect_project` with the absolute `projectPath` for suggested name, launchCommand, port/url, tags, and DESIGN.md signals. Review `signals` / `confidence` before trusting the draft.
2. **Check for a project-local DESIGN.md** (Community bridge for agents):
   - Prefer the inspect result (`designMd`), or call `shelf_get_design_md` with the tool `id` or `projectPath`.
   - When `found: true`, read it and follow its tokens/guidance for UI work in that project.
   - Resource URI: `shelf://tools/{id}/design-md`
   - Missing DESIGN.md is normal — do not treat as an error.
3. **Confirm the port** (web apps):
   - Inspect already prefers a free port when the framework default is busy; still call `shelf_find_free_port` if you need more candidates.
   - Keep `port` and `url` in sync (`http://127.0.0.1:<port>/`).
4. Draft a Shelf tool config (start from inspect suggestions):
   - **name**: short product name
   - **description**: one or two sentences
   - **projectPath**: absolute folder path
   - **launchCommand**:
     - Python with venv → `.venv/bin/python app.py` (not bare `python3` when Flask/deps live in `.venv`)
     - Node / Next → `npm run dev -- --port <port>` (or `pnpm` / `yarn` / `bun` equivalent)
     - Vite → `npm run dev -- --port <port>`
     - Docker → `docker compose up`
   - **port** / **url** when it is a local web app (must match the launch flags)
   - **tags**: small set (e.g. `Image Tools`, `Client Projects`)
   - **capabilities**: short task phrases an agent can match (e.g. `batch optimize images`, `convert images to WebP`)
   - **agentAccess**: declare only real CLI, MCP, or HTTP API interfaces the tool itself exposes; mark `setupRequired` honestly. Never include credentials. `shelf_inspect_project` suggests detected interfaces in its `agentAccess` response field — verify before saving. Omitting it is fine for GUI-only tools and limits NOTHING: `shelf_launch_tool` / `shelf_stop_tool` work for every registered tool. A `manual_only` readiness means "no child interface declared", never "cannot launch".
   - **notes**: inputs, common errors, last known working setup
5. Show the draft to the user and get confirmation before writing.
6. Call MCP `shelf_upsert_tool` with the confirmed fields.
   - Read `warnings` / `suggestedPort` in the response. If present, re-upsert on the suggested port (or pass `autoFixPort: true`) — do not treat a busy-port upsert as fully healthy.
7. Optionally call `shelf_launch_tool` — it works regardless of readiness state or `agentAccess`. Prefer `shelf_stop_tool` when finished so the GUI is not left with an orphaned listener. If you need a second instance while the port is busy, use `onPortConflict: "reassign"` (Shelf picks a free port, rewrites launch/url, and persists). Default launch adopts an already-listening port instead of erroring.
8. Verify with `shelf_get_logs` / `shelf_get_status`.
9. Tell the user the tool id and how to find it in the Shelf GUI library.

## Hard rules

- Do **not** invent API keys or paste secrets into Shelf env when `.env.local` already exists.
- Do **not** use `sudo` or interactive prompts in launch commands.
- Do **not** delete unrelated Shelf tools.
- Prefer updating an existing tool by the same name over creating duplicates.
- Mask/never echo secret values from MCP responses beyond what the server already sanitizes.
- Shelf never connects to or invokes a tool's declared MCP/CLI/HTTP endpoint; it records the endpoint so agents can connect themselves.
- Do **not** register two tools on the same port. Prefer `shelf_find_free_port` and heed upsert warnings.
- Prefer pinned ports in `launchCommand` (`--port` / `-p`) over relying on framework auto-increment (Next/Vite hopping to 3001+ desyncs Shelf readiness).

## MCP tools

- `shelf_list_tools`
- `shelf_get_tool`
- `shelf_find_capability`
- `shelf_check_tool_readiness`
- `shelf_record_capability_gap` / `shelf_list_capability_gaps`
- `shelf_find_free_port`
- `shelf_inspect_project`
- `shelf_upsert_tool` (`checkPort` default true; optional `autoFixPort`)
- `shelf_remove_tool`
- `shelf_launch_tool` (`onPortConflict`: `fail` | `reassign`)
- `shelf_stop_tool`
- `shelf_get_status`
- `shelf_get_logs`
- `shelf_list_receipts` / `shelf_clear_receipts`
- `shelf_list_collections`
- `shelf_get_design_md`
