import { z } from 'zod'

import { agentAccessInputSchema, toolSchema } from './tool-validation'

/** Older records may omit fields that normalization supplies. */
export const storedToolSchema = toolSchema.partial().extend({
  agentAccess: z.array(agentAccessInputSchema.passthrough()).optional(),
}).passthrough()
export const storedCollectionSchema = z.object({
  id: z.string().optional(), name: z.string().optional(), description: z.string().optional(),
  toolIds: z.array(z.string()).optional(), designProfileId: z.string().optional(),
  createdAt: z.string().optional(), updatedAt: z.string().optional(), origin: z.enum(['agent', 'user']).optional(),
}).passthrough()

export class FutureLibraryVersionError extends Error {
  constructor() { super('This library was written by a newer Shelf version. Update Shelf before editing it. The file has not been changed.') }
}
