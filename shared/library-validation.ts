import { z } from 'zod'

/** Validate persisted records before normalization can coerce or execute them. */
const access = z.object({
  id: z.string().optional(), kind: z.enum(['cli', 'mcp', 'http-api']),
  entrypoint: z.string(), transport: z.enum(['stdio', 'streamable-http']).optional(),
  setupRequired: z.boolean().optional(), notes: z.string().optional(),
}).passthrough()
export const storedToolSchema = z.object({
  id: z.string().optional(), name: z.string().optional(), launchCommand: z.string().optional(),
  description: z.string().optional(), projectPath: z.string().optional(), stopCommand: z.string().optional(),
  tags: z.array(z.string()).optional(), capabilities: z.array(z.string()).optional(),
  agentAccess: z.array(access).optional(), favorite: z.boolean().optional(),
  env: z.record(z.string(), z.string()).optional(), port: z.number().int().min(1).max(65535).optional(),
  url: z.string().optional(), notes: z.string().optional(), iconPath: z.string().optional(),
  iconLucide: z.string().optional(), iconColor: z.string().optional(), iconBackground: z.string().optional(),
  createdAt: z.string().optional(), updatedAt: z.string().optional(), lastLaunchedAt: z.string().optional(),
  capabilitiesUpdatedAt: z.string().optional(),
  source: z.object({ kind: z.enum(['git', 'bundle']), repo: z.string().optional(), ref: z.string().optional(), addedAt: z.string(), updatedAt: z.string().optional() }).optional(),
}).passthrough()
export const storedCollectionSchema = z.object({
  id: z.string().optional(), name: z.string().optional(), description: z.string().optional(),
  toolIds: z.array(z.string()).optional(), designProfileId: z.string().optional(),
  createdAt: z.string().optional(), updatedAt: z.string().optional(), origin: z.enum(['agent', 'user']).optional(),
}).passthrough()

export class FutureLibraryVersionError extends Error {
  constructor() { super('This library was written by a newer Shelf version. Update Shelf before editing it. The file has not been changed.') }
}
