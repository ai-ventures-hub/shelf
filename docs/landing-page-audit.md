# Shelf Landing Page Audit & Designer Handoff (`shelfmcp.com`)

**Audited:** 2026-11-22  
**Live URL:** https://shelfmcp.com/ (and `/download`)  
**Product baseline:** Shelf `v2.5.0` (macOS Apple Silicon, Electron + React + bundled stdio MCP + phone Companion)  
**Site codebase:** `site/` (Next.js App Router, Vercel project `shelf-site`)

---

## 1. Executive Summary

`shelfmcp.com` already looks sharp and sounds honest: strong dark studio typography (`Archivo` + `Inter` + `JetBrains Mono`), disciplined trust posture (*"Nothing runs until you approve"*, *"Secrets never travel"*), interactive brand/mode demos, and real product footage.

**The gap is scope and currency.** The site still reads like a **v1.x local folder launcher with MCP attached**, rather than what Shelf actually is in `v2.5.0`: **a complete local control plane for AI-built tools—from idea to running app, on your Mac, inside your AI agents, on your phone, and across your team.**

Sections were also appended release-by-release (`1.2`, `1.3`, `1.4`), pushing the page to **9,250px** across 10 sections with repeating layouts near the bottom while **omitting five of Shelf's strongest shipped features**.

---

## 2. Keep What Works

- **Visual identity & tokens:** Dark navy/indigo studio theme (`--av-*` design tokens in `site/src/app/globals.css`), high contrast, zero SaaS fluff.
- **Voice & trust rules:** Plain words, short sentences, explicit safety guarantees. These guardrails apply to every section of the redesign:
  - Shelf connects to a tool's own MCP server or local HTTP API only when an agent asks through the gateway or the user presses Check, only on this Mac, and the user can switch it off. Never claim it runs a tool's CLI or reaches remote servers.
  - Never claim cloud sync, Shelf accounts, or hosted relays.
  - Keep *"Secrets never travel"* and *"Nothing runs until you approve"* front and center. The current wording lives in `site/src/lib/landing-content.ts`; reuse it rather than rewriting it.
  - Companion claims must match `docs/COMPANION.md`: HTTPS with a self-signed, fingerprint-pinned certificate over the user's own Tailscale or LAN address; no relay, no broker, no login. Do not say "encrypted cloud", "sync", or imply it works away from the user's own network without Tailscale.
  - Source note: `docs/LANDING.md` is a stale 0.4.0-era plan (waitlist, phased demo). Its "must-not claims" list still holds, but treat this audit as the current brief and update or retire that file with the redesign.
- **Interactive & real proof:** Keep the live **Design Profile switcher** (`Shelf | Verdant | Klaxon`), the **Simple / Developer mode toggle**, and real screen recordings.

---

## 3. Major Shipped Capabilities Missing from `shelfmcp.com`

These features are shipped in `v2.5.0` and represent the biggest disconnect between Shelf's real power and what visitors see:

### A. Phone Companion & Live Remote Preview (`v2.4`–`v2.5`) — **0% coverage**
- **What it does:** Pair your phone by scanning a QR code over your own Tailscale or LAN address (zero cloud relay, zero account). From your phone you can:
  - See, start, stop, and restart tools and **Stacks** (`N of M up` live progress).
  - Read live filtered logs (`Errors` toggle + text search).
  - **Accept or reject** tools an AI agent asked to register while away from your desk.
  - Open **live proxied previews** of running local dev servers right on your phone (WebSockets + HMR included, 8-hour per-device grant, 1-click QR from any desktop tool page).
- **Why it belongs on the page:** Instant visual contrast (Mac + iPhone over local network) and a massive differentiator no plain launcher has.

### B. Start a New Tool from an Idea (`v2.2`) — **0% coverage**
- **What it does:** Describe what you want to build → Shelf scaffolds a runnable zero-dependency Node project on an unused loopback port, writes your Design Profile (`DESIGN.md` + CSS tokens) and `AGENTS.md` build brief, registers the tool, and opens Claude Code, Codex, or Cursor right in the folder with the kickoff prompt. Also wired directly from **Capability Gaps** (*Gap recorded → Start this tool*).
- **Why it belongs on the page:** Right now the site only shows the *"after you built it, drop a folder"* half. Showing **Idea → Scaffold → Running Tool** turns Shelf from a tidy drawer into a full creation-to-operation loop.

### C. Failure Diagnostics, 1-Click Remedies & Auto-Heal (`v2.5`) — **0% coverage**
- **What it does:** When a local tool fails to start or crashes, Shelf diagnoses the cause (port collision, missing env var, missing dependencies, missing folder, Docker not running) and offers **1-click fixes** (*Launch on a free port*, *Install dependencies*, *Edit environment variables*, *Open Docker Desktop*) plus opt-in **Auto-Heal** (`autoRestart`) with exponential backoff (`1s`, `3s`, `8s`, max 3 retries / 5 min) that automatically skips deterministic config errors.
- **Why it belongs on the page:** Every developer who runs local AI-built apps hits port conflicts and missing `.env` keys weekly. Showing Shelf diagnose and recover a tool in one click proves real engineering depth.

### D. Unified "Needs You" Inbox & Human-in-the-Loop Approvals (`v2.1` / `v2.5`) — **Buried**
- **What it does:** One calm **Needs you** inbox unifying errored tools (with inline remedies), staged agent tool registrations (review folder, command, port, env key names → Accept / Reject), and open capability gaps.
- **Why it belongs on the page:** *"Agents draft. You decide."* is currently buried at ~8,000px inside Stacks. It should be elevated as a core architectural pillar across tools, stacks, and design profiles.

### E. Project Memory, Verification Checks & Agent Handoffs (`v1.x`–`v2.x`) — **Promised, never shown**
- **What it does:** Save a project's purpose, conventions, decisions, and known issues; run saved typecheck/lint/test/build checks after review; generate an editable handoff brief with run evidence and design context for any agent.
- **Current contradiction:** `#app` opens with *"The library, the checks, and a handoff you review before it reaches an agent"*—yet neither **Verification checks** nor **Memory & handoff** exists in the showcase tabs or anywhere else on the page.

### F. Native Mac Ergonomics — **Unmentioned**
- `⌘K` Quick Open (jump, launch, restart, stop all running tools), Menu Bar mode, `⌘⇧Space` global toggle, Dock drop-to-add, Dock running count badge, and confirmed `shelf://` deep links.

---

## 4. Live Bugs, Leaks & Structural Issues to Fix

### Fix now — do not wait for the redesign

Both leaks are live on the public site today and are small changes.

**Status (2026-11-22):** fixed in the working tree, not yet committed or deployed. The mockups now use `Client Sites`, `Media Studio`, and `Studio Team`; `app-library.png` is a fresh `v2.5.0` capture from a demo library. The live site keeps the old content until `shelf-site` is redeployed.

| Priority | Location | Issue | Recommended Fix |
|---|---|---|---|
| **P0 (Leak)** | `site/src/components/landing/AppShowcase.tsx` (lines 92, 96) & `ToolSharing.tsx` (line 110) | Private/agency collection names **`GWP Tools`** and **`Suds Tools`** appear in public mockups. | Replace with generic, universal demo names (`Client Sites`, `Media Studio`, `Internal Ops`). |
| **P0 (Leak)** | `site/public/app-library.png` | Hero background screenshot displays personal/agency tools (`AI Ventures Brand`, `Suds Work Queue`, `MCP Claude Setup`), the `GWP Tools` / `Suds Tools` collections in its sidebar, and tool descriptions that name clients (*"Suds Digital client website-edit…"*, *"AI Ventures design-system…"*). It also predates `v2.5`. | Capture a clean, fresh `v2.5` library screenshot from a demo library: sanitized tool names, descriptions, and collections. |

The repo is public, so the old names and screenshot remain in git history after these fixes. Decide separately whether that matters; rewriting history is not part of this handoff.

### Fix with the redesign

| Priority | Location | Issue | Recommended Fix |
|---|---|---|---|
| **P1 (Bug)** | `site/src/components/landing/AppShowcase.tsx` (lines 41–43, 331–333) | Lead copy promises *checks* and *handoff*, neither of which is a tab; footer caption hardcodes *"Every tool on one calm home screen…"* even while **`MCP Connections`** is the default active tab. | Make the showcase caption dynamic per tab; align tabs with the lead copy (add **Needs You** and **Memory & Handoffs / Checks**). |
| **P1 (UI)** | `site/src/components/landing/AppShowcase.tsx` + `site/src/app/globals.css` | The mock sidebar's `SYSTEM` rows are clipped at the bottom edge of `.mock-window--app`; in the `MCP Connections` diagram, all 4 animated lines bunch into the middle two rows instead of aligning with Claude Desktop and OpenAI Codex. | Adjust mock window height/padding so `SYSTEM` sits cleanly inside the frame; align each connector line vertically to its corresponding client card. |
| **P1 (UX)** | `site/src/components/landing/HeroScrollStage.tsx` | The 2,037px pinned scroll scrub hides the actual app for ~1,300px of scrolling, then reveals a heavily dimmed screenshot behind 5 placeholder tiles. | Bring crisp product UI (Mac + MCP + Phone cue) into view above or immediately below the fold; reduce scroll tax. |
| **P1 (Layout)** | `site/src/components/landing/ToolSharing.tsx` & `AgentCollections.tsx` | Two back-to-back sections (`#share` and `#collections`) repeat the exact same template (copy + prompt chip + mock window + 4 numbered cards), contributing to the 9,250px page length. | Consolidate Team Sharing + Ordered Stacks into one tighter, varied section. |
| **P1 (Media)** | `site/src/components/landing/AgentChat.tsx` | The Cursor + Shelf side-by-side recording sits in a narrow half-column behind a dark play overlay, making UI text hard to read. | Give the agent demo wider framing, a zoomed crop, or click-to-expand lightbox playback. |
| **P2 (Nav)** | `site/src/components/landing/SiteHeader.tsx` | Top nav omits **Brand/Design**, **Companion**, and **Sharing/Teams**. | Update anchor nav to match the new 7-section structure (keep ≤5 links so tablet stays single-line). |
| **P2 (SEO)** | `site/src/app/layout.tsx` & `site/src/app/page.tsx` | `<title>` (`Shelf · You build the tools. Shelf keeps them.`) omits `macOS` and `MCP`; `SOFTWARE_JSON_LD` omits `softwareVersion` and `featureList`. | Update `<title>` to include `macOS` and `MCP` (e.g., *Shelf — Local Tool Library & MCP Control Plane for macOS*) and enrich JSON-LD. |
| **P2 (Conversion)** | `site/src/app/download/page.tsx` | Download page doesn't show the current version (`v2.5.0`) or what to do in the first minute after opening Shelf. | Show the release badge + a compact *"First 60 seconds"* strip (Connect AI client → Drop or start a tool → Pair your phone). |

---

## 5. Recommended 7-Section Page Architecture

Reorganize the page by **user workflow** instead of chronological release history (target ~5,500–6,500px instead of 9,250px):

1. **Hero — Immediate Product Clarity**
   - Sharper positioning headline & subhead covering the full control plane (*build, run, heal, brand, share, and reach from agents or your phone*).
   - Crisp product visual immediately visible (Mac Library + MCP connection + Phone Companion hint).
   - Primary CTA (`Download for free`) + Secondary (`Watch 30s demo`) + Proof strip of four items (`Free & MIT · No account · Signed & notarized · Apple Silicon`). Leave the version number and MCP tool count off the hero: both go stale every release (the server registers 31 tools as of `v2.5.0`). If either is shown anywhere, generate it from the code or release feed at build time.

2. **From Idea to Running (and Self-Healing)**
   - Two entry points side-by-side: **Start from an idea** (scaffolds project + port + `DESIGN.md` + `AGENTS.md` + launches agent) and **Drop any existing folder** (auto-detects scripts, ports, Docker, env).
   - Real drop-to-run video.
   - Fold in **Honest Status + 1-Click Remedies & Auto-Heal** (TCP-verified readiness, distinct agent readiness, port-conflict / missing-env / missing-deps 1-click recovery).

3. **One Library, Every AI Agent (`#app` + `#agents`)**
   - Interactive showcase window (clean demo data, fixed clipping, aligned MCP lines, dynamic tab captions) with tabs:
     - **Library**
     - **Needs You** *(errored tools, staged agent registrations, open capability gaps)*
     - **Memory & Handoffs** *(project memory, verification checks, paste-ready evidence brief)*
     - **MCP Connections** *(Claude Desktop, Claude Code, Cursor, Codex — 1-click config)*
   - Larger, readable framing for the real **Cursor → Shelf launch** video.

4. **Your Brand, Automatically (`#design`)**
   - Keep the standout live **Brand Switcher** (`Shelf | Verdant | Klaxon`).
   - Add one crisp line showing the full loop: extract deterministically from CSS/Tailwind or draft from a screenshot → automatically applied to every new tool you start and served to agents via MCP.

5. **Your Local Tools, On Your Phone (NEW — `#companion`)**
   - Dedicated Mac + iPhone split showcasing HTTPS over your own Tailscale or LAN address (no relay, no account; wording per `docs/COMPANION.md`):
     - QR pair in seconds.
     - Start/stop tools and **Stacks** with live `N of M up` progress.
     - Live filtered logs + accept/reject staged agent tools away from your desk.
     - **Live remote preview** of local dev servers (HMR + WebSockets, 1-click QR from desktop, 8h per-device grants).

6. **Share with One Coworker, or a Whole Team + Ordered Stacks (`#share`)**
   - Merge `#share` and `#collections` into one varied, high-signal band:
     - `shelf://add` consent sheet (secrets never leave your Mac; git carries it; diff-reviewed updates).
     - Git-backed `catalog.json` **Team Tools**.
     - **Stacks** (agent-drafted or manual, start in dependency order or together).

7. **Built Like a Real Mac App + Final CTA (`#dev`)**
   - Interactive **Simple / Developer mode** toggle paired with a compact native-craft bento:
     - `⌘K` Quick Open & Menu Bar (`⌘⇧Space`)
     - Plain JSON on disk (`~/Library/Application Support/Shelf`) — readable, versionable, zero lock-in
     - Signed, notarized, auto-updating from GitHub Releases
   - Closing Download + GitHub source CTA.

---

## 6. Asset Checklist for Refresh

Before publishing the redesign, refresh these static assets in `site/public/`:
- `site/public/app-library.png` — fresh `v2.5` library screenshot with sanitized demo tools (no `GWP`/`Suds`/`AI Ventures`/personal names in tool names, descriptions, or collections).
- `site/public/media/shelf-drop-and-run.mp4` (+ poster) — verify framing & resolution on `v2.5` UI.
- `site/public/media/shelf-agent-launch.mp4` (+ poster) — re-crop or record closer so Cursor prompt + Shelf card transition are legible without fullscreen.
- **New visual asset:** Phone Companion mockup or real iOS screenshot showing a paired tool list + live preview / Stacks screen beside the desktop QR modal.
