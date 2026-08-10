# Shelf v0.9 — Gap → Build Loop (Feature C)

**One line:** turn a recorded capability gap into a built, registered tool —
with the agent doing the building and Shelf staying the honest bookkeeper.

Decided 2026-08-09 alongside [DESIGN-ENGINE.md](DESIGN-ENGINE.md) (the v1.0
headline). v0.9 stays deliberately small: it closes the Capability
Intelligence loop that PRODUCT.md already describes, using machinery that
shipped in 0.4–0.8.

## Why now

The Capability Gaps inbox (record → dedupe → Plan/Resolve/Dismiss → "Create
tool" prefill) already exists. What's missing is the loop's last mile:
nothing turns a gap into an agent work order, and nothing notices when the
work lands. Both halves are additive UX/glue — no schema migrations, no new
subsystems.

## Scope

### 1. Agent brief generator ("Copy brief for your AI tool")

A paste-ready, deterministic markdown brief from any open/planned gap,
mirroring `buildErrorReport` (shared/launch-diagnostics.ts):

- Sections: task & reason, requested capabilities, occurrence history,
  related existing tools (with their capabilities, so the agent extends
  rather than duplicates), and register-back instructions
  (`shelf_register_project` / `shelf_upsert_tool` with the gap's
  capabilities pre-listed).
- **Build the generator as named, composable sections** — not one template
  string. v1.0 injects a `## Brand` section here (see DESIGN-ENGINE.md);
  that must be an insert, not a rewrite.
- Surfaces: button on each gap card in the inbox; MCP mirror
  `shelf_get_gap_brief { id }` returning the same markdown.

### 2. Resolve suggestions (suggest-only — never auto-resolve)

When a tool is saved (GUI or MCP) whose capabilities overlap an open or
planned gap's fingerprint, surface a suggestion:

- Matching: deterministic, explainable set-overlap on normalized
  capabilities (same normalization as the gap fingerprint in
  `shared/capability-gap-store.ts`). Report which capabilities matched.
- GUI: suggestion chip on the gap row — "New tool ‘X’ covers 2 of 3
  requested capabilities → Resolve?" One click resolves, one dismisses the
  suggestion (the gap itself stays open).
- A wrong auto-resolve silently deletes a recorded need — the exact thing
  the inbox exists to preserve. Humans confirm resolution. This is policy,
  not a v1 shortcut.

### 3. `shelf_update_capability_gap` (MCP)

Agents may set status `planned` and attach `relatedToolIds` (validated
against the library, as `shelf_record_capability_gap` already does).
Agents may **not** set `resolved` or `dismissed` — those stay GUI-only.
Reopening on re-request stays automatic (existing store behavior).

## Groundwork reserved for v1.0 (names only — no code in 0.9)

So 0.9 work doesn't squat on v1.0's surface:

- Data file: `design-profiles.json` (Shelf data root)
- MCP: `shelf_list_design_profiles`, `shelf_get_design_profile`
- Resource: `shelf://design/profiles/{id}`
- Optional field: `Collection.designProfileId`

## Non-goals for 0.9

Auto-resolution of gaps; embeddings or fuzzy matching; agent-invoked
scaffolding (Shelf never generates or installs software — the brief is
paste-ready context, the agent's own session does the work); any Design
Engine implementation.

## Touched surfaces

`shared/capability-gap-store.ts` (match helper), new
`shared/gap-brief.ts`, `mcp/capability-tools.ts` (two tools),
`electron/main.ts` + preload + `src/types.ts` (IPC mirror),
`src/pages/CapabilityGapsPage.tsx` (brief button, suggestion chips),
smokes: extend `smoke-capabilities.mjs` + `smoke-mcp.mjs`.

## Approval gate

- From a real recorded gap, one click yields a brief that an agent session
  can follow to build + register a tool with zero extra context from the
  user.
- Registering that tool surfaces a resolve suggestion on the original gap
  that names the overlapping capabilities; confirming resolves it; the
  suggestion never fires as an automatic resolution.
- An agent can mark a gap planned over MCP; it cannot resolve or dismiss.
- `smoke:all` covers brief generation and suggestion matching
  deterministically.
