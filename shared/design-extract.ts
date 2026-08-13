/**
 * Deterministic design-token extraction from a project folder (Design Engine
 * Phase 3: "extract tokens from this project"). Parses what the project
 * literally declares — CSS custom properties and Tailwind config literals —
 * into DTCG groups matching the profile vocabulary (color / typography /
 * dimension). NO inference: anything that isn't a literal declaration is
 * skipped and reported, never guessed (see docs/DESIGN-ENGINE.md non-goals).
 *
 * Mode mapping: declarations inside `@media (prefers-color-scheme: dark)` or
 * under `.dark` / `[data-theme="dark"]`-style selectors land in modes.dark
 * (same for light); `:root`/`html`/`body`/`@theme` declarations are base.
 * Component-scoped custom properties are skipped — a profile is a brand
 * summary, not a stylesheet mirror.
 */
import fs from 'node:fs'
import path from 'node:path'
import type { DesignToken, DesignTokenGroup } from './types'

export interface ExtractedTokens {
  tokens: DesignTokenGroup
  modes: { light: DesignTokenGroup; dark: DesignTokenGroup }
  /** Leaf counts, for the GUI summary. */
  counts: { color: number; typography: number; dimension: number; light: number; dark: number }
  /** Relative file paths that contributed declarations, in scan order. */
  sources: Array<{ file: string; declarations: number }>
  /** Human-readable notes on what was deliberately not extracted. */
  skipped: string[]
}

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'dist-electron',
  'dist-mcp',
  'dist-shared',
  'build',
  'out',
  'coverage',
  'vendor',
  '.next',
  '.nuxt',
  '.output',
  '.svelte-kit',
  'release',
])
const MAX_DEPTH = 6
const MAX_CSS_FILES = 60
const MAX_FILE_BYTES = 512 * 1024

type Mode = 'base' | 'light' | 'dark'

interface Declaration {
  name: string
  value: string
  mode: Mode
}

/** Extract literal design tokens from a project directory. */
export function extractProjectTokens(projectPath: string): ExtractedTokens {
  const root = path.resolve(projectPath)
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    throw new Error(`Not a folder: ${projectPath}`)
  }

  const skipped: string[] = []
  const sources: Array<{ file: string; declarations: number }> = []

  // Later files/declarations override earlier ones (cascade-like); the sorted
  // walk keeps the outcome identical run to run.
  const maps: Record<Mode, Map<string, string>> = {
    base: new Map(),
    light: new Map(),
    dark: new Map(),
  }

  for (const file of findCssFiles(root)) {
    const relPath = path.relative(root, file)
    let text: string
    try {
      if (fs.statSync(file).size > MAX_FILE_BYTES) {
        skipped.push(`${relPath}: larger than ${MAX_FILE_BYTES / 1024}KB, not scanned`)
        continue
      }
      text = fs.readFileSync(file, 'utf8')
    } catch {
      continue
    }
    const { declarations, scopedCount } = parseCssCustomProperties(text)
    if (declarations.length > 0) {
      sources.push({ file: relPath, declarations: declarations.length })
      for (const decl of declarations) maps[decl.mode].set(decl.name, decl.value)
    }
    if (scopedCount > 0) {
      skipped.push(`${relPath}: ${scopedCount} component-scoped custom propert${scopedCount === 1 ? 'y' : 'ies'}`)
    }
  }

  const tailwind = extractTailwindConfig(root)
  if (tailwind) {
    sources.push({ file: tailwind.file, declarations: tailwind.declarations.length })
    for (const decl of tailwind.declarations) {
      // Tailwind literals never win over an explicit CSS custom property.
      if (!maps.base.has(decl.name)) maps.base.set(decl.name, decl.value)
    }
    skipped.push(...tailwind.skipped)
  }

  resolveVarReferences(maps)

  const tokens: DesignTokenGroup = {}
  const modes = { light: {} as DesignTokenGroup, dark: {} as DesignTokenGroup }
  const counts = { color: 0, typography: 0, dimension: 0, light: 0, dark: 0 }
  let unclassified = 0

  for (const [name, value] of maps.base) {
    const placed = placeToken(tokens, name, value)
    if (!placed) unclassified += 1
    else counts[placed] += 1
  }
  for (const mode of ['light', 'dark'] as const) {
    for (const [name, value] of maps[mode]) {
      if (placeToken(modes[mode], name, value)) counts[mode] += 1
      else unclassified += 1
    }
  }
  if (unclassified > 0) {
    skipped.push(
      `${unclassified} custom propert${unclassified === 1 ? 'y' : 'ies'} with non-token values (gradients, transitions, url(), …)`,
    )
  }

  return { tokens, modes, counts, sources, skipped }
}

// ---------------------------------------------------------------------------
// File discovery

function findCssFiles(root: string): string[] {
  const found: string[] = []
  const walk = (dir: string, depth: number) => {
    if (depth > MAX_DEPTH || found.length >= MAX_CSS_FILES) return
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    entries.sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      if (found.length >= MAX_CSS_FILES) return
      if (entry.name.startsWith('.') && entry.name !== '.') continue
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(path.join(dir, entry.name), depth + 1)
      } else if (/\.(css|scss)$/.test(entry.name)) {
        found.push(path.join(dir, entry.name))
      }
    }
  }
  walk(root, 0)
  return found
}

// ---------------------------------------------------------------------------
// CSS custom-property parsing

const DARK_SCOPE = /\.dark\b|\[data-theme\s*[*^|~]?=\s*["']?dark|\bdark-theme\b/i
const LIGHT_SCOPE = /\.light\b|\[data-theme\s*[*^|~]?=\s*["']?light|\blight-theme\b/i
const GLOBAL_SELECTOR = /(^|[\s,>~+])(:root\b|html\b|body\b|\*)/

function parseCssCustomProperties(cssText: string): {
  declarations: Declaration[]
  scopedCount: number
} {
  const text = cssText.replace(/\/\*[\s\S]*?\*\//g, ' ')
  const declarations: Declaration[] = []
  let scopedCount = 0

  // Context stack of selector/at-rule preludes, maintained by brace scanning.
  const stack: string[] = []
  let prelude = ''
  let i = 0
  while (i < text.length) {
    const ch = text[i]
    if (ch === '{') {
      stack.push(prelude.trim())
      prelude = ''
      i += 1
    } else if (ch === '}') {
      stack.pop()
      prelude = ''
      i += 1
    } else if (ch === ';') {
      const decl = prelude.trim()
      prelude = ''
      i += 1
      const match = /^--([A-Za-z0-9_-]+)\s*:\s*([\s\S]+)$/.exec(decl)
      if (!match || stack.length === 0) continue
      const scope = classifyScope(stack)
      if (scope === null) scopedCount += 1
      else {
        declarations.push({
          name: match[1].toLowerCase(),
          // Multi-line declarations keep their source newlines — collapse.
          value: match[2].replace(/\s+/g, ' ').trim(),
          mode: scope,
        })
      }
    } else if (ch === '"' || ch === "'") {
      // Consume strings whole so braces/semicolons inside them don't confuse
      // the scanner.
      const quote = ch
      let j = i + 1
      while (j < text.length && text[j] !== quote) {
        if (text[j] === '\\') j += 1
        j += 1
      }
      prelude += text.slice(i, j + 1)
      i = j + 1
    } else {
      prelude += ch
      i += 1
    }
  }
  return { declarations, scopedCount }
}

/**
 * Where does a declaration in this block context belong?
 * null = component-scoped (skip). Media conditions apply from any level;
 * the innermost selector decides eligibility.
 */
function classifyScope(stack: string[]): Mode | null {
  let mode: Mode = 'base'
  for (const entry of stack) {
    if (/@media/i.test(entry)) {
      if (/prefers-color-scheme\s*:\s*dark/i.test(entry)) mode = 'dark'
      else if (/prefers-color-scheme\s*:\s*light/i.test(entry)) mode = 'light'
    }
  }
  const selector = stack[stack.length - 1]
  if (/@theme\b/i.test(selector)) return mode // Tailwind v4 CSS-first config
  if (/^@/.test(selector)) return null
  if (DARK_SCOPE.test(selector)) return 'dark'
  if (LIGHT_SCOPE.test(selector)) return 'light'
  if (GLOBAL_SELECTOR.test(` ${selector}`)) return mode
  return null
}

// ---------------------------------------------------------------------------
// var() resolution (bounded, no inference — unresolved references stay as-is)

function resolveVarReferences(maps: Record<Mode, Map<string, string>>): void {
  const VAR_REF = /var\(\s*--([A-Za-z0-9_-]+)\s*(?:,\s*([^()]+?)\s*)?\)/g
  for (const mode of ['base', 'light', 'dark'] as const) {
    for (let pass = 0; pass < 4; pass++) {
      let changed = false
      for (const [name, value] of maps[mode]) {
        if (!value.includes('var(')) continue
        const next = value.replace(VAR_REF, (whole, ref: string, fallback?: string) => {
          const resolved = maps[mode].get(ref) ?? maps.base.get(ref) ?? fallback
          return resolved !== undefined && !resolved.includes('var(') ? resolved : whole
        })
        if (next !== value) {
          maps[mode].set(name, next)
          changed = true
        }
      }
      if (!changed) break
    }
  }
}

// ---------------------------------------------------------------------------
// Classification into the profile vocabulary

const COLOR_VALUE = /^(#[0-9a-f]{3,8}|(rgb|rgba|hsl|hsla|oklch|oklab|lab|lch|color)\(.+\))$/i
const DIMENSION_VALUE = /^-?\d*\.?\d+(px|rem|em|vw|vh|pt|%)$/
const NUMBER_VALUE = /^-?\d*\.?\d+$/

function token(value: string | number, type: string): DesignToken {
  return { $value: value, $type: type }
}

function setLeaf(group: DesignTokenGroup, groupPath: string[], name: string, leaf: DesignToken): void {
  let node: DesignTokenGroup = group
  for (const key of groupPath) {
    const child = node[key]
    if (!child || typeof child !== 'object' || '$value' in child) node[key] = {}
    node = node[key] as DesignTokenGroup
  }
  node[name] = leaf
}

/**
 * Deterministically place one custom property into the DTCG groups the
 * profile editor and briefs understand. Returns the counted category, or
 * null when the value isn't a token-shaped literal.
 */
function placeToken(
  group: DesignTokenGroup,
  rawName: string,
  rawValue: string,
): 'color' | 'typography' | 'dimension' | null {
  const value = rawValue.replace(/\s*!important\s*$/i, '').trim()
  const name = rawName.replace(/^(color|clr)-/, '')

  if (COLOR_VALUE.test(value)) {
    setLeaf(group, ['color'], name, token(value, 'color'))
    return 'color'
  }
  const fontishName =
    /(^|-)font-family(-|$)/.test(rawName) ||
    (/(^|-)font(-|$)/.test(rawName) &&
      !/(^|-)(size|weight|style|stretch|smoothing)(-|$)/.test(rawName))
  // The comma keeps single-keyword values (antialiased, inherit) out —
  // real family stacks list fallbacks.
  if (fontishName && value.includes(',') && /[A-Za-z]/.test(value) && !COLOR_VALUE.test(value)) {
    const rest = rawName.replace(/^.*?font(-family)?-?/, '') || 'app'
    setLeaf(group, ['typography', 'font-family'], rest, token(value, 'fontFamily'))
    return 'typography'
  }
  if (/(^|-)font-?weight(-|$)/.test(rawName) && NUMBER_VALUE.test(value)) {
    const rest = rawName.replace(/^.*font-?weight-?/, '') || 'regular'
    setLeaf(group, ['typography', 'font-weight'], rest, token(Number(value), 'fontWeight'))
    return 'typography'
  }
  if (/(^|-)font-?size(-|$)/.test(rawName) && DIMENSION_VALUE.test(value)) {
    const rest = rawName.replace(/^.*font-?size-?/, '') || 'body'
    setLeaf(group, ['typography', 'font-size'], rest, token(value, 'dimension'))
    return 'typography'
  }
  if (/(^|-)line-?height(-|$)/.test(rawName) && (NUMBER_VALUE.test(value) || DIMENSION_VALUE.test(value))) {
    const rest = rawName.replace(/^.*line-?height-?/, '') || 'body'
    setLeaf(
      group,
      ['typography', 'line-height'],
      rest,
      token(NUMBER_VALUE.test(value) ? Number(value) : value, 'number'),
    )
    return 'typography'
  }
  if (DIMENSION_VALUE.test(value)) {
    setLeaf(group, ['dimension'], name, token(value, 'dimension'))
    return 'dimension'
  }
  return null
}

// ---------------------------------------------------------------------------
// Tailwind config: static parsing of literal theme values. Never executed —
// non-literal entries (functions, spreads, requires) are skipped by name.

interface TailwindExtraction {
  file: string
  declarations: Declaration[]
  skipped: string[]
}

function extractTailwindConfig(root: string): TailwindExtraction | null {
  const candidates = ['tailwind.config.js', 'tailwind.config.cjs', 'tailwind.config.mjs', 'tailwind.config.ts']
  const file = candidates.find((name) => fs.existsSync(path.join(root, name)))
  if (!file) return null
  let text: string
  try {
    text = fs.readFileSync(path.join(root, file), 'utf8')
  } catch {
    return null
  }
  text = text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

  const declarations: Declaration[] = []
  const skipped: string[] = []

  const themeObject = findObjectAfterKey(text, 'theme')
  if (!themeObject) return { file, declarations, skipped }
  const scopes = [themeObject]
  const extendObject = findObjectAfterKey(themeObject, 'extend')
  if (extendObject) scopes.push(extendObject)

  for (const scope of scopes) {
    const colors = findObjectAfterKey(scope, 'colors')
    if (colors) {
      collectLiteralStrings(colors, [], (keyPath, value, literal) => {
        if (!literal) {
          skipped.push(`${file}: colors.${keyPath.join('.')} is not a literal — skipped`)
          return
        }
        const name = keyPath
          .filter((key) => key !== 'DEFAULT')
          .join('-')
          .toLowerCase()
        if (name) declarations.push({ name, value, mode: 'base' })
      })
    }
    const fontFamily = findObjectAfterKey(scope, 'fontFamily')
    if (fontFamily) {
      for (const [key, arr] of parseStringArrayEntries(fontFamily)) {
        declarations.push({ name: `font-family-${key.toLowerCase()}`, value: arr.join(', '), mode: 'base' })
      }
    }
  }
  return { file, declarations, skipped }
}

/** Balanced `{…}` (string-aware) following `<key>\s*:` — or null. */
function findObjectAfterKey(text: string, key: string): string | null {
  const keyRe = new RegExp(`(^|[,{\\s"'])${key}["']?\\s*:\\s*\\{`)
  const match = keyRe.exec(text)
  if (!match) return null
  const start = match.index + match[0].length - 1
  let depth = 0
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (ch === '"' || ch === "'" || ch === '`') {
      i += 1
      while (i < text.length && text[i] !== ch) {
        if (text[i] === '\\') i += 1
        i += 1
      }
    } else if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}

/**
 * Walk `key: 'literal'` and nested-object entries of an object-literal
 * source string. Non-literal values invoke the callback with literal=false.
 */
function collectLiteralStrings(
  objectSource: string,
  prefix: string[],
  visit: (keyPath: string[], value: string, literal: boolean) => void,
): void {
  for (const [key, rawValue] of parseObjectEntries(objectSource)) {
    const stringLit = /^["']([^"']*)["']$/.exec(rawValue.trim())
    if (stringLit) visit([...prefix, key], stringLit[1], true)
    else if (rawValue.trim().startsWith('{')) {
      collectLiteralStrings(rawValue.trim(), [...prefix, key], visit)
    } else {
      visit([...prefix, key], '', false)
    }
  }
}

/** `fontFamily`-style entries whose value is an array of string literals. */
function parseStringArrayEntries(objectSource: string): Array<[string, string[]]> {
  const out: Array<[string, string[]]> = []
  for (const [key, rawValue] of parseObjectEntries(objectSource)) {
    const trimmed = rawValue.trim()
    if (!trimmed.startsWith('[')) continue
    const items = [...trimmed.matchAll(/["']([^"']+)["']/g)].map((m) => m[1])
    if (items.length > 0) out.push([key, items])
  }
  return out
}

/** Top-level `key: value` pairs of a `{…}` source string, string-aware. */
function parseObjectEntries(objectSource: string): Array<[string, string]> {
  const inner = objectSource.trim().replace(/^\{/, '').replace(/\}$/, '')
  const entries: Array<[string, string]> = []
  let depth = 0
  let current = ''
  const parts: string[] = []
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i]
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch
      current += ch
      i += 1
      while (i < inner.length && inner[i] !== quote) {
        if (inner[i] === '\\') {
          current += inner[i]
          i += 1
        }
        current += inner[i]
        i += 1
      }
      current += inner[i] || ''
    } else if (ch === '{' || ch === '[' || ch === '(') {
      depth += 1
      current += ch
    } else if (ch === '}' || ch === ']' || ch === ')') {
      depth -= 1
      current += ch
    } else if (ch === ',' && depth === 0) {
      parts.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  if (current.trim()) parts.push(current)
  for (const part of parts) {
    const match = /^\s*(?:["']([^"']+)["']|([A-Za-z0-9_$-]+))\s*:\s*([\s\S]+)$/.exec(part)
    if (match) entries.push([match[1] ?? match[2], match[3]])
  }
  return entries
}
