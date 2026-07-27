# Shelf site (`shelfmcp.com`)

Marketing / waitlist site for Shelf Community.

## Develop

```bash
cd site
cp .env.example .env.local   # set DATABASE_URL from Neon
npm install
npm run dev
```

## Deploy

Vercel project: **shelf-site** on team [carlos-projects-882b0b3c](https://vercel.com/carlos-projects-882b0b3c/shelf-site) (AI Ventures).

Git integration is connected to `ai-ventures-hub/shelf` with **Root Directory** = `site` — pushes to `main` that touch `site/` deploy to production automatically.

**Required env:** set `DATABASE_URL` (Production + Preview) from Neon project `shelf-waitlist` — waitlist inserts fail closed without it:
https://vercel.com/carlos-projects-882b0b3c/shelf-site/settings/environment-variables

Production alias: [shelf-site-one.vercel.app](https://shelf-site-one.vercel.app). Attach **shelfmcp.com** under Domains when you own it.

CLI tip: `vercel login` must be the AI Ventures account (`carlos-projects-882b0b3c`), not the GWP / personal `cmontalvo-9327` CLI session.

## Brand

- Product name: **Shelf** (not “Shelf MCP”)
- Domain: shelfmcp.com
- Design language: AI Ventures (`--av-*` tokens — Archivo / Inter / JetBrains Mono, indigo on slate, dark-only)
- Landing redesign: seven beats from the Claude Design canvas (command-deck hero with live agent↔Shelf demo, graveyard ledger, smart-import scan, honest cards, capability ask & answer, shared-library hub, receipt CTA). Reference bundle in `landing-page-redesign-options/` (untracked).
