# Shelf v1.2 — Tool Sharing

**One line:** if a tool works on your Shelf, a coworker gets it working on
theirs in two clicks — Shelf handles the annoying parts, and no part of it
runs on a server Shelf operates.

Drafted 2026-08-16 from the Teams evaluation. The Teams *framing*
(accounts, rosters, invitations) was deliberately rejected: it needs
Shelf-operated identity and hosting, which breaks the "No cloud. No
account." promise the product stands on (see LANDING.md must-not claims).
What ships instead is the job itself: **portable tools + catalogs**, with
the user's existing git host as the transport.

## Concept

Shelf's value in sharing is not moving code — teams already have
GitHub/Drive and they're better at it than Shelf will ever be. The value
is everything *around* the code that makes "works on my machine" true:
launch command, port, tags, capabilities, declared agent access, setup
steps, and which env vars are needed. Shelf already holds all of that per
tool; sharing = making that metadata travel with the project as a
manifest, and pointing the existing receive pipeline at it.

The receive side already exists: `shelf_register_project` / drag-drop is
a one-shot inspect → save → **consented** bootstrap → launch pipeline
with port healing, readiness probing, and failure classification (0.7).
"Add to My Shelf" is that pipeline seeded from a manifest instead of
heuristics. New work is only: the manifest, a link format, and update
provenance.

## Architecture

No new subsystem shape. A manifest file in the *project* (travels with
code), a small amount of state on the *tool record* (provenance), one new
`shelf://` action, and GUI/MCP surfaces over the existing pipeline.

### Manifest: `shelf.json` (in the shared project's root)

Written by "Share this tool", committed to the project's repo like any
other file. Versioned independently of library.json.

```jsonc
{
  "shelfManifest": 1,
  "name": "Image Prepper",
  "description": "Batch image resize/optimize for client sites",
  "launchCommand": "npm run dev",          // relative to project root
  "port": 4173,                            // preferred; receiver may heal
  "url": "http://localhost:4173/",         // template; port-rewritten on receive
  "tags": ["image", "utility"],
  "capabilities": ["batch-optimize images"],
  "agentAccess": [ /* declarative, same schema as Tool.agentAccess */ ],
  // Setup the RECEIVER must consent to before anything runs. Shown
  // verbatim on the consent sheet; never executed silently.
  "bootstrap": ["npm install"],
  // Env SCHEMA only — keys + human hints. Values are stripped at export
  // by the same layer that masks secrets everywhere else; there is no
  // code path that can put a value here.
  "env": { "OPENAI_API_KEY": "Your OpenAI key (platform.openai.com)" },
  // Freeform caveats surfaced on the consent sheet (e.g. macOS
  // permissions Shelf cannot package: "needs mic access on first run").
  "notes": "…",
  "exportedBy": "Shelf 1.2.0",
  "exportedAt": "2026-08-16T…"
}
```

Rules:

- **A manifest is untrusted input.** Everything in it is data to display
  and confirm, never to execute on parse. `bootstrap` and
  `launchCommand` render verbatim on the consent sheet; env keys are
  prompts, not values; name/description are sanitized for display.
- Export strips env values structurally (`sanitizeToolForOutput`
  precedent) and refuses export if `containsLikelySecret` trips on any
  free-text field — same policy as agent-access metadata and design
  profiles.
- Unknown fields are preserved on read (normalize-on-read like every
  store), so newer manifests degrade gracefully in older Shelfs.

### Tool provenance (additive `Tool` fields, no library bump)

```ts
/** Where an added tool came from; absent = locally created. */
source?: {
  kind: 'git' | 'bundle'
  repo?: string        // clone URL as pasted (git)
  ref?: string         // commit sha recorded at add/update time
  addedAt: string
  updatedAt?: string   // last "Get updates" pull
}
```

Independent-by-default, linked-by-provenance: local edits are fine;
"Check for updates" is explicit (never automatic — "no auto-anything",
and silently updating a teammate's executable code is a supply-chain
hazard). Update = fetch → show summary (commits + manifest diff) →
user-confirmed pull. If the local copy diverged: say so honestly — keep
yours or take theirs, no merge UI in v1.

### Send: "Share this tool" (tool detail page)

1. Writes/updates `shelf.json` in the project root (values stripped).
2. If the project has a git remote: copies `shelf://add?repo=<url>` to
   the clipboard — paste it in Slack, done.
3. Always offers **Export bundle** (zip of the project with the manifest
   inside, node_modules excluded) for the no-git / Drive workflow.

### Receive: `shelf://add?repo=…` / "Add from URL" / "Add from bundle"

New `shelf-url.ts` action `add` (the parser is already extensible), plus
a Library-page entry point for pasting a URL or picking a bundle.

Flow on click:

1. Clone (system git; if the Xcode CLT is missing, detect and guide —
   runtime-missing remedy precedent) into `~/Shelf Tools/<name>` (or
   user-chosen folder), or unzip the bundle.
2. Parse + normalize the manifest. **One consent sheet** shows: source
   URL, destination folder, the exact bootstrap commands, manifest notes,
   and inputs for each env key. Nothing runs before approval — the same
   gate the 0.7 register flow uses, with the same wording discipline.
3. `registerProject(path, { overrides: manifest, consent })` — existing
   pipeline: save → bootstrap → launch → readiness. Port busy? The
   existing conflict policy heals it and rewrites the url template.
4. Record `source` provenance; receipt provenance (`startedBy`) is
   unchanged.

A `shelf://` link arriving over chat is a classic lure shape, so the
consent sheet is load-bearing security surface: full URL shown, commands
shown, no "trust this sender" shortcuts, and the sheet cannot be
pre-confirmed by URL parameters.

### MCP surface

- `shelf_export_tool { id }` → writes the manifest, returns its path +
  the `shelf://add` link (so an agent can "share this with my team" on
  request). Values-stripping enforced server-side.
- `shelf_add_shared_tool { repo | bundlePath, dryRun? }` — **explicitly
  deferred past v1.2.** An agent installing a coworker's code
  unattended skips the consent sheet by construction; revisit only with
  a design that preserves human consent (e.g. tool stages the add, GUI
  confirms). The GUI is the only receive surface in v1.2.

### Stage 2 (fast follow, still serverless): Team Tools catalog

A "team" is a git repo containing `catalog.json` — entries of
`{ name, description, capabilities, repo }`. Everyone points Shelf at the
catalog URL once (Settings); Shelf renders a **Team Tools** pane where
every entry is an Install button running the receive flow. "Share with
team" appends your entry (writes the file; pushing stays the user's
action, or `gh` when present). Access control *is* git access — the org
already knows who's on the team. Homebrew-tap pattern; zero Shelf
infrastructure; the site's "no cloud sync / no team accounts" claims stay
true.

## Relationship to the commercial tier

Community (free): everything above — manifest, share link, receive flow,
updates, catalogs. Per the standing rule, none of it gets paywalled
later. A hosted registry / org dashboards / signed packages could become
a paid **Teams** service next to Profiles someday; do not build any of it
until Stages 1–2 prove people share tools at all.

## Phasing

1. **v1.2 — Portable tools**: manifest export ("Share this tool" +
   `shelf_export_tool`), `shelf://add` + Add-from-URL/bundle with the
   consent sheet, provenance + "Check for updates", smokes (manifest
   round-trip, secret-stripping, hostile-manifest normalization, deep
   link, update/diverged paths) + the pre-release adversarial pass.
2. **v1.3 — Team Tools catalog**: catalog repo support, Team Tools pane,
   "Share with team".
3. **Later / maybe never**: version pinning, divergence merging, signed
   manifests, hosted anything.

**Pre-build validation gate:** before implementing v1.2, hand-write
`shelf.json` for one real tool and have one coworker run a rough
Add-from-URL. If the consent-sheet moment isn't obviously better than
the README it replaced, stop at the experiment.

## Non-goals

Shelf-operated accounts, rosters, or hosting (breaks the core promise);
auto-updating shared tools; executing anything from a manifest without
the consent sheet; secrets in transit ever; merge tooling for diverged
copies; Windows/Linux senders; agent-driven receive (deferred, see MCP
surface); replacing the team's code host.

## Approval gate

- Sender: Share on a working tool → link in clipboard in one click;
  `shelf.json` contains no env values even when the tool has secrets.
- Receiver: click the link in Slack → one consent sheet (folder,
  commands, env inputs) → tool running and visible in the Library with
  correct capabilities/agent access; total interaction ≤ two clicks plus
  env values.
- A hand-tampered manifest (injected command in `name`, value smuggled
  into `env`, path traversal in any field) renders inert on the consent
  sheet and cannot execute or persist anything without approval.
- "Check for updates" on a diverged copy refuses politely and clearly;
  on a clean copy shows what changed before touching anything.
