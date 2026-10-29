# Shelf v2.4 — Companion (remote control + preview from a phone)

**One line:** see, start, stop, and preview the tools running on your Mac
from your phone, anywhere, with the Mac staying the only source of truth
and nothing Shelf-operated in between.

Drafted 2026-10-28 from a feasibility conversation. Nothing here is
built. Carlos approved the port-for-port preview, Tailscale as the
recommended transport, web-first for the phone shell, and the 2.4 number
on 2026-10-28. Decisions are recorded at the end of this doc.

## Why

Shelf is already the place where a tool's state lives: the library
(`library.json`), run logs, leases, verification, collections. The gap is
that all of it is reachable only from the Mac's own screen. When Carlos
works away from the desk he cannot tell whether a tool is still up,
restart one that crashed, or look at the thing an agent just built. The
agent side of remote work is covered (Claude Code and Codex already run
remotely); the *looking at it* side is not.

The point of the Companion is narrow: **status, launch, stop, logs, and
preview**. It is not a second Shelf.

## Non-negotiables (from PRODUCT.md)

- **No cloud. No account.** Shelf operates no relay, no broker, no login.
  Transport off the local network is the user's own private network.
  **Tailscale is the recommended and documented path** (decided
  2026-10-28): Shelf detects its interface, preselects it, and the docs
  and Settings copy name it. Any other VPN or the LAN works the same way
  through the interface picker. Shelf never sees a phone that the Mac's
  network cannot already reach.
- **Nothing leaves the Mac** except to the user's own paired device over
  the user's own network. The one existing network call (onboarding
  survey) stays the only Shelf-to-Internet call.
- **Tools are untrusted local processes.** Today they are safe because
  they bind to `127.0.0.1`. Anything that widens that reach is opt-in per
  tool, visible, and revocable. A phone must never be able to reach a
  tool the user did not explicitly expose.
- **Agents draft, the user decides.** Nothing in the Companion gives
  agents a new write path. The Companion is a user surface only.

## Architecture

Same shape as every Shelf subsystem: one new store, one new server in the
Electron main process, a GUI pane in Settings, and smoke tests. No new
processes, no new daemons, no new dependencies that the `shared/`
boundary cannot already carry.

```
   iPhone (Safari, Home Screen web app)
        │  https over tailnet / LAN
        ▼
   Companion server  (electron/companion-server.ts, in the main process)
        ├── /api/*        JSON over HTTP + one WebSocket for live state
        │                 → the same functions the IPC handlers call today
        │                   (ProcessManager, LibraryStore, RunLogStore,
        │                    collection-launch, buildMorningBoard)
        └── /preview/*    per-tool reverse proxy → 127.0.0.1:<tool.port>
                          only for tools with remotePreview: true
```

### 1. Companion server (`electron/companion-server.ts`)

A Node `http` server plus `ws`-style WebSocket upgrade, owned by the main
process and started only when the **Companion** preference is on.

- **Bind address is never `0.0.0.0`.** Options, in order of preference:
  the Tailscale interface address (detected from the network interface
  list: `100.64.0.0/10`, or any interface whose name matches `utun*` with
  a CGNAT address), else the LAN address the user picks from a list in
  Settings. Loopback is excluded; it is pointless for a phone and would
  tempt scripts.
- **Port:** one fixed default (proposal: `48620`, outside every range
  `shared/ports.ts` hands to tools), overridable in Settings, checked
  against the same conflict policy tools use.
- **TLS:** self-signed certificate generated once per Mac into
  `<dataRoot>/companion/` and pinned by the phone at pairing (its
  fingerprint rides in the QR payload). Plain HTTP is refused. This is
  what makes web push and Home Screen install possible on iOS, and it is
  what makes a stolen LAN sniff useless.
- **Auth:** every request carries a bearer token from the pairing store
  (below). Unauthenticated requests get `401` with no body that
  distinguishes "wrong token" from "no token." Rate-limit failures per
  source address.
- **No new business logic.** Every `/api` route is a thin adapter over
  the function an IPC handler in `electron/main.ts` already calls. The
  PRODUCT.md "Later" item to split IPC handlers by domain with one typed
  channel map is the natural prerequisite: do that split first, so the
  Companion server and the preload both consume the same map and the two
  surfaces cannot drift.

### 2. Pairing store (`<dataRoot>/companion/devices.json`)

```jsonc
{
  "version": 1,
  "devices": [
    {
      "id": "uuid",
      "name": "Carlos's iPhone",       // from the phone's UA at pairing, editable
      "tokenHash": "sha256:…",         // never the token itself
      "pairedAt": "…",
      "lastSeenAt": "…",
      "lastSeenFrom": "100.101.4.7"
    }
  ]
}
```

Atomic writes, file lock, corrupt-backup-reset, exactly like
`capability-gaps.json` and `prefs.json`.

**Pairing flow** (GUI, Settings → Companion):

1. User clicks **Pair a device**. Shelf mints a one-time pairing code
   (expires in 2 minutes, single use) and shows a QR code containing
   `https://<bind-address>:<port>/pair#<code>.<cert-fingerprint>`.
2. Phone scans, Safari opens the page, the page posts the code, receives
   a long-lived device token, stores it in `localStorage`, and prompts
   **Add to Home Screen**.
3. The Mac shows the new device in the list immediately; **Revoke** on
   any row invalidates its token on the next request.

The pairing code never travels anywhere but the QR image on the Mac's
screen and the phone's camera. No code is accepted over the network that
did not come from a QR the user generated in the last 2 minutes.

### 3. Companion web app (`companion/` in the repo, served by Shelf)

A separate small Vite entry, not the desktop renderer. It is mobile-first
and deliberately shallow:

- **Home:** the Activity board (`buildMorningBoard`) as the first screen:
  what is running, what crashed, what is waiting on you. Dock-badge logic
  (`dockBadgeText`) becomes the app badge.
- **Tools:** the library list with the same health chips as the desktop
  (`deriveToolHealth`), filterable by collection. Tap → tool detail.
- **Tool detail:** Start / Stop / Restart (the existing `StartOptions`,
  no port-conflict dialogs: on conflict the phone shows the same message
  the desktop would and offers nothing destructive). Live log tail from
  `RunLogStore` over the WebSocket, with the same secret masking the
  desktop applies. **Open preview** when the tool allows it (below).
- **Collections:** Start stack / Stop stack, with the ordered progress the
  desktop already streams.
- **Not in the Companion:** creating or editing tools, design profiles,
  drafts, team catalogs, verification runs, folder pickers, anything that
  needs the filesystem or a long form. These are desk tasks.

Web first, native later. A Home Screen web app gets installability, web
push (iOS 16.4+), and the app badge without an App Store review cycle or
a second codebase. A SwiftUI shell is a later option if Live Activities,
widgets, or Shortcuts turn out to matter; the HTTP + WebSocket protocol
is the contract either way.

### 4. Preview proxy

The hard part. Tools bind to loopback, which is correct and must stay the
default. For a tool the user has marked **Allow remote preview**, Shelf
proxies it.

**Decision: proxy port-for-port, not under a path prefix.** Approved
2026-10-28, including the consequence that a running tool's port is
reachable on the companion interface while its toggle is on, guarded by
the grant cookie.

- Path-prefix proxying (`/preview/<id>/…`) breaks most dev servers: Vite,
  Next, and anything with absolute asset URLs or an HMR WebSocket assume
  they own the origin.
- Port-for-port means Shelf listens on `<bind-address>:<tool.port>` and
  forwards to `127.0.0.1:<tool.port>`, including WebSocket upgrades. The
  tool sees an ordinary request on its own port and needs no change.
- Access control: the proxy accepts a request only if it carries a
  Companion session cookie set by `/api/preview-grant/<toolId>` (which
  itself requires the device token). The cookie is scoped to that port,
  short-lived (proposal: 8 hours), and revoked when the tool is stopped or
  the toggle is turned off. A bare browser hitting the port gets `401`.
- Lifetime: the proxy listener exists only while the tool is running
  **and** the toggle is on. It is torn down on stop, on toggle-off, and on
  Companion-off. `ProcessManager` already knows every state transition;
  the proxy subscribes to it rather than polling.
- Tool flag: `remotePreview?: boolean` on the tool schema in
  `shared/tool-validation.ts`. Additive and optional; no library
  migration. Agents cannot set it over MCP (`shelf_upsert_tool` strips
  it). It defaults off for every existing tool and every imported or
  shared tool, and the import/consent sheet never offers it.

**Known limits, stated in the UI, not hidden:**

- Tools that bind to `0.0.0.0` are already reachable on the LAN without
  Shelf; the toggle is a no-op for them and the UI says so.
- Tools with `tool.url` pointing at a different host than loopback are not
  proxied.
- HTTPS-only tools (rare locally) are passed through as TLS; Shelf does
  not terminate them.

### 5. Keep awake

A sleeping Mac is unreachable over Tailscale. New preference
**Stay awake while a device is connected** uses Electron's
`powerSaveBlocker` (`prevent-app-suspension`) while at least one
Companion WebSocket is open, released 60 seconds after the last one
closes. Off by default. The Companion home screen shows the blocker state
so the user knows the Mac will not nap.

### 6. Settings → Companion (desktop GUI)

One grouped section in the existing Settings page:

- **Companion** on/off, bind interface picker (Tailscale detected and
  preselected when present), port.
- **Paired devices** list with name, last seen, from where, Revoke.
- **Pair a device** button → QR sheet.
- **Stay awake while connected** toggle.
- A plain paragraph of what this does and does not expose, in the same
  voice as the sharing consent sheet.

Per-tool: an **Allow remote preview** toggle in the tool editor's
Advanced area, with a one-line explanation that it opens the tool's port
to paired devices on the chosen interface while the tool runs.

## Security notes

- Threat model: an attacker on the same tailnet or LAN. Mitigations:
  TLS with pinned fingerprint, bearer tokens hashed at rest, 2-minute
  single-use pairing codes, per-port scoped preview cookies, no loopback
  or `0.0.0.0` binding, rate limiting, Revoke that works on the next
  request.
- Logs sent to the phone pass through the same masking the desktop uses;
  env values are never sent (the Companion has no tool editor).
- Error reports (`buildErrorReport`) are available on the phone as text to
  paste into an agent session, same as the desktop, since that is a real
  remote-work loop: tool crashed, read the report on the phone, hand it to
  the agent that is already running.
- The MCP surface gains nothing. `shelf_*` tools stay stdio and local.

## Phases

### Phase A — Control (the useful 80%) — shipped 2026-10-28 (2.4.0, unreleased)

Built as specified, with these deviations recorded:

- **Dependencies:** `ws` (WebSocket server) and `qrcode` (QR rendering in
  the Settings pane) were added rather than hand-rolling either. Both are
  small, widely used, and the smoke suite exercises the server end to end.
- **Certificate generation** shells out to the system `openssl` (LibreSSL)
  with a config file, since Node cannot mint certificates. The certificate
  is generated once into `<dataRoot>/companion/` and never regenerated.
  Browsers cannot pin a fingerprint, so the QR's fingerprint is shown on the
  phone's pairing screen for the user to compare, and Settings offers
  **Save certificate…** so the phone can install and trust it, which is what
  actually removes Safari's warning and makes Home Screen install clean.
- **The WebSocket token** travels as a second subprotocol
  (`Sec-WebSocket-Protocol: shelf-companion, <token>`) rather than a URL
  parameter, so it never lands in a log line.
- **Launch provenance:** a new `LaunchOrigin.kind = 'companion'` with the
  device name as `client`, so receipts, the tray, and the Activity board say
  a phone did it.
- **Phone-side unpair:** `DELETE /api/me` lets the phone revoke itself from
  its More screen.
- **Serving the web app** needs the built bundle (`dist/companion`); in
  `electron:dev` the Companion serves the last `npm run build`.
- **Pairing codes** are 8 characters from an unambiguous alphabet and can be
  typed on the phone when the camera is not handy.
- **Home Screen apps pair twice.** iOS gives a Home Screen web app its own
  storage, separate from Safari, so the token from the Safari pairing is
  not there. Found in Carlos's first real test (2026-10-28, over LTE on
  Tailscale). The pairing screen now says so when running standalone, the
  device is named "iPhone (Home Screen)", and the Mac's QR copy warns about
  the second pairing. A single-pairing install would need the token in the
  start URL, which would persist a secret in the manifest; not done.
- `smoke:companion` runs the live server on the Mac's first non-loopback
  interface on an ephemeral port (loopback is refused by design); on a
  machine with no such interface it runs the policy checks only and says so.

Original scope follows.


Companion server, pairing store, QR pairing, Settings section, web app
with Home / Tools / Tool detail / Collections, live state over WebSocket,
log tail, keep-awake. No preview. Ships on its own and already answers
"is it still up, restart it."

Prerequisite: the IPC-by-domain split from PRODUCT.md "Later" item 2, so
the server and preload share one typed channel map.

### Phase B — Preview — shipped 2026-10-28 (2.4.0, unreleased)

Built as specified, with these deviations and findings recorded:

- **Not port-for-port after all.** The first real test (2026-10-28) showed
  why: Shelf's process truth is port-based (lsof), so a proxy holding the
  tool's port number on the Tailscale interface read as the tool being up
  after it had stopped, and the library card cycled Running → Error. The
  proxy now takes its own port, the first free one above the Companion
  port (48621, 48622, …), one per tool, and forwards to
  `127.0.0.1:<tool.port>`. Dev servers do not care: absolute asset paths
  and the HMR socket use the page's own origin, which is the proxy's. It
  also removes the clash with tools that bind every interface.
- **The proxy terminates TLS** with the Companion certificate (plain HTTP
  to the tool, or HTTPS when the tool's url says so). A phone that already
  trusts the Companion certificate trusts every preview port too.
- **Host is rewritten to `127.0.0.1:<port>`** on the way in, because Vite
  6 and friends refuse unknown Host headers; `X-Forwarded-Host/Proto/For`
  carry the originals. Loopback redirects from the tool are rewritten back
  to the proxy origin. The grant cookie is stripped before forwarding, so
  the tool never sees it.
- **Grant flow:** the phone calls `POST /api/tools/:id/preview-grant`
  (device auth) and receives a one-time ticket URL on the proxy port
  (`/__shelf_grant?t=…`, 60 s, single use); opening it sets an
  `HttpOnly; Secure; SameSite=Lax` cookie scoped to that port and redirects
  to `/`. Grants last 8 hours, die with the listener (tool stopped, toggle
  off, Companion off) and with a revoked device.
- **Lifecycle** follows `process:update` events through
  `CompanionManager.broadcast` plus the tools IPC save/delete and the data
  watcher, serialized so a quick stop/start cannot interleave.
- **`remotePreview` is carried through, never set, by every non-GUI write
  path.** `shelf_upsert_tool` passes the stored value explicitly; drafts,
  shared-tool import, update, and catalog install build tools from explicit
  fields. The library's write normalizer had to learn the field: it rebuilds
  every stored tool field by field and was silently dropping the flag — the
  preview smoke caught it.
- **0.0.0.0 detection is not attempted.** Shelf cannot know what a tool
  binds; the editor copy says a tool that already listens on every
  interface is reachable regardless. With the proxy on its own port, such a
  tool no longer collides with it.
- **Vite HMR verified by hand** on 2026-10-28 with Shelf's own dev server:
  through the proxy, `/` served the page with `/@vite/client`, the client
  script loaded, and the HMR WebSocket upgraded (101) and sent
  `{"type":"connected"}`. `smoke:companion-preview` covers the upgrade path
  with a WebSocket echo backend; a Vite-based smoke was not added because
  it would start a second dev server on 5173.

Original scope follows.


Port-for-port proxy, `remotePreview` flag and editor toggle, grant
cookie, lifecycle tied to `ProcessManager`, WebSocket passthrough
verified against a Vite tool and the zero-dependency starter from
`shared/tool-starter.ts`.

### Phase C — Notifications (optional)

Web push for "tool crashed" and "stack finished starting," reusing
`toolFailureNotice`. Needs a VAPID key pair generated locally once; the
push service is Apple's, reached only by the phone's browser, so the
no-cloud stance holds. Decide after A and B are in real use.

## Smoke tests (names reserved)

- `smoke:companion` — server refuses loopback and `0.0.0.0`, refuses
  plain HTTP, 401 without token, pairing code single-use and expiring,
  revoke takes effect, state stream matches `ProcessManager.getStates()`.
- `smoke:companion-preview` — proxy exists only while tool runs and flag
  is on, bare request 401, granted cookie passes, WebSocket upgrade
  reaches the tool, teardown on stop.
- `smoke:companion-ui` — Settings section, QR sheet, device list, tool
  editor toggle, under `run-electron-smoke.mjs` like `smoke:compact-ui`.

## Approval gate

A tool crashed while Carlos was away. On the phone he saw it on the Home
screen, read the error report, restarted it, watched the log tail come
back healthy, and opened the preview to confirm, all over Tailscale, with
no account anywhere and no port reachable by anything that was not
paired.

## Decisions (2026-10-28)

1. **Port-for-port preview: accepted.** Phase B does not wait on Phase A
   earning trust; it ships when it passes `smoke:companion-preview`.
2. **Tailscale is the recommended transport,** named in docs and in
   Settings copy. The interface picker stays for LAN and other VPNs.
3. **Web-first.** Phase A ships as a Home Screen web app served by
   Shelf. Native is revisited only after real use shows a want for Live
   Activities, widgets, or Shortcuts; if so, a thin SwiftUI shell embeds
   the same web app. Trade-off recorded below.
4. **Version 2.4.** The IPC-by-domain split lands first, as its own
   2.3.x release, so 2.4 is Companion only.

## Web app vs native (decided web-first 2026-10-28)

The plan above is web-first: a Home Screen web app served by Shelf. The
alternative is a SwiftUI app in the App Store (or TestFlight) talking to
the same server. The protocol is identical either way; this is a question
about the phone-side shell only.

What web-first gives up, in order of how likely it is to matter:

- **Lock-screen and Dynamic Island presence (Live Activities).** Native
  only. "Stack starting: 3 of 5 up" on the lock screen is the one feature
  that is genuinely better than a notification.
- **Home Screen widgets.** Native only. A small widget showing
  running/crashed counts without opening anything.
- **Shortcuts and Siri.** Native only. "Hey Siri, restart the invoice
  tool."
- **Notifications that survive everything.** Web push on iOS works, but
  only after the user adds the app to the Home Screen, and iOS has
  historically been stricter about delivery for web apps than for native
  ones.
- **Camera-less pairing.** A native app could pair over Bonjour on the
  LAN without a QR scan. Minor; the QR flow is fine.

What native costs:

- A second codebase in a second language that nobody on the project
  writes today, kept in step with a server that will change.
- App Store review for every release, or TestFlight with 90-day expiry
  for a personal build. Shelf's current release flow (signed, notarized
  DMG from GitHub Releases) does not carry over.
- An App Store listing for a product whose stance is "no account, nothing
  leaves the Mac" invites review questions about what the app connects
  to.

Decision: ship Phase A as web, use it for real for a few weeks, then
revisit. If Live Activities or a widget turns out to be the thing you
reach for, add a thin SwiftUI shell that embeds the same web app and adds
only those native surfaces; the server and the web UI need no change.

