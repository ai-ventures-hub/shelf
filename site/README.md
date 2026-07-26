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

When linking this git monorepo, set **Root Directory** to `site` in the Vercel project settings.

**Required env:** set `DATABASE_URL` (Production + Preview) from Neon project `shelf-waitlist` — waitlist inserts fail closed without it:
https://vercel.com/carlos-projects-882b0b3c/shelf-site/settings/environment-variables

Production alias: [shelf-site-one.vercel.app](https://shelf-site-one.vercel.app). Attach **shelfmcp.com** under Domains when you own it.

CLI tip: `vercel login` must be the AI Ventures account (`carlos-projects-882b0b3c`), not the GWP / personal `cmontalvo-9327` CLI session.

## Brand

- Product name: **Shelf** (not “Shelf MCP”)
- Domain: shelfmcp.com
- Design language: Suds System Studio (`DESIGN.md` tokens)
- Vision Phase 1: dual-surface Agent + Shelf demo + narrative sections (interactive prompts / voice in later phases)
