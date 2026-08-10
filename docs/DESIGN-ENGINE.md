# Shelf v1.0 — Design Engine

**One line:** Shelf becomes the local source of truth for how your tools
should look and feel — so "build this using my branding" just works, in
any connected agent, with zero copy-paste.

Decided 2026-08-09. v0.9 ([PLAN-0.9.md](PLAN-0.9.md)) ships first and
reserves this feature's names; no Design Engine code lands before 1.0.

## Concept

A centralized Design/Branding section in Shelf where the user maintains
design profiles — brand colors, typography, spacing/radius, logo assets,
UI personality, light/dark direction. Anything connected through Shelf's
MCP server can discover that a profile exists, retrieve it, and apply it
when building the next tool, site, or interface.

This extends the existing pattern, not a new one: Shelf already serves
per-project design context bottom-up (`DESIGN.md` →
`shelf_get_design_md`, `shelf://tools/{id}/design-md`). The Design Engine
is the same idea top-down: durable, user-owned brand truth that outlives
any single project.

## Relationship to "Shelf Profiles" (commercial add-on)

PRODUCT.md lists Shelf Profiles as a future paid add-on with overlapping
language ("Central reusable Design Profiles"). Resolution, per the
standing rule *"do not weaken or paywall Community capabilities to sell
Profiles"*:

- **Community (free, v1.0): the Design Engine core.** Profiles, tokens,
  prose direction, assets, default + per-collection binding, the full
  agent read path, and the brand-brief output. This is the "build with my
  branding" experience and it must be free — it is the product's best
  demo and the vibe-coder audience's hook.
- **Profiles (paid, later): the agency tier on top.** Profile
  inheritance (base brand → client overrides), version history with
  rollback, drift checks ("this tool's CSS no longer matches its
  profile"), compiled outputs (Tailwind config, CSS variables, Style
  Dictionary pipelines), and application receipts ("agent X applied brand
  Y to tool Z"). Multi-client consultants pay; individuals never hit a
  wall.

## Architecture

Same shape as every Shelf subsystem: a local JSON store + a read-only MCP
surface + a GUI editor. No embeddings, no inference, no accounts, no
network — all PRODUCT.md non-goals hold.

### Store: `design-profiles.json` (Shelf data root)

Separate file (never mixed into library.json), `{ version: 1,
profiles: [] }`, atomic writes + file lock + corrupt-backup-reset, exactly
like `capability-gaps.json`.

```jsonc
{
  "id": "uuid",
  "name": "Suds Digital",
  "isDefault": false,
  // Layer 1 — machine tokens, aligned with the W3C Design Tokens (DTCG)
  // format: interop with Style Dictionary / Tailwind / Figma tokens for
  // free instead of a bespoke schema we migrate later.
  "tokens": {
    "color": { "brand": { "$value": "#4f6ef2", "$type": "color" }, "...": {} },
    "typography": {}, "dimension": {}
  },
  "modes": { "light": {}, "dark": {} },          // token overrides per mode
  // Layer 2 — prose the agent reads when "vibing": personality, voice,
  // do/don't rules. Markdown. LLMs consume this better than raw tokens.
  "direction": "markdown…",
  // Layer 3 — assets by absolute path (agents are local; Shelf copies
  // files into <dataRoot>/brand-assets/<profileId>/ like it does icons).
  "assets": [{ "kind": "logo", "path": "…", "mime": "image/svg+xml" }],
  "createdAt": "…", "updatedAt": "…"
}
```

Binding: `Collection.designProfileId?` — additive optional field, no
library v3→v4 migration required.

### MCP surface (read path)

- `shelf_list_design_profiles` → `{ id, name, isDefault, summary,
  boundCollections }` per profile.
- `shelf_get_design_profile { id?, collectionId?, toolId? }` — resolution
  precedence: explicit id → tool's collection binding → collection binding
  → default profile. Zero-argument call answers "build this using my
  branding".
  Returns **both** forms: `tokens` (DTCG JSON, for agents wiring
  CSS/Tailwind) and `brief` (rendered markdown: tokens summarized + prose
  direction + asset paths — paste-ready, same philosophy as error
  reports and v0.9 gap briefs).
- Resource `shelf://design/profiles/{id}` → the markdown brief (mirrors
  the DESIGN.md resource pattern).
- Discovery is the tool description itself: *"The user's brand/design
  source of truth. Call when asked to build 'with my branding' or match
  the user's style."* Every MCP client reads tool descriptions; no new
  protocol.

### Composition with per-project DESIGN.md

Tool-scoped requests merge global profile + that project's `DESIGN.md`;
the project doc wins on conflict (project specifics override brand
defaults). The v0.9 gap-brief generator gains a `## Brand` section via
its composable-sections contract.

## Phasing within 1.0

1. **Read path first**: store + MCP tools + resource + brief rendering.
   Seed a first profile by importing an existing brand-guide document —
   proves the agent experience before any editor exists.
2. **GUI editor**: Design section in the shell — token editing with
   swatches/preview, direction markdown editor, asset upload, default
   toggle.
3. **Bindings + import**: collection binding UI, "extract tokens from
   this project" assist (deterministic parsing of CSS variables /
   tailwind config — no inference).

Ship 1 before 2 is finished if needed — the agent story is the release.

## Non-goals

Hosted anything; accounts; inference-based token extraction; enforcing
brand compliance (drift checks are the paid tier); Shelf itself applying
styles to projects (agents apply, Shelf serves truth); per-tool profile
binding in v1 (collections + default cover the real cases; add per-tool
only on demonstrated demand).

## Approval gate

- A fresh agent session with no prior context, asked to "build X using my
  branding", discovers the profile, retrieves it, and produces output
  using the correct colors/type/voice — zero manual design context from
  the user.
- Two profiles bound to two collections resolve correctly by collection
  context; the default resolves when nothing is bound.
- Deleting a profile never touches library.json or any project files.
- Existing `DESIGN.md` behavior is unchanged for tools whose projects
  have one; merged output demonstrably prefers project specifics.
