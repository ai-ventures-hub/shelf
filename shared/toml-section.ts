/**
 * Surgical TOML table helpers for Codex MCP config.
 * Avoids full parse/re-serialize so unrelated tables (and secrets) keep their formatting.
 */

/** Escape a value as a TOML basic string. */
export function tomlBasicString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

export function tomlStringArray(values: string[]): string {
  return `[${values.map(tomlBasicString).join(', ')}]`
}

/** True when `header` is `name` or a dotted subtable under `name`. */
export function isTableOrChild(header: string, name: string): boolean {
  return header === name || header.startsWith(`${name}.`)
}

/**
 * Remove a table and all of its dotted children (e.g. mcp_servers.shelf + .env).
 * Leaves every other line untouched.
 */
export function removeTomlTables(toml: string, tableName: string): string {
  const lines = toml.split(/\r?\n/)
  const out: string[] = []
  let skipping = false
  for (const line of lines) {
    const match = line.match(/^\[([^\]]+)\]\s*$/)
    if (match) {
      skipping = isTableOrChild(match[1].trim(), tableName)
      if (skipping) continue
    }
    if (!skipping) out.push(line)
  }
  while (out.length > 0 && out[out.length - 1] === '') out.pop()
  return out.join('\n')
}

/** Append (or replace) a top-level table body. */
export function upsertTomlTable(
  toml: string,
  tableName: string,
  bodyLines: string[],
): string {
  const base = removeTomlTables(toml || '', tableName)
  const block = [`[${tableName}]`, ...bodyLines, ''].join('\n')
  if (!base.trim()) return block
  return `${base}\n\n${block}`
}

/** Return lines inside `[tableName]` until the next `[…]` header (exclusive). */
export function readTomlTableLines(toml: string, tableName: string): string[] | null {
  const lines = toml.split(/\r?\n/)
  let collecting = false
  const body: string[] = []
  for (const line of lines) {
    const match = line.match(/^\[([^\]]+)\]\s*$/)
    if (match) {
      const header = match[1].trim()
      if (collecting) break
      collecting = header === tableName
      continue
    }
    if (collecting) body.push(line)
  }
  return collecting || body.length ? body : null
}

/** Parse a TOML basic/literal string (quoted). */
export function parseTomlQuotedString(raw: string): string | undefined {
  const trimmed = raw.trim()
  const basic = trimmed.match(/^"(.*)"$/s)
  if (basic) {
    return basic[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\')
  }
  const literal = trimmed.match(/^'(.*)'$/s)
  if (literal) return literal[1]
  return undefined
}

/** Read `key = "…"` from table body lines. */
export function readTomlStringKey(lines: string[], key: string): string | undefined {
  const re = new RegExp(`^\\s*${key}\\s*=\\s*(.+?)\\s*$`)
  for (const line of lines) {
    const m = line.match(re)
    if (!m) continue
    const quoted = parseTomlQuotedString(m[1])
    if (quoted != null) return quoted
  }
  return undefined
}

/** Read `key = ["a", "b"]` from table body lines. */
export function readTomlStringArrayKey(lines: string[], key: string): string[] | undefined {
  const re = new RegExp(`^\\s*${key}\\s*=\\s*\\[(.*)\\]\\s*$`)
  for (const line of lines) {
    const m = line.match(re)
    if (!m) continue
    const inner = m[1].trim()
    if (!inner) return []
    const values: string[] = []
    // Split on commas that sit outside quotes (stdio MCP args are simple paths).
    const parts = inner.split(',').map((p) => p.trim()).filter(Boolean)
    for (const part of parts) {
      const v = parseTomlQuotedString(part)
      if (v == null) return undefined
      values.push(v)
    }
    return values
  }
  return undefined
}
