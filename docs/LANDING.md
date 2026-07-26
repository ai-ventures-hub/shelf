# Shelf landing page plan (post–Capability Intelligence)

Living plan for **https://shelfmcp.com**. Product name remains **Shelf**; domain `shelfmcp.com` is the category/launch URL.

## Shipped — Phase 1 (product story)

Live on shelfmcp.com:

- Dual-surface hero (Agent transcript + Shelf library simulation)
- Waitlist primary CTA (invite-only soft launch)
- Narrative: graveyard → import → launch → shared library/MCP → connect → examples → local-first → community
- DESIGN.md tokens; no live filesystem/MCP from the browser

## Positioning update (0.4.0)

Shelf is no longer only “launch and monitor local tools.” Community **0.4.0** adds **Capability Intelligence**:

- Tools declare **task-oriented capabilities** and **agent access** (CLI / MCP / HTTP API)
- Agents discover matches via `shelf_find_capability` with explainable scores and readiness
- Unmet needs become a local **Capability Gaps** inbox (`capability-gaps.json`)
- Shelf does **not** proxy or invoke child MCP servers in 0.4.0 — discovery and honesty only

Landing copy must make this legible without overselling a gateway.

## Phase 2 — Interactive demo (next)

Keep Direction A (Library Comes Alive). Extend the prepared state machine:

1. **Capability beat** — Agent asks “What can batch-optimize images?” → Shelf highlights a tool with matching capabilities + readiness pill (`ready` / `needs_setup` / `manual_only`)
2. **Gap beat** — Agent asks for a missing capability → Gaps inbox gains a row (deduped, occurrence count)
3. Prompt chips (from original vision) plus:
   - “What Shelf tool can optimize images?”
   - “Record a gap if nothing can fill PDF forms.”
   - “Which tools are ready for agents?”
4. Import / launch / MCP connect sequences remain; readiness must stay distinct from process status (Running ≠ agent-ready)

## Phase 3 — Guided audio

Unchanged from vision: optional pre-generated tour + captions; curated Q&A. Add one Q:

- “How do agents find the right tool?” → capabilities + readiness explanation

## Phase 4 — Validated AI assistance

Only after engagement data. Ground answers in PRODUCT.md + README; never invent child-MCP invocation.

## Soft-launch CTA (still locked)

| Priority | Action |
|---|---|
| Primary | Request access (waitlist) |
| Secondary | See how it works (`#demo`) |
| Tertiary | View on GitHub |

Swap primary to Download when signed/invite builds are public.

## Must-not claims on the site

- No “Shelf runs every MCP server for you”
- No cloud sync / team accounts / embeddings
- No Profiles paywall of Community capabilities
- Profiles may remain a quiet future note only

## Implementation notes

- Demo stays a controlled web simulation (`site/src/lib/demo-states.ts` + client state machine)
- Mirror readiness vocabulary from `shared/capability-intelligence.ts`
- Redeploy Vercel project **shelf-site** (team `carlos-projects-882b0b3c`) after Phase 2
