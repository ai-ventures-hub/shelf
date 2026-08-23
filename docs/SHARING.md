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
3. `registerProject(path, { overrides, setupSteps, runSetup, source })` —
   existing pipeline: save → bootstrap → launch → readiness. Port busy? The
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

## Implementation notes (v1.2, built 2026-08-23)

Decisions made while building that the concept above left open:

- **Repo URL allow-list.** `shelf://add?repo=` and Add-from-URL accept
  `https://`, `ssh://`, `git://`, and scp-like `git@host:path` only — no
  `file://`, no `ext::`, no local paths, nothing starting with `-`. The
  URL is always passed after `--`, git runs with
  `GIT_TERMINAL_PROMPT=0`, `protocol.ext/file.allow=never`, and
  `core.hooksPath=/dev/null`, and clone/fetch have hard timeouts.
- **Manifest `url` must be loopback.** `onReadyUrl` opens the tool URL in
  the browser after launch, so a non-localhost URL in a manifest would be
  a phishing primitive. It is dropped with a visible warning on the sheet.
- **Folder name.** The destination is `<tools root>/<folderNameFor(name)>`
  — letters/digits/space/`._-` only, `..` collapsed, no leading dots —
  suffixed `-2`, `-3` when taken. "Change…" picks a *parent*; the
  sanitized name is always appended. The user-chosen destination must be
  new or empty and never inside Shelf's scratch area.
- **Staging.** Fetch goes to `<data root>/staging/<id>`; the sheet reads
  from there; approve moves it to the destination; cancel deletes it;
  app start sweeps leftovers. `stagePath` never leaves the main process.
- **What runs is what was shown.** The sheet lists the manifest's
  `bootstrap` commands plus any detected need the manifest omitted
  (deduped); that exact list is passed to `registerProject` as
  `setupSteps`, replacing detection. Env inputs always start empty — a
  hint is never a value, and a hint that looks like a credential (or, on
  a secret-named key, a single bare token) is discarded with a warning.
- **Bundles** are written and read by Shelf's own zip code
  (`shared/zip.ts`): export excludes `node_modules`, `.git`, `.venv`, and
  every `.env*` except `.env.example`; extraction refuses absolute paths,
  `..`, backslashes, symlink entries, encrypted entries, zip64, and
  anything resolving outside the destination. Bundle-sourced tools have
  no remote, so "Check for updates" is not offered for them.
- **Updates apply metadata conservatively.** After a confirmed pull, a
  manifest field is applied to the tool only if the tool's current value
  still equals what the *old* manifest said (local edits win). Port/url
  follow the same rule, so a healed port is kept. New env keys are
  reported, never filled; new `bootstrap` commands run only if the
  checkbox on the update sheet was ticked. A diverged copy (local
  commits or uncommitted tracked changes) refuses fast-forward; "Take
  theirs" is `git reset --hard` after an explicit confirm.
- **Provenance over IPC.** `Tool.source` is carried by both `normalizeTool`
  and the save literal (no library bump); `shelf_upsert_tool` preserves
  it on agent updates.
- **Explicit Fetch for links.** Opening a `shelf://add` link only opens the
  sheet with the URL filled in; nothing — not even the clone — happens
  until the receiver clicks **Fetch** (three clicks total: link, Fetch,
  Add). Decided 2026-08-23 after the adversarial pass flagged
  clone-on-click as the flow's weakest point: a lure link must not cause
  an outbound fetch by itself. Add-from-bundle fetches straight away — the
  file picker was already the user's explicit choice. Staged trees are
  capped at 2 GB and refused if they contain a symlink pointing outside
  the folder.
- **Pre-commit adversarial pass (2026-08-23)** found, and the build fixed:
  bundles could plant a `.git/` (fsmonitor/hooks) — `.git` entries are now
  refused on extract; manifest `port`/`url` could disagree (url opened on a
  different loopback port) — they are reconciled on read; a tool in a repo
  subfolder produced a link to the wrong folder — no link, explained; a
  stale library entry at the destination silently swallowed the typed env —
  refused; "diverged" was reported for local edits with nothing incoming —
  now up to date; updates skipped silently after a healed port — re-pinned
  and `skipped` reported; invalid `shelf.json` was overwritten — refused;
  credential files beyond `.env*` rode along in bundles — excluded.
- **Private repos.** The clone runs with prompts disabled (no hang), so a
  private repo needs the receiver's own git credentials. Shelf makes this
  work without holding any secret: for an `https://` GitHub host, if the
  GitHub CLI (`gh`) is installed it adds a per-clone
  `credential.https://<host>.helper=!gh auth git-credential` — scoped to
  that one command, keychain still tried first, and the token never
  reaches Shelf (git talks to gh over the helper's own pipe). The helper
  is registered for any https host on purpose (it also covers self-hosted
  GitHub Enterprise), but `gh` returns a credential ONLY for a host you're
  signed in to; every other host — and every public repo — falls through
  to git's normal path unchanged. Same helper on the
  `fetch` behind "Check for updates". When it still fails,
  `classifyCloneFailure` maps git's stderr to `auth_required` /
  `repo_not_found` and the sheet shows a real remedy (a copy-able
  `gh auth login && gh auth setup-git`, the derived `git@host:org/repo`
  SSH address, or Add-from-bundle) instead of raw plumbing text — the
  `git_missing` structured-remedy precedent, now with a `remedyCommand`.
- **git missing.** Detection uses `xcode-select -p` first (calling the
  `/usr/bin/git` shim would pop the CLT installer), then Homebrew paths;
  the result is a coded `git_missing` with the "run `xcode-select
  --install`" remedy and a copy button — the runtime-missing precedent.

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
- Receiver: click the link in Slack → Fetch → one consent sheet (folder,
  commands, env inputs) → tool running and visible in the Library with
  correct capabilities/agent access; total interaction ≤ three clicks
  plus env values (was two; the extra click is the explicit Fetch, see
  implementation notes).
- A hand-tampered manifest (injected command in `name`, value smuggled
  into `env`, path traversal in any field) renders inert on the consent
  sheet and cannot execute or persist anything without approval.
- "Check for updates" on a diverged copy refuses politely and clearly;
  on a clean copy shows what changed before touching anything.
