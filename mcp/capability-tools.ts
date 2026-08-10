import { z } from 'zod'
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
import type { AgentAccessKind, CapabilityGapStatus, Tool } from '../shared/types'
import { errorResult, textResult } from './result'

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
        'Find Shelf tools for a natural-language task. Returns explainable ranked matches, declared readiness, and each match\'s declared access entrypoints. Readiness describes the tool\'s own agent interface — launching via shelf_launch_tool is always available for every match.',
      inputSchema: {
        task: z.string().min(1).describe('Task or capability needed'),
        accessKind: z.enum(['cli', 'mcp', 'http-api']).optional(),
        limit: z.number().int().positive().max(10).optional(),
      },
    },
    async ({ task, accessKind, limit }) => {
      const matches = findCapabilityMatches(store.list(), task, {
        accessKind: accessKind as AgentAccessKind | undefined,
        limit,
      })
      const enriched = await Promise.all(
        matches.map(async (match) => ({
          ...match,
          runtime: await processes.getState(match.toolId),
        })),
      )
      return textResult({ task, count: enriched.length, matches: enriched })
    },
  )

  server.registerTool(
    'shelf_check_tool_readiness',
    {
      description:
        'Check declared agent-access readiness for one Shelf tool. Readiness describes the tool\'s OWN interface (CLI/MCP/HTTP) — it never gates launching: shelf_launch_tool works for every registered tool. Nothing is contacted or started by this check.',
      inputSchema: { id: z.string().describe('Tool id') },
    },
    async ({ id }) => {
      const tool = store.get(id)
      if (!tool) return errorResult(`Tool not found: ${id}`)
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
      inputSchema: {
        task: z.string().min(1),
        capabilities: z.array(z.string().min(1)).min(1),
        reason: z.string().min(1).describe('Why existing Shelf tools are insufficient'),
        relatedToolIds: z.array(z.string()).optional(),
        suggestedAccess: z.enum(['cli', 'mcp', 'http-api']).optional(),
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
        'Get a paste-ready build brief for one capability gap: the task, requested capabilities, related existing tools, and instructions for registering the finished tool back to Shelf. Use this when asked to build something that fills a recorded gap.',
      inputSchema: { id: z.string().describe('Capability gap id') },
    },
    async ({ id }) => {
      const gap = gaps.get(id)
      if (!gap) return errorResult(`Capability gap not found: ${id}`)
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
        'Update a capability gap while building for it: set status "planned" and/or attach related tool ids. Agents cannot resolve or dismiss gaps — resolution is suggested by Shelf and confirmed by the user in the GUI.',
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
        if (!current) return errorResult(`Capability gap not found: ${id}`)
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
      description: 'List Shelf capability gaps for planning or avoiding duplicate recommendations.',
      inputSchema: {
        status: z.enum(['open', 'planned', 'resolved', 'dismissed']).optional(),
        limit: z.number().int().positive().max(200).optional(),
      },
    },
    async ({ status, limit }) =>
      textResult({
        gaps: gaps.list({
          status: status as CapabilityGapStatus | undefined,
          limit,
        }),
      }),
  )
}
