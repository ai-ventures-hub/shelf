/** Deterministic token extraction smoke (Design Engine Phase 3). */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { extractProjectTokens } = require('../dist-electron/shared/design-extract.js')

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shelf-extract-'))

try {
  fs.mkdirSync(path.join(root, 'src/styles'), { recursive: true })
  fs.mkdirSync(path.join(root, 'node_modules/evil'), { recursive: true })

  fs.writeFileSync(
    path.join(root, 'src/styles/tokens.css'),
    `/* comment { --decoy: #000; } */
:root {
  --brand: #4f6ef2;
  --color-accent: rgb(10, 20, 30);
  --surface: #f7f7f8;
  --radius-card: 16px;
  --content-max: 71.25rem;
  --font-family-app: Inter, system-ui, sans-serif;
  --av-font-heading: Archivo, ui-sans-serif, system-ui;
  --font-smoothing: antialiased;
  --font-weight-bold: 700;
  --font-size-body: 15px;
  --line-height-body: 1.55;
  --brand-alias: var(--brand);
  --with-fallback: var(--nope, #123456);
  --hero-gradient: linear-gradient(145deg, #9aafff, #526fdd);
}
@media (prefers-color-scheme: dark) {
  :root {
    --surface: #090d16;
  }
}
html[data-theme='dark'] {
  --brand: #7895ff;
}
.light {
  --surface: #ffffff;
}
.card {
  --card-only: #ff0000;
}
`,
  )
  // A second file later in sort order overrides an earlier declaration.
  fs.writeFileSync(
    path.join(root, 'src/styles/z-overrides.css'),
    ':root { --brand: #4459d8; }\n',
  )
  // Never scanned: node_modules.
  fs.writeFileSync(
    path.join(root, 'node_modules/evil/style.css'),
    ':root { --evil: #bad000; }\n',
  )
  fs.writeFileSync(
    path.join(root, 'tailwind.config.js'),
    `/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.tsx'],
  theme: {
    extend: {
      colors: {
        twbrand: '#0ea5e9',
        brand: '#should-not-win',
        ocean: { DEFAULT: '#0369a1', deep: '#082f49' },
        computed: makePalette(),
      },
      fontFamily: {
        display: ['Archivo', 'Inter', 'sans-serif'],
      },
    },
  },
}
`,
  )

  const result = extractProjectTokens(root)

  // --- Base tokens ---
  assert.equal(result.tokens.color.brand.$value, '#4459d8', 'later CSS file wins by cascade order')
  assert.equal(result.tokens.color.accent.$value, 'rgb(10, 20, 30)', 'color- prefix stripped, functional color kept')
  assert.equal(result.tokens.color.surface.$value, '#f7f7f8')
  assert.equal(result.tokens.dimension['radius-card'].$value, '16px')
  assert.equal(result.tokens.dimension['content-max'].$value, '71.25rem', 'rem dimensions extracted')
  assert.equal(
    result.tokens.typography['font-family'].app.$value,
    'Inter, system-ui, sans-serif',
  )
  assert.equal(
    result.tokens.typography['font-family'].heading.$value,
    'Archivo, ui-sans-serif, system-ui',
    'prefixed font vars (--av-font-heading) classify as font families',
  )
  assert.equal(
    result.tokens.typography['font-family'].smoothing,
    undefined,
    'single-keyword font-adjacent vars are not families',
  )
  assert.equal(result.tokens.typography['font-weight'].bold.$value, 700, 'weights are numbers')
  assert.equal(result.tokens.typography['font-size'].body.$value, '15px')
  assert.equal(result.tokens.typography['line-height'].body.$value, 1.55)
  assert.equal(result.tokens.color['brand-alias'].$value, '#4459d8', 'var() resolves against the final cascade value')
  assert.equal(result.tokens.color['with-fallback'].$value, '#123456', 'var() fallback used when target missing')

  // --- Modes ---
  assert.equal(result.modes.dark.color.surface.$value, '#090d16', 'prefers-color-scheme dark → modes.dark')
  assert.equal(result.modes.dark.color.brand.$value, '#7895ff', '[data-theme=dark] → modes.dark')
  assert.equal(result.modes.light.color.surface.$value, '#ffffff', '.light scope → modes.light')

  // --- Exclusions ---
  assert.equal(result.tokens.color['card-only'], undefined, 'component-scoped vars are skipped')
  assert.equal(result.tokens.color.evil, undefined, 'node_modules never scanned')
  assert.equal(result.tokens.color['hero-gradient'], undefined, 'gradients are not token literals')
  assert.ok(
    result.skipped.some((s) => s.includes('component-scoped')),
    'component-scoped skip is reported',
  )
  assert.ok(
    result.skipped.some((s) => s.includes('non-token values')),
    'unclassified values are reported',
  )

  // --- Tailwind literals ---
  assert.equal(result.tokens.color.twbrand.$value, '#0ea5e9', 'tailwind literal color extracted')
  assert.equal(result.tokens.color.brand.$value, '#4459d8', 'CSS custom property beats tailwind on the same name')
  assert.equal(result.tokens.color.ocean.$value, '#0369a1', 'DEFAULT flattens to the bare name')
  assert.equal(result.tokens.color['ocean-deep'].$value, '#082f49', 'nested tailwind colors flatten with dashes')
  assert.equal(
    result.tokens.typography['font-family'].display.$value,
    'Archivo, Inter, sans-serif',
    'tailwind fontFamily arrays join',
  )
  assert.equal(result.tokens.color.computed, undefined, 'non-literal tailwind entries skipped')
  assert.ok(
    result.skipped.some((s) => s.includes('computed')),
    'non-literal tailwind skip is reported by name',
  )

  // --- Counts + sources ---
  assert.ok(result.counts.color >= 7, `color count sane (${result.counts.color})`)
  assert.equal(result.counts.dark, 2)
  assert.equal(result.counts.light, 1)
  assert.equal(result.sources.length, 3, 'two css files + tailwind config as sources')
  assert.ok(result.sources.some((s) => s.file === 'tailwind.config.js'))

  // --- Determinism: same input, identical output ---
  assert.deepEqual(extractProjectTokens(root), result, 'extraction is deterministic')

  // --- Empty project degrades cleanly ---
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'shelf-extract-empty-'))
  try {
    const none = extractProjectTokens(empty)
    assert.deepEqual(none.tokens, {}, 'no styles → empty tokens, no throw')
    assert.equal(none.sources.length, 0)
  } finally {
    fs.rmSync(empty, { recursive: true, force: true })
  }

  assert.throws(
    () => extractProjectTokens(path.join(root, 'does-not-exist')),
    /Not a folder/,
    'missing path throws a plain message',
  )

  console.log('OK: design token extraction — css vars, modes, tailwind literals, determinism')
} finally {
  fs.rmSync(root, { recursive: true, force: true })
}
