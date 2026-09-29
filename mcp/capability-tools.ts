import { z } from 'zod'
import { agentAccessKindSchema } from '../shared/tool-validation'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CapabilityGapStore } from '../shared/capability-gap-store'
import type { DesignProfileStore } from '../shared/design-profile-store'
import { resolveProfileForGap } from '../shared/design-resolve'
import {
  deriveToolReadiness,
  findCapabilityMatches,
  summarizeAgentAccess,
} from '../shared/capability-intelligence'
import { buildGapBrief } from '../shared/gap-brief'
import type { LibraryStore } from '../shared/library-store'
import type { ProcessManager } from '../shared/process-manager'
import { catalogRepoKey, readTeamCatalogs } from '../shared/team-catalog-store'
import type { AgentAccessKind, CapabilityGap, CapabilityGapStatus, Tool } from '../shared/types'
import {
  LOCAL_WRITE,
  READ_ONLY,
  errorResult,
  textResult,
  toolNotFound,
} from './result'

const TEAM_NOTE = 'The user installs this from Team Tools in Shelf.'

/**
 * Subscribed team-catalog entries the user has not installed, as throwaway
 * Tool shapes so the same ranking applies. Read-only: nothing is fetched,
 * cloned, or installed (agents never install; that is the GUI's consent sheet).
 */
function uninstalledTeamEntries(store: LibraryStore) {
  const installed = new Set(
    store
      .list()
      .map((tool) => tool.source?.repo)
      .filter((repo): repo is string => Boolean(repo))
      .map(catalogRepoKey),
  )
  const entries = new Map<string, { catalog: string; description?: string }>()
  const tools: Tool[] = []
  for (const catalog of readTeamCatalogs(store.getRoot())) {
    catalog.entries.forEach((entry, index) => {
      if (installed.has(catalogRepoKey(entry.repo))) return
      const id = `team:${catalog.id}:${index}`
      entries.set(id, { catalog: catalog.name, description: entry.description })
      tools.push({
        id,
        name: entry.name,
        description: entry.description,
        capabilities: entry.capabilities,
        tags: [],
        agentAccess: [],
        favorite: false,
        launchCommand: '',
        createdAt: '',
        updatedAt: '',
      })
    })
  }
  return { tools, entries }
}

function gapRow(gap: CapabilityGap, includeExamples: boolean) {
  if (includeExamples) return gap
  const { examples, ...rest } = gap
  return { ...rest, exampleCount: examples.length }
}

interface CapabilityToolHost {
  server: McpServer
  store: LibraryStore
  processes: ProcessManager
  gaps: CapabilityGapStore
  profiles: DesignProfileStore
}

/** Register the stable, non-invoking Capability Intelligence MCP surface. */
export function registerCapabilityTools({
  server,
  store,
  processes,
  gaps,
  profiles,
}: CapabilityToolHost): void {
  server.registerTool(
    'shelf_find_capability',
    {
      description:
        'Rank library tools for a task, with reasons, readiness, and declared access entrypoints, plus matching team-catalog tools not installed yet (the user installs those).',
      inputSchema: {
        task: z.string().min(1).describe('Task or capability needed'),
        accessKind: agentAccessKindSchema.optional(),
        limit: z.number().int().positive().max(10).optional(),
      },
      annotations: READ_ONLY,
    },
    async ({ task, accessKind, limit }) => {
      const matches = findCapabilityMatches(store.list(), task, {
        accessKind: accessKind as AgentAccessKind | undefined,
        limit,
      })
      const compact = await Promise.all(
        matches.map(async (match) => ({
          toolId: match.toolId,
          name: match.name,
          capabilities: match.capabilities,
          ...(match.accessKinds.length ? { accessKinds: match.accessKinds } : {}),
          readiness: match.readiness.state,
          ...(match.readiness.launchable ? {} : { launchable: false }),
          ...(match.access.length ? { access: match.access } : {}),
          score: match.score,
          reasons: match.reasons,
          suggestedAction: match.suggestedAction,
          interaction: match.interaction,
          status: (await processes.getState(match.toolId)).status,
        })),
      )
      // Team entries declare no agent access, so an accessKind filter skips them.
      const team = accessKind ? { tools: [], entries: new Map() } : uninstalledTeamEntries(store)
      const teamMatches = findCapabilityMatches(team.tools, task, { limit: 3 }).map((match) => {
        const entry = team.entries.get(match.toolId)
        return {
          name: match.name,
          ...(entry?.description ? { description: entry.description } : {}),
          capabilities: match.capabilities,
          catalog: entry?.catalog,
          reasons: match.reasons,
          installed: false as const,
          source: 'team' as const,
          note: TEAM_NOTE,
        }
      })
      const next =
        compact.length > 0
          ? undefined
          : teamMatches.length > 0
            ? 'No installed tool matches. Ask the user to install a candidate from Team Tools in Shelf, or record the need with shelf_record_capability_gap.'
            : 'No installed tool matches. Record the need with shelf_record_capability_gap so the user sees it in Shelf.'
      return textResult({
        task,
        count: compact.length,
        matches: compact,
        ...(teamMatches.length ? { teamMatches } : {}),
        ...(next ? { next } : {}),
      })
    },
  )

  server.registerTool(
    'shelf_check_tool_readiness',
    {
      description:
        "Declared agent-access readiness for one tool's own CLI/MCP/HTTP interface, with its access list and runtime state. Contacts and starts nothing.",
      inputSchema: { id: z.string().describe('Tool id') },
      annotations: READ_ONLY,
    },
    async ({ id }) => {
      const tool = store.get(id)
      if (!tool) return toolNotFound(id)
      return textResult({
        id,
        readiness: deriveToolReadiness(tool),
        access: summarizeAgentAccess(tool),
        runtime: await processes.getState(id),
      })
    },
  )

  server.registerTool(
    'shelf_record_capability_gap',
    {
      description:
        'Record an unmet capability in Shelf. This only updates the local gap inbox; it never installs, generates, configures, or launches software.',
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      inputSchema: {
        task: z.string().min(1),
        capabilities: z.array(z.string().min(1)).min(1),
        reason: z.string().min(1).describe('Why existing Shelf tools are insufficient'),
        relatedToolIds: z.array(z.string()).optional(),
        suggestedAccess: agentAccessKindSchema.optional(),
      },
    },
    async (args) => {
      try {
        const knownIds = new Set(store.list().map((tool) => tool.id))
        return textResult(
          gaps.record({
            ...args,
            suggestedAccess: args.suggestedAccess as AgentAccessKind | undefined,
            relatedToolIds: (args.relatedToolIds || []).filter((id) => knownIds.has(id)),
          }),
        )
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err))
      }
    },
  )

  server.registerTool(
    'shelf_get_gap_brief',
    {
      description:
        'Paste-ready build brief for one capability gap: task, capabilities, related tools, brand, and how to register the finished tool back to Shelf.',
      inputSchema: { id: z.string().describe('Capability gap id') },
      annotations: READ_ONLY,
    },
    async ({ id }) => {
      const gap = gaps.get(id)
      if (!gap) return errorResult(`Capability gap not found: ${id}. Call shelf_list_capability_gaps (status: "all") for ids.`)
      const related = gap.relatedToolIds
        .map((toolId) => store.get(toolId))
        .filter((tool): tool is Tool => Boolean(tool))
      const brand = resolveProfileForGap(gap, store.listCollections(), profiles.list())
      return textResult({
        id,
        brief: buildGapBrief(gap, related, brand.profile ? { profile: brand.profile } : undefined),
      })
    },
  )

  server.registerTool(
    'shelf_update_capability_gap',
    {
      description:
        'Update a capability gap while building for it: set status "planned" and/or attach related tool ids. Resolving or dismissing a gap is the user\'s call in Shelf.',
      annotations: LOCAL_WRITE,
      inputSchema: {
        id: z.string().describe('Capability gap id'),
        status: z
          .literal('planned')
          .optional()
          .describe('The only status agents may set'),
        relatedToolIds: z
          .array(z.string())
          .optional()
          .describe('Tool ids to attach (merged, unknown ids dropped)'),
      },
    },
    async ({ id, status, relatedToolIds }) => {
      try {
        const current = gaps.get(id)
        if (!current) return errorResult(`Capability gap not found: ${id}. Call shelf_list_capability_gaps (status: "all") for ids.`)
        // Resolved/dismissed are USER decisions. An agent re-marking such a
        // gap "planned" would silently reopen it — refuse instead.
        if (current.status === 'resolved' || current.status === 'dismissed') {
          return errorResult(
            `Gap is ${current.status} — the user decided this in the GUI. Record a new gap if the need genuinely returns.`,
          )
        }
        // Validate BEFORE the do-something guard: an all-unknown id list must
        // error, not report success while attaching nothing.
        const knownIds = new Set(store.list().map((tool) => tool.id))
        const validToolIds = (relatedToolIds || []).filter((toolId) =>
          knownIds.has(toolId),
        )
        const droppedToolIds = (relatedToolIds || []).filter(
          (toolId) => !knownIds.has(toolId),
        )
        if (!status && validToolIds.length === 0) {
          return errorResult(
            droppedToolIds.length > 0
              ? `No known tool ids in relatedToolIds (unknown: ${droppedToolIds.join(', ')}). Pass ids from shelf_list_tools.`
              : 'Provide status "planned" and/or relatedToolIds.',
          )
        }
        const gap = gaps.update(id, { status, relatedToolIds: validToolIds })
        return textResult({ gap, droppedToolIds })
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err))
      }
    },
  )

  server.registerTool(
    'shelf_list_capability_gaps',
    {
      description:
        'List capability gaps to plan work or avoid duplicates. Defaults: status open, 20 newest; examples only with includeExamples.',
      inputSchema: {
        status: z
          .enum(['open', 'planned', 'resolved', 'dismissed', 'all'])
          .optional()
          .describe('Default open'),
        limit: z.number().int().positive().max(200).optional().describe('Default 20'),
        includeExamples: z.boolean().optional().describe('Include recent request examples'),
      },
      annotations: READ_ONLY,
    },
    async ({ status, limit, includeExamples }) => {
      const wanted = status ?? 'open'
      const list = gaps.list({
        status: wanted === 'all' ? undefined : (wanted as CapabilityGapStatus),
        limit: limit ?? 20,
      })
      return textResult({
        status: wanted,
        count: list.length,
        gaps: list.map((gap) => gapRow(gap, Boolean(includeExamples))),
      })
    },
  )
}
