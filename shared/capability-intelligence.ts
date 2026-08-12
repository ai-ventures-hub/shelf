import fs from 'node:fs'
import {
  maskSecrets,
  type AgentAccess,
  type AgentAccessKind,
  type AgentAccessSummary,
  type CapabilityMatch,
  type Tool,
  type ToolReadiness,
} from './types'

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'can', 'could', 'do', 'for', 'from', 'have', 'i', 'in', 'is',
  'it', 'me', 'my', 'need', 'of', 'on', 'please', 'the', 'this', 'to', 'tool',
  'use', 'want', 'with', 'would',
])

// Prefixed keys (AWS_SECRET, MY_API_KEY) must match too — keep this shape in
// sync with maskSecrets in shared/types.ts, or refusal ends up narrower than
// the masking it is meant to precede.
const SECRET_ASSIGNMENT = /\b[A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_KEY|ACCESS_KEY)[A-Z0-9_]*\s*=\s*(?!\*{3}|\$\{?[A-Z0-9_]+\}?)([^\s]+)/i
const BEARER_SECRET = /\bBearer\s+[A-Za-z0-9._~+\/-]{8,}/i

export function normalizeCapabilities(values: string[] | undefined): string[] {
  const seen = new Set<string>()
  const normalized: string[] = []
  for (const value of values || []) {
    const clean = value.trim().replace(/\s+/g, ' ')
    const key = clean.toLowerCase()
    if (!clean || seen.has(key)) continue
    seen.add(key)
    normalized.push(clean)
  }
  return normalized
}

export function normalizeAgentAccess(values: AgentAccess[] | undefined): AgentAccess[] {
  const seen = new Set<string>()
  return (values || []).map((value) => {
    const entrypoint = value.entrypoint?.trim() || ''
    const notes = value.notes?.trim() || undefined
    if (!entrypoint) throw new Error(`${accessLabel(value.kind)} entrypoint is required.`)
    if (containsLikelySecret(entrypoint) || (notes && containsLikelySecret(notes))) {
      throw new Error('Agent access metadata cannot contain credentials or secret values.')
    }
    if (value.kind === 'mcp' && !value.transport) {
      throw new Error('MCP access requires a transport.')
    }
    if (
      (value.kind === 'http-api' || value.transport === 'streamable-http') &&
      !isSafeHttpEndpoint(entrypoint)
    ) {
      throw new Error('HTTP access requires an http(s) endpoint without embedded credentials.')
    }
    const key = `${value.kind}:${value.transport || ''}:${entrypoint.toLowerCase()}`
    if (seen.has(key)) throw new Error(`Duplicate ${accessLabel(value.kind)} access entry.`)
    seen.add(key)
    return {
      id: value.id,
      kind: value.kind,
      entrypoint,
      transport: value.kind === 'mcp' ? value.transport : undefined,
      setupRequired: Boolean(value.setupRequired),
      notes,
    }
  })
}

/** MCP tools that work for every registered tool, whatever its readiness. */
const SHELF_ACTIONS = [
  'shelf_launch_tool',
  'shelf_stop_tool',
  'shelf_get_status',
  'shelf_get_logs',
]

export function deriveToolReadiness(tool: Tool): ToolReadiness {
  const projectMissing = Boolean(tool.projectPath && !fs.existsSync(tool.projectPath))
  const launchable = Boolean(tool.launchCommand?.trim()) && !projectMissing
  const base = { launchable, shelfActions: SHELF_ACTIONS }

  if (projectMissing) {
    return {
      ...base,
      state: 'unavailable',
      childInterface: tool.agentAccess.length > 0 ? 'declared' : 'none',
      summary: 'Project folder is unavailable.',
      reasons: [`Project folder not found: ${tool.projectPath}`],
    }
  }

  if (tool.agentAccess.length === 0) {
    return {
      ...base,
      state: 'manual_only',
      childInterface: 'none',
      summary:
        'Agents can launch and stop this tool through Shelf (shelf_launch_tool / shelf_stop_tool). No child interface is declared — once running, the tool is used through its own UI rather than driven directly by agents.',
      reasons: [
        'Launching via shelf_launch_tool is always available for every registered tool.',
        'No CLI, MCP, or HTTP API interface is declared for connecting to the tool itself. Add agentAccess if the tool exposes one.',
      ],
    }
  }

  const invalid = tool.agentAccess.find((access) => !isAccessComplete(access))
  if (invalid) {
    return {
      ...base,
      state: 'unavailable',
      childInterface: 'incomplete',
      summary: `${accessLabel(invalid.kind)} access metadata is incomplete.`,
      reasons: [`${accessLabel(invalid.kind)} requires a valid entrypoint${invalid.kind === 'mcp' ? ' and transport' : ''}.`],
    }
  }

  const ready = tool.agentAccess.filter((access) => !access.setupRequired)
  if (ready.length > 0) {
    return {
      ...base,
      state: 'ready',
      childInterface: 'declared',
      summary: `Declared ready through ${ready.map((access) => accessLabel(access.kind)).join(', ')}. Connect to the tool yourself using the declared entrypoint(s); Shelf records but never invokes them.`,
      reasons: ready.map((access) => `${accessLabel(access.kind)} is declared ready.`),
    }
  }

  return {
    ...base,
    state: 'needs_setup',
    childInterface: 'needs_setup',
    summary: 'Agent access is declared but still needs setup.',
    reasons: tool.agentAccess.map(
      (access) => `${accessLabel(access.kind)} is marked setup required.`,
    ),
  }
}

/** Sanitized access list for agent-facing responses. */
export function summarizeAgentAccess(tool: Tool): AgentAccessSummary[] {
  return tool.agentAccess.map((access) => ({
    kind: access.kind,
    transport: access.transport,
    entrypoint: maskSecrets(access.entrypoint),
    setupRequired: access.setupRequired,
  }))
}

export function findCapabilityMatches(
  tools: Tool[],
  task: string,
  opts: { accessKind?: AgentAccessKind; limit?: number } = {},
): CapabilityMatch[] {
  const query = normalizeText(task)
  const queryTokens = significantTokens(task)
  if (!query || queryTokens.length === 0) return []

  const matches: CapabilityMatch[] = []
  for (const tool of tools) {
    if (opts.accessKind && !tool.agentAccess.some((access) => access.kind === opts.accessKind)) {
      continue
    }
    const ranked = scoreTool(tool, query, queryTokens)
    if (!ranked || ranked.score < 120) continue
    const readiness = deriveToolReadiness(tool)
    matches.push({
      toolId: tool.id,
      name: tool.name,
      capabilities: tool.capabilities,
      accessKinds: Array.from(new Set(tool.agentAccess.map((access) => access.kind))),
      readiness,
      access: summarizeAgentAccess(tool),
      score: ranked.score,
      reasons: ranked.reasons,
      // 'manual_use' is deprecated: a manual_only tool is still launchable, so
      // the suggested action is launch — `interaction` carries the GUI nuance.
      suggestedAction:
        readiness.state === 'needs_setup' || readiness.state === 'unavailable'
          ? 'configure'
          : 'launch',
      interaction: readiness.state === 'manual_only' ? 'human_ui' : 'agent_direct',
    })
  }

  matches.sort(
    (a, b) =>
      b.score - a.score ||
      Number(Boolean(tools.find((tool) => tool.id === b.toolId)?.favorite)) -
        Number(Boolean(tools.find((tool) => tool.id === a.toolId)?.favorite)) ||
      launchedAt(tools, b.toolId) - launchedAt(tools, a.toolId) ||
      a.name.localeCompare(b.name),
  )
  return matches.slice(0, Math.max(1, Math.min(opts.limit ?? 5, 10)))
}

export function containsLikelySecret(value: string): boolean {
  if (SECRET_ASSIGNMENT.test(value) || BEARER_SECRET.test(value)) return true
  try {
    const parsed = new URL(value)
    if (parsed.username || parsed.password) return true
    for (const key of parsed.searchParams.keys()) {
      if (/TOKEN|SECRET|PASSWORD|API_KEY|ACCESS_KEY/i.test(key)) return true
    }
  } catch {
    // Commands and notes are not expected to be URLs.
  }
  return false
}

function scoreTool(
  tool: Tool,
  query: string,
  queryTokens: string[],
): { score: number; reasons: string[] } | null {
  let score = 0
  const reasons: string[] = []

  for (const capability of tool.capabilities) {
    const normalized = normalizeText(capability)
    const coverage = tokenCoverage(queryTokens, significantTokens(capability))
    if (normalized === query) {
      score = Math.max(score, 1000)
      reasons.push(`Exact capability: ${capability}`)
    } else if (query.includes(normalized) || normalized.includes(query)) {
      score = Math.max(score, 850)
      reasons.push(`Capability phrase: ${capability}`)
    } else if (coverage > 0) {
      const capabilityScore = 250 + Math.round(coverage * 450)
      score = Math.max(score, capabilityScore)
      reasons.push(`Capability match: ${capability}`)
    }
  }

  const fields: Array<[string, string | undefined, number]> = [
    ['Tool name', tool.name, 420],
    ['Description', tool.description, 300],
    ['Tags', tool.tags.join(' '), 240],
    ['Operating notes', tool.notes, 160],
  ]
  for (const [label, value, weight] of fields) {
    if (!value) continue
    const normalized = normalizeText(value)
    const coverage = tokenCoverage(queryTokens, significantTokens(value))
    if (normalized === query) {
      score += weight
      reasons.push(`${label} exactly matches.`)
    } else if (coverage > 0) {
      score += Math.round(weight * coverage)
      reasons.push(`${label} shares relevant terms.`)
    }
  }

  return score > 0 ? { score, reasons: Array.from(new Set(reasons)).slice(0, 4) } : null
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ')
}

function significantTokens(value: string): string[] {
  return Array.from(
    new Set(normalizeText(value).split(' ').filter((token) => token.length > 1 && !STOP_WORDS.has(token))),
  )
}

function tokenCoverage(queryTokens: string[], fieldTokens: string[]): number {
  if (queryTokens.length === 0 || fieldTokens.length === 0) return 0
  const fields = new Set(fieldTokens)
  const matched = queryTokens.filter((token) => fields.has(token)).length
  return matched / queryTokens.length
}

function isAccessComplete(access: AgentAccess): boolean {
  if (!access.entrypoint.trim()) return false
  if (access.kind === 'mcp' && !access.transport) return false
  if (access.kind === 'http-api' || access.transport === 'streamable-http') {
    return isSafeHttpEndpoint(access.entrypoint)
  }
  return true
}

function isSafeHttpEndpoint(value: string): boolean {
  try {
    const parsed = new URL(value)
    return (
      (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      !parsed.username &&
      !parsed.password
    )
  } catch {
    return false
  }
}

function accessLabel(kind: AgentAccessKind): string {
  if (kind === 'http-api') return 'HTTP API'
  return kind === 'mcp' ? 'MCP' : 'CLI'
}

function launchedAt(tools: Tool[], id: string): number {
  const value = tools.find((tool) => tool.id === id)?.lastLaunchedAt
  const parsed = value ? Date.parse(value) : 0
  return Number.isFinite(parsed) ? parsed : 0
}
