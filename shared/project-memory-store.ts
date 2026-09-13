import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { atomicWriteFileSync, withFileLockSync } from './atomic-file'
import { resolveShelfDataRoot } from './paths'
import {
  PROJECT_MEMORY_FIELD_LIMIT,
  type ProjectMemory,
  type SaveProjectMemoryInput,
} from './project-context-contracts'

const text = z.string().max(PROJECT_MEMORY_FIELD_LIMIT)
const fieldsSchema = z
  .object({
    purpose: text,
    conventions: text,
    decisions: text,
    knownIssues: text,
    nextSteps: text,
  })
  .strict()
const idSchema = z.string().min(1).max(200)
const recordSchema = fieldsSchema
  .extend({
    toolId: idSchema,
    revision: z.string().uuid(),
    updatedAt: z.string().datetime(),
  })
  .strict()
const fileSchema = z
  .object({ version: z.literal(1), memories: z.array(recordSchema).max(1000) })
  .strict()
const inputSchema = z
  .object({
    toolId: idSchema,
    expectedRevision: z.string().uuid().nullable(),
    fields: fieldsSchema,
  })
  .strict()
const MAX_FILE_BYTES = 32 * 1024 * 1024

/** Local user-authored notes. Agents read them but cannot overwrite them. */
export class ProjectMemoryStore {
  private readonly file: string
  constructor(root = resolveShelfDataRoot()) {
    fs.mkdirSync(root, { recursive: true })
    this.file = path.join(root, 'project-memory.json')
  }
  private read() {
    try {
      if (fs.statSync(this.file).size > MAX_FILE_BYTES)
        throw new Error('File exceeds the supported size.')
      const data = fileSchema.parse(JSON.parse(fs.readFileSync(this.file, 'utf8')))
      if (
        new Set(data.memories.map((memory) => memory.toolId)).size !==
        data.memories.length
      )
        throw new Error('Duplicate tool records.')
      return data
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        return { version: 1 as const, memories: [] }
      // Do not turn corrupt or future-format memory into an empty editable record.
      throw new Error(
        'Project memory could not be read. The original project-memory.json is unchanged. Restore a valid backup before saving.',
      )
    }
  }
  get(toolId: string): ProjectMemory | null {
    idSchema.parse(toolId)
    return this.read().memories.find((memory) => memory.toolId === toolId) || null
  }
  save(input: SaveProjectMemoryInput): ProjectMemory {
    const clean = inputSchema.parse(input)
    return withFileLockSync(this.file, () => {
      const data = this.read()
      const previous = data.memories.find((memory) => memory.toolId === clean.toolId)
      if ((previous?.revision || null) !== clean.expectedRevision)
        throw new Error(
          'Project memory changed elsewhere. Your draft is still here. Load the saved version before saving again.',
        )
      const memory = recordSchema.parse({
        ...clean.fields,
        toolId: clean.toolId,
        revision: randomUUID(),
        updatedAt: new Date().toISOString(),
      })
      const next = fileSchema.parse({
        version: 1,
        memories: [
          ...data.memories.filter((item) => item.toolId !== clean.toolId),
          memory,
        ],
      })
      const serialized = JSON.stringify(next, null, 2) + '\n'
      if (Buffer.byteLength(serialized, 'utf8') > MAX_FILE_BYTES)
        throw new Error(
          'Project memory is full. Shorten or clear saved notes before adding more.',
        )
      atomicWriteFileSync(this.file, serialized)
      return memory
    })
  }
}
