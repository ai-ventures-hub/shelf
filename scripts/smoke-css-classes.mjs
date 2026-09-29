/**
 * Renderer class-name gate: every class a component names must be defined by a
 * stylesheet under src/styles, and every class selector there must still be
 * used somewhere. A past release shipped className="input" with no CSS behind
 * it; this catches that whole family of bugs before it reaches a build.
 *
 * Sources scanned for uses: className attributes and className default
 * parameters in src/**\/*.{tsx,ts}. Inside a className expression every string
 * literal and every static part of a template literal counts as a class list,
 * except strings that are only compared (x === 'running').
 *
 * Also checks WCAG AA contrast for the token pairs the app relies on, per theme.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const srcDir = path.join(root, 'src')
const stylesDir = path.join(srcDir, 'styles')

/**
 * Classes that are intentionally not styled (pure hooks for tests or DOM
 * queries). Keep this empty when possible: an unstyled hook class is exactly
 * what the historical `input` bug looked like. Each entry needs a reason.
 */
const UNSTYLED_ALLOWLIST = new Map([])

function walk(dir, exts, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, exts, out)
    else if (exts.some((ext) => entry.name.endsWith(ext))) out.push(full)
  }
  return out
}

/** Return the balanced `{...}` expression starting at text[start] === '{'. */
function readBraced(text, start) {
  let depth = 0
  let i = start
  let quote = null
  for (; i < text.length; i++) {
    const ch = text[i]
    if (quote) {
      if (ch === '\\') { i++; continue }
      if (quote === '`' && ch === '$' && text[i + 1] === '{') {
        // Nested expression inside a template literal.
        const inner = readBraced(text, i + 1)
        i = i + inner.length
        continue
      }
      if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue }
    if (ch === '{') depth++
    else if (ch === '}') { depth--; if (depth === 0) return text.slice(start, i + 1) }
  }
  return text.slice(start)
}

/** Every string literal and template static part in an expression. */
function stringsIn(expr) {
  const found = []
  const re = /(['"])((?:\\.|(?!\1).)*)\1|`((?:\\.|\$\{[^}]*\}|[^`])*)`/g
  let match
  while ((match = re.exec(expr))) {
    const before = expr.slice(0, match.index).trimEnd()
    const after = expr.slice(match.index + match[0].length).trimStart()
    // Comparisons name states, not classes.
    if (/(===|!==|==|!=)$/.test(before) || /^(===|!==|==|!=)/.test(after)) continue
    // Object keys / indexing, e.g. TONE['x'] or { 'a-b': 1 }.
    if (/\[$/.test(before) || (/[{,]$/.test(before) && /^:/.test(after))) continue
    if (match[3] !== undefined) {
      const staticParts = match[3].replace(/\$\{(?:[^{}]|\{[^{}]*\})*\}/g, '\u0000')
      found.push(staticParts)
      // String literals nested in ${...} are class lists too. When the
      // interpolation is glued to a prefix (`is-${ok ? 'saved' : 'error'}`)
      // they are suffixes, so the class is prefix + literal.
      for (const nested of match[3].matchAll(/\$\{((?:[^{}]|\{[^{}]*\})*)\}/g)) {
        const glued = match[3].slice(0, nested.index).match(/([a-zA-Z_][\w-]*)$/)
        const inner = stringsIn(nested[1])
        for (const s of inner) {
          // `tool-grid${on ? ' tool-grid-compact' : ''}` starts a new class.
          if (!glued || /^\s/.test(s)) found.push(s)
          else if (/^[\w-]+$/.test(s)) found.push(glued[1] + s)
        }
      }
    } else {
      found.push(match[2])
    }
  }
  return found
}

function classTokens(value) {
  return value
    .split(/\s+/)
    // `nav-item${on ? ' is-active' : ''}` keeps nav-item; `is-${state}` is a
    // dynamic prefix (recorded separately), never a class of its own.
    .flatMap((token) => token.split('\u0000').filter((part, i, parts) => !(part.endsWith('-') && i < parts.length - 1)))
    .map((token) => token.trim())
    .filter((token) => token && /^[a-zA-Z_][\w-]*$/.test(token))
}

function usedClasses() {
  const uses = new Map()
  const add = (cls, where) => {
    if (!uses.has(cls)) uses.set(cls, new Set())
    uses.get(cls).add(where)
  }
  const dynamicPrefixes = new Set()
  for (const file of walk(srcDir, ['.tsx', '.ts'])) {
    const text = fs.readFileSync(file, 'utf8')
    const rel = path.relative(root, file)
    const re = /\bclassName\s*[=:]\s*/g
    let match
    while ((match = re.exec(text))) {
      const at = match.index + match[0].length
      const lineNo = text.slice(0, at).split('\n').length
      const where = `${rel}:${lineNo}`
      const ch = text[at]
      let values = []
      if (ch === '"' || ch === "'") {
        const end = text.indexOf(ch, at + 1)
        values = [text.slice(at + 1, end)]
      } else if (ch === '`') {
        const end = text.indexOf('`', at + 1)
        values = stringsIn(text.slice(at, end + 1))
      } else if (ch === '{') {
        values = stringsIn(readBraced(text, at).slice(1, -1))
      } else {
        continue
      }
      for (const value of values) {
        for (const prefix of value.matchAll(/([a-zA-Z][\w-]*-)\u0000/g)) dynamicPrefixes.add(prefix[1])
        for (const cls of classTokens(value)) add(cls, where)
      }
    }
  }
  return { uses, dynamicPrefixes }
}

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

/** Class names that appear in selectors (never inside declaration values). */
function definedClasses() {
  const defs = new Map()
  for (const file of walk(stylesDir, ['.css'])) {
    const css = stripComments(fs.readFileSync(file, 'utf8'))
    const rel = path.relative(root, file)
    let depth = 0
    let buffer = ''
    const preludes = []
    for (const ch of css) {
      if (ch === '{') { preludes.push(buffer); buffer = ''; depth++ }
      else if (ch === '}') { buffer = ''; depth-- }
      else if (ch === ';') buffer = ''
      else buffer += ch
    }
    for (const prelude of preludes) {
      if (/^\s*@(font-face|keyframes|import)/.test(prelude)) continue
      if (/^\s*(from|to|\d+%)/.test(prelude)) continue
      // Drop attribute selector bodies like [data-x='a.b'].
      const selector = prelude.replace(/\[[^\]]*\]/g, '')
      for (const m of selector.matchAll(/\.(-?[a-zA-Z_][\w-]*)/g)) {
        if (!defs.has(m[1])) defs.set(m[1], new Set())
        defs.get(m[1]).add(rel)
      }
    }
  }
  return defs
}

const { uses, dynamicPrefixes } = usedClasses()
const defs = definedClasses()

const undefinedUses = [...uses.entries()]
  .filter(([cls]) => !defs.has(cls) && !UNSTYLED_ALLOWLIST.has(cls))
  .map(([cls, where]) => `${cls}  (${[...where].slice(0, 3).join(', ')})`)
const deadDefs = [...defs.entries()]
  .filter(([cls]) =>
    !uses.has(cls) &&
    ![...dynamicPrefixes].some((prefix) => cls.startsWith(prefix)))
  .map(([cls, files]) => `${cls}  (${[...files].join(', ')})`)
if (process.env.SHELF_CSS_REPORT) console.log({ undefinedUses, deadDefs, dynamicPrefixes })

assert.deepEqual(undefinedUses, [], `Classes used in src but defined by no stylesheet in src/styles:\n${undefinedUses.join('\n')}`)
console.log(`OK: ${uses.size} classes used in components are all defined in src/styles`)

assert.deepEqual(deadDefs, [], `Stylesheet classes no component uses:\n${deadDefs.join('\n')}`)
console.log(`OK: ${defs.size} stylesheet classes are all referenced by components`)

// Self-test: the historical bug must be caught by the extractor.
{
  const sample = 'const x = <input className="input" />; const y = <p className={`a ${on ? \'b-on\' : \'\'}`} />; const z = <i className={s === \'running\' ? \'c\' : \'d\'} />'
  const found = new Set()
  for (const m of sample.matchAll(/className\s*=\s*/g)) {
    const at = m.index + m[0].length
    const ch = sample[at]
    const values = ch === '{' ? stringsIn(readBraced(sample, at).slice(1, -1)) : [sample.slice(at + 1, sample.indexOf(ch, at + 1))]
    for (const v of values) for (const cls of classTokens(v)) found.add(cls)
  }
  assert.deepEqual([...found].sort(), ['a', 'b-on', 'c', 'd', 'input'])
  console.log('OK: extractor finds literal, template, and conditional classes and ignores comparisons')
}

// ---------------------------------------------------------------------------
// WCAG AA contrast for token pairs, per theme.
// ---------------------------------------------------------------------------

function parseThemes() {
  const css = stripComments(fs.readFileSync(path.join(stylesDir, 'tokens.css'), 'utf8'))
  const themes = { dark: {}, light: {} }
  for (const block of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = block[1]
    const target = /data-theme='light'/.test(selector) ? 'light' : /:root|data-theme='dark'/.test(selector) ? 'dark' : null
    if (!target) continue
    for (const decl of block[2].matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) themes[target][decl[1]] = decl[2].trim()
  }
  // Light inherits anything it does not override.
  themes.light = { ...themes.dark, ...themes.light }
  return themes
}

function hexToRgba(hex) {
  const h = hex.replace('#', '')
  const full = h.length === 3 || h.length === 4 ? h.split('').map((c) => c + c).join('') : h
  const n = (i) => parseInt(full.slice(i, i + 2), 16)
  return [n(0), n(2), n(4), full.length === 8 ? n(6) / 255 : 1]
}

function resolveColor(value, theme, depth = 0) {
  if (depth > 8) throw new Error(`Token cycle at ${value}`)
  const v = value.trim()
  const ref = v.match(/^var\(--([\w-]+)\)$/)
  if (ref) return resolveColor(theme[ref[1]], theme, depth + 1)
  if (v.startsWith('#')) return hexToRgba(v)
  const rgb = v.match(/^rgb\(\s*(\d+)\s+(\d+)\s+(\d+)(?:\s*\/\s*([\d.]+)(%?))?\s*\)$/)
  if (rgb) {
    const alpha = rgb[4] === undefined ? 1 : rgb[5] ? Number(rgb[4]) / 100 : Number(rgb[4])
    return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3]), alpha]
  }
  throw new Error(`Unsupported color: ${value}`)
}

function over([r, g, b, a], [br, bg, bb]) {
  return [r * a + br * (1 - a), g * a + bg * (1 - a), b * a + bb * (1 - a)]
}

function luminance(rgb) {
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(fg, bg) {
  const a = luminance(fg)
  const b = luminance(bg)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

const themes = parseThemes()
const failures = []
const report = []
/**
 * [label, foreground token, background token, tint token or null, minimum].
 * Text needs 4.5:1; form-control boundaries need 3:1 (WCAG 1.4.11).
 */
const PAIRS = [
  ['ink on panel', 'ink', 'panel', null, 4.5],
  ['muted on panel', 'muted', 'panel', null, 4.5],
  ['muted on surface', 'muted', 'surface', null, 4.5],
  ['subtle on panel', 'subtle', 'panel', null, 4.5],
  ['subtle on panel-raised', 'subtle', 'panel-raised', null, 4.5],
  ['subtle on surface', 'subtle', 'surface', null, 4.5],
  ['brand-strong link on panel', 'brand-strong', 'panel', null, 4.5],
  ['on-brand text on brand button', 'on-brand', 'brand', null, 4.5],
  ['success on panel', 'success', 'panel', null, 4.5],
  ['warning on panel', 'warning', 'panel', null, 4.5],
  ['danger on panel', 'danger', 'panel', null, 4.5],
  ['Running pill', 'success', 'panel', 'tint-success', 4.5],
  ['Starting pill', 'warning', 'panel', 'tint-warning', 4.5],
  ['Error pill', 'danger', 'panel', 'tint-danger', 4.5],
  ['Stopped pill', 'pill-neutral', 'panel', 'tint-neutral', 4.5],
  ['Stopped pill on raised card', 'pill-neutral', 'panel-raised', 'tint-neutral', 4.5],
  ['btn-danger text', 'danger', 'panel-raised', 'tint-danger', 4.5],
  ['warning-card text', 'ink', 'panel', 'tint-warning', 4.5],
  ['input border on input', 'line-strong', 'input', null, 3],
  ['input border on panel', 'line-strong', 'panel', null, 3],
  ['input border on surface', 'line-strong', 'surface', null, 3],
]
for (const [name, theme] of Object.entries(themes)) {
  for (const [label, fgToken, bgToken, tintToken, min] of PAIRS) {
    if (!theme[fgToken] || !theme[bgToken] || (tintToken && !theme[tintToken])) {
      failures.push(`${name}: ${label} is missing a token (${fgToken}/${bgToken}/${tintToken ?? '-'})`)
      continue
    }
    let bg = over(resolveColor(theme[bgToken], theme), [0, 0, 0])
    if (tintToken) bg = over(resolveColor(theme[tintToken], theme), bg)
    const fg = over(resolveColor(theme[fgToken], theme), bg)
    const ratio = contrast(fg, bg)
    report.push(`${name.padEnd(5)} ${label.padEnd(32)} ${ratio.toFixed(2)}`)
    if (ratio < min) failures.push(`${name}: ${label} is ${ratio.toFixed(2)}:1, needs ${min}:1`)
  }
}
if (process.env.SHELF_CONTRAST_REPORT) console.log(report.join('\n'))
assert.deepEqual(failures, [], failures.join('\n'))
console.log(`OK: ${report.length} theme token pairs meet WCAG AA (text 4.5:1, control boundaries 3:1)`)
