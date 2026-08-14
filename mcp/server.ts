/**
 * Shelf MCP stdio server — same library + process manager as the Electron app.
 * Log only to stderr; stdout is reserved for MCP JSON-RPC.
 */
import { randomUUID } from 'node:crypto'
import pkg from '../package.json'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { resolveDesignMd } from '../shared/design-md'
import { resolveDesignProfile } from '../shared/design-resolve'
import { summarizeDesignProfile } from '../shared/design-brief'
import { CapabilityGapStore } from '../shared/capability-gap-store'
import { DesignProfileStore } from '../shared/design-profile-store'
import { deriveToolReadiness } from '../shared/capability-intelligence'
import { LibraryStore } from '../shared/library-store'
import { ProcessManager } from '../shared/process-manager'
import {
  findFreePort,
  findPortOccupant,
  urlForPort,
  withForcedPort,
} from '../shared/ports'
import { inspectProject } from '../shared/project-import'
import { registerProject } from '../shared/register-project'
import { ReceiptStore } from '../shared/receipt-store'
import {
  sanitizeToolForOutput,
  type AgentAccess,
  type Tool,
} from '../shared/types'
import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js'
import { errorResult, textResult } from './result'
import { registerCapabilityTools } from './capability-tools'
import { registerDesignTools } from './design-tools'

const store = new LibraryStore()
const receipts = new ReceiptStore()
const capabilityGaps = new CapabilityGapStore()
const designProfiles = new DesignProfileStore()
const processes = new ProcessManager(store, {
  receipts,
  // Thunk: the client's self-reported name (e.g. "claude-code") is only known
  // after the MCP initialize handshake, well before any tool call arrives.
  defaultOrigin: () => ({
    kind: 'mcp',
    client: server.server.getClientVersion()?.name,
  }),
})

const server = new McpServer({
  name: 'shelf',
  // The app version — clients see what's actually installed (this sat at a
  // hardcoded 0.1.0 through the 1.0 release).
  version: pkg.version,
})

const agentAccessSchema = z.object({
  id: z.string().optional(),
  kind: z.enum(['cli', 'mcp', 'http-api']),
  entrypoint: z.string().min(1),
  transport: z.enum(['stdio', 'streamable-http']).optional(),
  setupRequired: z.boolean().optional(),
  notes: z.string().optional(),
})

server.registerTool(
  'shelf_list_tools',
  {
    description: 'List tools in the Shelf library with runtime status summaries.',
  },
  async () => {
    const tools = await Promise.all(
      store.list().map(async (tool) => {
        const state = await processes.getState(tool.id)
        return {
          id: tool.id,
          name: tool.name,
          tags: tool.tags,
          capabilities: tool.capabilities,
          accessKinds: Array.from(new Set(tool.agentAccess.map((access) => access.kind))),
          readiness: deriveToolReadiness(tool),
          favorite: tool.favorite,
          projectPath: tool.projectPath,
          port: tool.port,
          url: tool.url,
          status: state.status,
          message: state.message,
        }
      }),
    )
    return textResult({ count: tools.length, tools })
  },
)

server.registerTool(
  'shelf_get_tool',
  {
    description: 'Get one Shelf tool by id, including sanitized config and runtime state.',
    inputSchema: {
      id: z.string().describe('Tool id'),
    },
  },
  async ({ id }) => {
    const tool = store.get(id)
    if (!tool) return errorResult(`Tool not found: ${id}`)
    return textResult({
      tool: sanitizeToolForOutput(tool),
      readiness: deriveToolReadiness(tool),
      state: await processes.getState(id),
    })
  },
)

server.registerTool(
  'shelf_find_free_port',
  {
    description:
      'Find free localhost TCP ports for registering or launching Shelf tools. Prefer this before upserting a web app.',
    inputSchema: {
      preferred: z
        .number()
        .int()
        .positive()
        .optional()
        .describe('Preferred port (returned when free)'),
      from: z.number().int().positive().optional().describe('Scan start (default 3000)'),
      to: z.number().int().positive().optional().describe('Scan end (default 3999)'),
      count: z
        .number()
        .int()
        .positive()
        .max(20)
        .optional()
        .describe('How many free candidates to return (default 5)'),
    },
  },
  async (args) => {
    try {
      const result = await findFreePort({
        preferred: args.preferred,
        from: args.from,
        to: args.to,
        count: args.count,
      })
      return textResult(result)
    } catch (err) {
      return errorResult(err instanceof Error ? err.message : String(err))
    }
  },
)

server.registerTool(
  'shelf_upsert_tool',
  {
    description:
      'Create or update a Shelf tool. Provide id to update an existing tool, or name to update by name / create when missing. By default checks port conflicts and returns warnings + suggestedPort without blocking the save.',
    inputSchema: {
      id: z.string().optional().describe('Existing tool id (optional)'),
      name: z.string().min(1).describe('Display name'),
      description: z.string().optional(),
      tags: z.array(z.string()).optional(),
      capabilities: z.array(z.string()).optional(),
      agentAccess: z.array(agentAccessSchema).optional(),
      favorite: z.boolean().optional(),
      projectPath: z.string().optional().describe('Absolute project folder path'),
      launchCommand: z.string().min(1).describe('Shell command to launch the tool'),
      stopCommand: z.string().optional(),
      url: z.string().optional(),
      port: z.number().int().positive().optional(),
      env: z.record(z.string(), z.string()).optional(),
      notes: z.string().optional(),
      iconPath: z.string().optional(),
      iconLucide: z
        .string()
        .optional()
        .describe('Lucide icon PascalCase name, e.g. Wrench'),
      iconColor: z.string().optional().describe('Hex color for Lucide glyph'),
      iconBackground: z.string().optional().describe('Hex background behind Lucide glyph'),
      checkPort: z
        .boolean()
        .optional()
        .describe('When true (default), warn if port is busy or claimed by another Shelf tool'),
      autoFixPort: z
        .boolean()
        .optional()
        .describe(
          'When true and the port is busy/claimed, rewrite port/url/launchCommand to a free port before saving',
        ),
    },
  },
  async (args) => {
    if (!args.launchCommand.trim()) {
      return errorResult('launchCommand is required.')
    }

    const now = new Date().toISOString()
    let existing: Tool | undefined
    if (args.id) existing = store.get(args.id)
    if (!existing) existing = store.findByName(args.name)

    const checkPort = args.checkPort !== false
    let port = args.port ?? existing?.port
    let url = args.url ?? existing?.url
    let launchCommand = args.launchCommand
    const warnings: string[] = []
    let suggestedPort: number | undefined
    let freeCandidates: number[] = []
    let portFixed = false

    if (port && checkPort) {
      const toolId = existing?.id || args.id
      const libraryConflicts = store
        .list()
        .filter((t) => t.port === port && t.id !== toolId)
        .map((t) => ({ id: t.id, name: t.name }))

      const occupantPid = await findPortOccupant(port)
      if (occupantPid) {
        warnings.push(`Port ${port} is currently in use by pid ${occupantPid}.`)
      }
      if (libraryConflicts.length > 0) {
        warnings.push(
          `Port ${port} is already claimed by Shelf tool(s): ${libraryConflicts
            .map((t) => `${t.name} (${t.id})`)
            .join(', ')}.`,
        )
      }

      if (warnings.length > 0) {
        try {
          const free = await findFreePort({ preferred: port, from: 3000, to: 4999, count: 5 })
          suggestedPort = free.port
          freeCandidates = free.candidates
        } catch {
          // leave suggestedPort unset
        }

        if (args.autoFixPort && suggestedPort) {
          port = suggestedPort
          url = urlForPort(url, suggestedPort)
          launchCommand = withForcedPort(launchCommand, suggestedPort)
          portFixed = true
          warnings.push(
            `autoFixPort applied: saved as port ${suggestedPort} with updated launchCommand/url.`,
          )
        } else if (suggestedPort) {
          warnings.push(
            `Suggested free port: ${suggestedPort}. Re-upsert with that port (and matching url/launch flags), set autoFixPort=true, or launch with onPortConflict=reassign.`,
          )
        }
      }
    }

    const tool = store.save({
      id: existing?.id || args.id || randomUUID(),
      name: args.name,
      description: args.description,
      tags: args.tags || existing?.tags || [],
      capabilities: args.capabilities ?? existing?.capabilities ?? [],
      agentAccess: (args.agentAccess ?? existing?.agentAccess ?? []).map((access) => ({
        ...access,
        id: access.id || randomUUID(),
        setupRequired: Boolean(access.setupRequired),
      })) as AgentAccess[],
      favorite: args.favorite ?? existing?.favorite ?? false,
      projectPath: args.projectPath ?? existing?.projectPath,
      launchCommand,
      stopCommand: args.stopCommand ?? existing?.stopCommand,
      url,
      port,
      env:
        portFixed && port
          ? { ...(args.env ?? existing?.env ?? {}), PORT: String(port) }
          : (args.env ?? existing?.env),
      notes: args.notes ?? existing?.notes,
      iconPath: args.iconPath ?? existing?.iconPath,
      iconLucide: args.iconLucide ?? existing?.iconLucide,
      iconColor: args.iconColor ?? existing?.iconColor,
      iconBackground: args.iconBackground ?? existing?.iconBackground,
      lastLaunchedAt: existing?.lastLaunchedAt,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    })

    return textResult({
      action: existing ? 'updated' : 'created',
      tool: sanitizeToolForOutput(tool),
      warnings: warnings.length ? warnings : undefined,
      suggestedPort,
      freeCandidates: freeCandidates.length ? freeCandidates : undefined,
      portFixed: portFixed || undefined,
    })
  },
)

server.registerTool(
  'shelf_remove_tool',
  {
    description: 'Remove a tool from the Shelf library by id. Stops it first if running.',
    inputSchema: {
      id: z.string().describe('Tool id'),
    },
  },
  async ({ id }) => {
    if (!store.get(id)) return errorResult(`Tool not found: ${id}`)
    const state = await processes.stop(id, 'Removed via MCP.')
    if (state.status === 'error') {
      // Deleting the record anyway would permanently orphan the child: the
      // MCP process has no quit-time stopAll, and reconcile only walks
      // tools that still exist in the library.
      return errorResult(
        `Could not stop the running tool: ${state.message} The tool was NOT removed — stop it first (shelf_stop_tool) or fix its stop command, then remove again.`,
      )
    }
    store.delete(id)
    processes.forget(id)
    return textResult({ removed: id })
  },
)

server.registerTool(
  'shelf_launch_tool',
  {
    description:
      'Launch a Shelf tool by id and wait for running/error status. Works for every registered tool regardless of readiness state or agentAccess — manual_only tools launch exactly the same way. Use onPortConflict=reassign to pick a free port when the configured one is busy.',
    inputSchema: {
      id: z.string().describe('Tool id'),
      onPortConflict: z
        .enum(['fail', 'reassign'])
        .optional()
        .describe('fail (default) refuses busy ports; reassign picks a free port and updates the library entry'),
    },
  },
  async ({ id, onPortConflict }) => {
    const before = store.get(id)
    if (!before) return errorResult(`Tool not found: ${id}`)
    const previousPort = before.port
    const state = await processes.start(id, {
      onPortConflict: onPortConflict || 'fail',
    })
    const after = store.get(id)
    const reassigned =
      previousPort &&
      after?.port &&
      after.port !== previousPort &&
      state.status === 'running'
        ? {
            from: previousPort,
            to: after.port,
            url: after.url,
            launchCommand: after.launchCommand,
          }
        : undefined
    return textResult({ state, reassigned })
  },
)

server.registerTool(
  'shelf_stop_tool',
  {
    description: 'Stop a running Shelf tool by id.',
    inputSchema: {
      id: z.string().describe('Tool id'),
    },
  },
  async ({ id }) => {
    if (!store.get(id)) return errorResult(`Tool not found: ${id}`)
    const state = await processes.stop(id)
    return textResult({ state })
  },
)

server.registerTool(
  'shelf_get_status',
  {
    description: 'Get runtime status for a Shelf tool.',
    inputSchema: {
      id: z.string().describe('Tool id'),
    },
  },
  async ({ id }) => {
    if (!store.get(id)) return errorResult(`Tool not found: ${id}`)
    return textResult({ state: await processes.getState(id) })
  },
)

server.registerTool(
  'shelf_get_logs',
  {
    description: 'Get recent launch logs for a Shelf tool (secrets already masked).',
    inputSchema: {
      id: z.string().describe('Tool id'),
      limit: z.number().int().positive().max(500).optional().describe('Max lines (default 100)'),
    },
  },
  async ({ id, limit }) => {
    if (!store.get(id)) return errorResult(`Tool not found: ${id}`)
    const lines = processes.getLogs(id)
    const capped = lines.slice(-(limit || 100))
    return textResult({ id, count: capped.length, lines: capped })
  },
)

registerCapabilityTools({
  server,
  store,
  processes,
  gaps: capabilityGaps,
  profiles: designProfiles,
})
registerDesignTools({ server, store, profiles: designProfiles })

server.registerTool(
  'shelf_list_collections',
  {
    description:
      'List curated Shelf collections and their tool membership. Use shelf_get_collection for one collection\'s full context (member states, brand profile).',
  },
  async () => {
    const collections = store.listCollections()
    return textResult({ count: collections.length, collections })
  },
)

server.registerTool(
  'shelf_get_collection',
  {
    description:
      "One collection's full working context in a single call: members with readiness and live runtime state, plus the design/brand profile the collection resolves to. Use when working on a stack ('the client project', 'my blog setup') so you know what runs, what's broken, and which brand applies before touching anything. Accepts id or exact name.",
    inputSchema: {
      id: z.string().optional().describe('Collection id'),
      name: z.string().optional().describe('Exact collection name (case-insensitive)'),
    },
  },
  async ({ id, name }) => {
    if (!id && !name) return errorResult('Pass a collection id or name.')
    const collections = store.listCollections()
    const collection = id
      ? collections.find((c) => c.id === id)
      : collections.find((c) => c.name.toLowerCase() === name!.trim().toLowerCase())
    if (!collection) {
      return errorResult(
        `Collection not found: ${id || name}. Call shelf_list_collections to see what exists.`,
      )
    }

    const members = await Promise.all(
      collection.toolIds.map(async (toolId) => {
        const tool = store.get(toolId)
        if (!tool) return { id: toolId, missing: true as const }
        const state = await processes.getState(toolId)
        return {
          id: tool.id,
          name: tool.name,
          capabilities: tool.capabilities,
          accessKinds: Array.from(new Set(tool.agentAccess.map((access) => access.kind))),
          readiness: deriveToolReadiness(tool),
          projectPath: tool.projectPath,
          port: tool.port,
          url: tool.url,
          status: state.status,
          message: state.message,
        }
      }),
    )

    const brand = resolveDesignProfile(designProfiles.list(), collections, {
      collectionId: collection.id,
    })
    return textResult({
      collection: { id: collection.id, name: collection.name },
      members,
      running: members.filter((m) => 'status' in m && m.status === 'running').length,
      designProfile: brand.profile
        ? {
            id: brand.profile.id,
            name: brand.profile.name,
            resolvedVia: brand.via,
            summary: summarizeDesignProfile(brand.profile),
            note: 'Call shelf_get_design_profile with this id for tokens and the full brand brief.',
          }
        : null,
    })
  },
)

server.registerTool(
  'shelf_inspect_project',
  {
    description:
      'Smart-import scan of an absolute project folder. Suggests name, launchCommand, port/url, tags, and DESIGN.md presence without writing the library — and detects MCP/CLI agent interfaces the project provides, returned as agentAccess ready to pass to shelf_upsert_tool. Prefer this before shelf_upsert_tool when registering a new folder.',
    inputSchema: {
      projectPath: z.string().min(1).describe('Absolute project folder path'),
    },
  },
  async ({ projectPath }) => {
    try {
      const suggestion = await inspectProject(projectPath)
      return textResult(suggestion)
    } catch (err) {
      return errorResult(err instanceof Error ? err.message : String(err))
    }
  },
)

server.registerTool(
  'shelf_register_project',
  {
    description:
      'One-shot register: inspect a project folder, save it to the library (idempotent — re-registering the same folder updates instead of duplicating), optionally run detected setup (package install; requires runSetup=true consent), and launch. Collapses the inspect → upsert → launch workflow into one call with the same safety semantics. Outcomes: launched | saved | needs_setup | saved_needs_review | saved_launch_failed | invalid_folder | dry_run. Failed launches carry a structured state.code (e.g. deps_missing, port_timeout).',
    inputSchema: {
      projectPath: z.string().min(1).describe('Absolute project folder path'),
      launch: z
        .boolean()
        .optional()
        .describe('Launch after saving (default true)'),
      onPortConflict: z
        .enum(['fail', 'reassign'])
        .optional()
        .describe('Default reassign: pick a free port and update the entry when busy'),
      runSetup: z
        .boolean()
        .optional()
        .describe(
          'Consent to run detected setup steps (e.g. npm install). Never runs without this.',
        ),
      dryRun: z
        .boolean()
        .optional()
        .describe('Inspect and gate only; save nothing, launch nothing'),
    },
  },
  async ({ projectPath, launch, onPortConflict, runSetup, dryRun }) => {
    try {
      const result = await registerProject(
        projectPath,
        { store, processes },
        {
          autoLaunch: launch ?? true,
          onPortConflict: onPortConflict || 'reassign',
          runSetup,
          dryRun,
        },
      )
      return textResult({
        ...result,
        tool: result.tool ? sanitizeToolForOutput(result.tool) : undefined,
      })
    } catch (err) {
      return errorResult(err instanceof Error ? err.message : String(err))
    }
  },
)

server.registerTool(
  'shelf_list_receipts',
  {
    description:
      'List durable run receipts (launch history). Newest first. Optionally filter by tool id.',
    inputSchema: {
      id: z.string().optional().describe('Tool id filter'),
      limit: z.number().int().positive().max(200).optional().describe('Max rows (default 50)'),
    },
  },
  async ({ id, limit }) => {
    const list = receipts.list({ toolId: id, limit })
    return textResult({ count: list.length, receipts: list })
  },
)

server.registerTool(
  'shelf_clear_receipts',
  {
    description:
      'Clear run receipts. Pass id to clear one tool; omit to clear the entire history.',
    inputSchema: {
      id: z.string().optional().describe('Tool id (optional — omit to clear all)'),
    },
  },
  async ({ id }) => {
    const result = receipts.clear({ toolId: id })
    return textResult(result)
  },
)

server.registerTool(
  'shelf_get_design_md',
  {
    description:
      'Resolve a project-local DESIGN.md for a Shelf tool or absolute projectPath. Returns found:false when none exists (not an error).',
    inputSchema: {
      id: z.string().optional().describe('Shelf tool id'),
      projectPath: z.string().optional().describe('Absolute project folder path'),
    },
  },
  async ({ id, projectPath }) => {
    if (!id && !projectPath) {
      return errorResult('Provide id or projectPath.')
    }
    const tool = id ? store.get(id) : undefined
    if (id && !tool) return errorResult(`Tool not found: ${id}`)
    const result = resolveDesignMd(projectPath || tool?.projectPath, tool?.id || id)
    return textResult(result)
  },
)

// Stable agent contract: shelf://tools/{id}/design-md
server.registerResource(
  'shelf-tool-design-md',
  new ResourceTemplate('shelf://tools/{id}/design-md', {
    list: undefined,
  }),
  {
    description: 'Project-local DESIGN.md for a Shelf tool, when present.',
    mimeType: 'text/markdown',
  },
  async (uri, variables) => {
    const id = String(variables.id || '')
    const tool = store.get(id)
    const result = resolveDesignMd(tool?.projectPath, id)
    if (!result.found) {
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify({ found: false, toolId: id }, null, 2),
          },
        ],
      }
    }
    return {
      contents: [
        {
          uri: uri.href,
          mimeType: 'text/markdown',
          text: result.content || '',
        },
      ],
    }
  },
)

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error('[shelf-mcp] ready on stdio')
}

main().catch((err) => {
  console.error('[shelf-mcp] fatal', err)
  process.exit(1)
})
