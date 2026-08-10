/**
 * Seed the "Shelf" design profile (Design Engine v1.0 Phase 1) from the
 * repo's brand system: DESIGN.md (intent/voice), src/styles/tokens.css
 * (color/dimension values), site globals (type scale), docs/brand assets.
 *
 * Idempotent: upserts by name, asset re-imports overwrite by basename, and
 * a rerun never steals the default flag from a user-chosen profile.
 *
 * Targets the real Shelf data root; set SHELF_DATA_ROOT to test elsewhere.
 * Run via `npm run seed:design` (compiles dist-electron first).
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { DesignProfileStore } = require('../dist-electron/shared/design-profile-store.js')

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const color = (value) => ({ $value: value, $type: 'color' })
const dimension = (value) => ({ $value: value, $type: 'dimension' })
const fontWeight = (value) => ({ $value: value, $type: 'fontWeight' })
const fontFamily = (value) => ({ $value: value, $type: 'fontFamily' })

/** Base tokens are the dark theme — Shelf's brand is dark-first. */
const tokens = {
  color: {
    ink: color('#f6f7fb'),
    muted: color('#99a3b8'),
    subtle: color('#6f7a91'),
    surface: color('#090d16'),
    panel: color('#111725'),
    'panel-raised': color('#171e2f'),
    line: color('#273047'),
    input: color('#0b101c'),
    brand: color('#7895ff'),
    'brand-strong': color('#9badff'),
    success: color('#48d597'),
    warning: color('#f3bc62'),
    danger: color('#f0787d'),
    favorite: color('#f3bc62'),
    'on-brand': color('#081021'),
  },
  typography: {
    'font-family': {
      app: fontFamily('Inter, ui-sans-serif, system-ui, sans-serif'),
      display: fontFamily('Archivo, Inter, sans-serif'),
      mono: fontFamily("'JetBrains Mono', ui-monospace, monospace"),
    },
    'font-weight': {
      regular: fontWeight(400),
      medium: fontWeight(500),
      semibold: fontWeight(620),
      bold: fontWeight(720),
      black: fontWeight(850),
    },
    'font-size': {
      body: dimension('15px'),
    },
    'line-height': {
      body: { $value: 1.55, $type: 'number' },
    },
  },
  dimension: {
    'radius-control': dimension('11px'),
    'radius-card': dimension('16px'),
    'radius-mark': dimension('14px'),
    'sidebar-width': dimension('250px'),
    'content-max': dimension('1220px'),
  },
}

const modes = {
  light: {
    color: {
      ink: color('#121826'),
      muted: color('#4b556b'),
      subtle: color('#6b7288'),
      surface: color('#f3f5fb'),
      panel: color('#ffffff'),
      'panel-raised': color('#ffffff'),
      line: color('#d7dce8'),
      input: color('#ffffff'),
      brand: color('#4f6ef2'),
      'brand-strong': color('#3d5ce0'),
      success: color('#1f9d63'),
      warning: color('#c98512'),
      danger: color('#d04850'),
      favorite: color('#c98512'),
      'on-brand': color('#ffffff'),
    },
  },
  // Base tokens ARE the dark theme; no overrides needed.
  dark: {},
}

const direction = `# Shelf brand direction

Shelf's visual language is a high-trust technical control room: calm, precise,
premium, and operationally serious. Dark, restrained, and quietly technical —
information-dense without feeling crowded, with strong hierarchy led by
oversized editorial headings and understated indigo as the single brand accent.

## Do

- Dark-first: base tokens are the dark theme; the light set is a mode override.
- One accent: indigo (\`brand\`) for primary actions, links, and focus. Semantic
  green/amber/red appear only for meaningful state, never decoration.
- Crisp one-pixel \`line\` borders and opaque surfaces. Shadows are rare — the
  centered hero/login card is the only exception.
- Signature gradient for the brand mark: \`linear-gradient(145deg, #9aafff, #526fdd)\`
  with deep-navy \`#081021\` foreground, ~850 weight, 14px radius (11px compact).
- Sentence case for headings and actions; uppercase only for compact structural
  labels (STATUS, SOURCE).
- Type: Inter for UI, Archivo for display headings, JetBrains Mono for code.
  Weights 400 / 500 / 620 / 720 / 850 (variable fonts — keep the exact values).
- Page titles are oversized and tight-tracked (clamp(2.2rem, 5vw, 4.25rem),
  tracking -0.055em); eyebrows are small, uppercase, tracked, in brand-strong.
- Motion is rare, short, and functional; respect prefers-reduced-motion.
- Focus: 3px solid indigo ring with 2px offset on every interactive element.

## Don't

- No neon cyberpunk, generic white SaaS dashboards, heavy glassmorphism, loud
  gradients, excessive shadows, or playful consumer decoration.
- No color without semantic meaning.
- Never convert absence into a healthy state — missing data reads "Unknown" or
  "Unverified", not green.

## Status semantics

- Green: reporting, active, verified, published.
- Amber: stale, candidate, warning, operator review.
- Red: disabled, revoked, expired, failed, destructive.
- Gray: none, unknown, neutral. Always pair color with a text label.

## Voice

Write like a calm senior operator: lead with current state, use specific nouns
and explicit verbs, name the consequence of an action, end operational panels
with the next safe action. Avoid hype, jokes, and vague success messages.
Good: "Stable 2.1.9 · No canary · 0 sites behind". Avoid: "Everything looks awesome!"

## For implementation agents

Implement through shared tokens and reusable components — do not scatter raw
colors through pages. Audit existing code and reuse its patterns before adding
new ones. Verify keyboard navigation, contrast (WCAG AA), responsive behavior
at 390 / 768 / 1440+ px, and loading/error/empty states before calling the
branding complete.`

const assets = [
  ['docs/brand/logo-pack/shelf-mark.svg', 'logo'],
  ['docs/brand/logo-pack/shelf-mark-mono-ink.svg', 'icon'],
  ['docs/brand/logo-pack/shelf-mark-mono-white.svg', 'icon'],
  ['docs/brand/logo-pack/shelf-lockup-dark@2x.png', 'wordmark'],
  ['docs/brand/logo-pack/shelf-lockup-light@2x.png', 'wordmark'],
]

const store = new DesignProfileStore()
const existing = store.findByName('Shelf')
// Never steal default from a profile the user chose later.
const makeDefault = existing ? undefined : !store.getDefault()

const profile = store.save({
  id: existing?.id,
  name: 'Shelf',
  ...(makeDefault !== undefined ? { isDefault: makeDefault } : {}),
  tokens,
  modes,
  direction,
})

for (const [relPath, kind] of assets) {
  store.importAsset(profile.id, path.join(repoRoot, relPath), kind)
}

const final = store.get(profile.id)
console.log(
  `OK: ${existing ? 'updated' : 'created'} design profile "Shelf" (${profile.id})` +
    ` — default: ${final.isDefault}, assets: ${final.assets.length}, data root: ${store.getRoot()}`,
)
