import { z } from 'zod'

/** Browser-safe tool fields. Boundary adapters may tighten requirements, not redefine fields. */
export const portSchema = z.number().int().min(1).max(65535)
export const agentAccessKindSchema = z.enum(['cli', 'mcp', 'http-api'])
export const mcpTransportSchema = z.enum(['stdio', 'streamable-http'])
export const agentAccessSchema = z.object({
  id: z.string(), kind: agentAccessKindSchema, entrypoint: z.string(),
  transport: mcpTransportSchema.optional(), setupRequired: z.boolean(), notes: z.string().optional(),
})
export const agentAccessInputSchema = agentAccessSchema.partial({ id: true, setupRequired: true })
export const toolSourceSchema = z.object({
  kind: z.enum(['git', 'bundle']), repo: z.string().optional(), ref: z.string().optional(),
  addedAt: z.string(), updatedAt: z.string().optional(),
})
export const toolSchema = z.object({
  id: z.string(), name: z.string(), launchCommand: z.string(),
  description: z.string().optional(), projectPath: z.string().optional(), stopCommand: z.string().optional(),
  tags: z.array(z.string()), capabilities: z.array(z.string()),
  agentAccess: z.array(agentAccessSchema), favorite: z.boolean(),
  env: z.record(z.string(), z.string()).optional(), port: portSchema.optional(),
  url: z.string().optional(), notes: z.string().optional(), iconPath: z.string().optional(),
  iconLucide: z.string().optional(), iconColor: z.string().optional(), iconBackground: z.string().optional(),
  createdAt: z.string(), updatedAt: z.string(), lastLaunchedAt: z.string().optional(),
  capabilitiesUpdatedAt: z.string().optional(), source: toolSourceSchema.optional(),
})

export type Tool = z.infer<typeof toolSchema>
export type ToolSource = z.infer<typeof toolSourceSchema>
export type AgentAccess = z.infer<typeof agentAccessSchema>
export type AgentAccessKind = z.infer<typeof agentAccessKindSchema>
export type McpTransport = z.infer<typeof mcpTransportSchema>
