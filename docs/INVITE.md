# Shelf Community 0.4.0 — Invite kit

Private invite notes for early testers. Product stays free **Community** (no account, no paywall). Profiles remain a later add-on.

## What you’re getting

Shelf 0.4.0 is a local macOS command center for tools you build, plus **Capability Intelligence**:

- Task-oriented **capabilities** on each tool
- Declared **agent access** (CLI / MCP / HTTP API) and honest **readiness**
- Agent discovery via `shelf_find_capability` (explainable matches; no child-MCP proxy)
- **Capability Gaps** inbox when nothing fits

## Install (preferred path)

1. Receive the `.app` / zip from the host (or build with `npm run install:desktop` in this repo).
2. Put **Shelf.app** in `/Applications` (not only Desktop).
3. First launch (unsigned local build): Finder → **right-click Shelf → Open** → Open again if Gatekeeper warns.
4. Prefer opening from `/Applications` afterward so MCP Connect writes the durable path.

If both Desktop and Applications copies exist, open Applications and use **MCP Connections → Connect** so Claude/Cursor/Codex configs prefer `/Applications/Shelf.app/...`.

## Connect agents

1. Open Shelf → **System → MCP Connections**.
2. Connect **Claude Desktop**, **Cursor**, and/or **Codex** (one-click).
3. Reload the client:
   - Claude: quit and reopen
   - Cursor: reload MCP / restart agent session
   - Codex: new CLI session or restart
4. Smoke prompt: `List my Shelf tools.`

After upgrading to 0.4.0, **reload MCP** so clients pick up `shelf_find_capability` and friends (stale sessions may only show lifecycle tools).

## First-run walkthrough (5 minutes)

1. **Library** — confirm tools appear; search/filter works.
2. Open a tool → **Capability intelligence** panel (capabilities, access, readiness badge).
3. **Edit** → Advanced → capabilities / agent access (optional tweak).
4. **System → Capability gaps** — empty or seeded gaps inbox.
5. **MCP Connections** — Connected status for at least one client.

## Example agent prompts

Discovery:

```text
What Shelf tool can prepare Google Maps business photos?
```

```text
Find a Shelf capability for generating Codex MCP config for WordPress BCB.
```

```text
Which Shelf tools can help with Mermaid diagrams, and are they agent-ready or manual-only?
```

Gap recording (when nothing matches):

```text
If nothing in Shelf can fill PDF forms, record that capability gap and explain why.
```

Readiness check:

```text
Check readiness for Section Builder and tell me what setup is still required.
```

## Honesty boundaries (say this to invitees)

- Shelf **launches and monitors** local tools; it does **not** invoke child MCP servers in 0.4.0.
- **Ready** means access metadata is declared and not marked setup-required — not that APIs keys are present or a remote server is healthy.
- **Manual only** means Shelf can launch the GUI, but no CLI/MCP/HTTP interface is declared.
- Unsigned builds need Gatekeeper “Open”; signed/notarized + auto-update come later.

## Soft-launch checklist (host)

| Item | Status |
|---|---|
| Tag `v0.4.0` on `main` | Done (`c6dad98`) |
| CI green on `main` (`typecheck` + `smoke:all`) | Confirm before each invite wave |
| Packaged app 0.4.0 in `/Applications` | Prefer over Desktop |
| Waitlist site shelfmcp.com | Live; invites optional/manual |
| GitHub Release notes for `v0.4.0` | Optional private draft (see below) |
| Signed/notarized + Sparkle/auto-update | Later |
| Paywall Community / Profiles upsell | Do not |

### Suggested private GitHub Release notes (`v0.4.0`)

```markdown
## Shelf Community 0.4.0 — Capability Intelligence

Local-first catalog for the tools you build: capabilities, declared agent access, explainable discovery, and a Capability Gaps inbox.

### Highlights
- Task-oriented capabilities + CLI/MCP/HTTP API access metadata
- `shelf_find_capability` / readiness checks (discovery only — no child-MCP proxy)
- Capability Gaps inbox (`capability-gaps.json`)
- Library schema v3 (automatic migration; v2 backup on upgrade)

### Install
1. Open Shelf.app (prefer `/Applications`)
2. Gatekeeper: right-click → Open on first launch
3. Shelf → MCP Connections → Connect Claude / Cursor / Codex
4. Ask: “What Shelf tool can …?” or “Record a gap if nothing can …”

### Notes
- Community remains free and local; Profiles stay deferred
- Signed/notarized builds and auto-update are not in this release
```

## Announce waitlist invites?

**Recommendation:** send a **small private wave** (people who already build local tools + use Claude/Cursor), not a public blast.

- Landing waitlist can stay open for demand signal.
- Invite email: install steps above + 3 example prompts + honesty boundaries.
- Hold a broader announce until 1–2 invitees complete Connect + `shelf_find_capability` without hand-holding.

## Data locations (macOS)

- Library: `~/Library/Application Support/Shelf/library.json`
- Gaps: `~/Library/Application Support/Shelf/capability-gaps.json`
- Receipts / prefs: same Application Support folder
