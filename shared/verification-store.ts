import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { atomicWriteFileSync, withFileLockSync } from './atomic-file'
import {
  verificationActive,
  type SaveVerificationInput,
  type VerificationRun,
  type VerificationState,
} from './verification-contracts'

const id = z.string().min(1).max(200)
const uuid = z.string().uuid()
const timestamp = z.string().datetime()
const status = z.enum([
  'pending',
  'running',
  'passed',
  'failed',
  'cancelled',
  'timed_out',
  'skipped',
  'interrupted',
  'cleanup_required',
])
const verificationStepSchema = z
  .object({
    id: uuid,
    label: z.string().trim().min(1).max(120),
    command: z
      .string()
      .trim()
      .min(1)
      .max(4000)
      .refine((value) => !value.includes('\0'), 'Commands cannot contain null bytes.'),
    timeoutSeconds: z.number().int().min(1).max(3600),
  })
  .strict()
const steps = z
  .array(verificationStepSchema)
  .min(1)
  .max(10)
  .refine(
    (items) => new Set(items.map((item) => item.id)).size === items.length,
    'Step IDs must be unique.',
  )
const owner = z
  .object({ pid: z.number().int().positive(), identity: z.string().min(1) })
  .strict()
const runSchema = z
  .object({
    id: uuid,
    toolId: id,
    workflowRevision: uuid,
    toolRevision: z.string(),
    projectPath: z.string(),
    startedAt: timestamp,
    endedAt: timestamp.optional(),
    status,
    steps: z
      .array(
        verificationStepSchema
          .extend({
            status,
            startedAt: timestamp.optional(),
            endedAt: timestamp.optional(),
            exitCode: z.number().int().nullable().optional(),
            message: z.string().max(4000).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(10),
    message: z.string().max(4000).optional(),
    owner,
    child: owner.optional(),
  })
  .strict()
const schema = z
  .object({
    version: z.literal(1),
    toolId: id,
    workflow: z.object({ revision: uuid, steps }).strict().nullable(),
    runs: z.array(runSchema).max(10),
  })
  .strict()
const MAX_BYTES = 2 * 1024 * 1024

/** Separate, bounded records; corruption never becomes an empty editable workflow. */
export class VerificationStore {
  readonly root: string
  constructor(root: string) {
    this.root = path.join(root, 'verification')
    fs.mkdirSync(this.root, { recursive: true, mode: 0o700 })
  }
  private file(toolId: string) {
    id.parse(toolId)
    return path.join(
      this.root,
      `${createHash('sha256').update(toolId).digest('hex')}.json`,
    )
  }
  get(toolId: string): VerificationState {
    const file = this.file(toolId)
    try {
      if (fs.statSync(file).size > MAX_BYTES) throw new Error('Oversized file')
      const data = schema.parse(JSON.parse(fs.readFileSync(file, 'utf8')))
      if (
        data.toolId !== toolId ||
        data.runs.some((run) => run.toolId !== toolId) ||
        new Set(data.runs.map((run) => run.id)).size !== data.runs.length
      )
        throw new Error('Mismatched records')
      return data
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        return { toolId, workflow: null, runs: [] }
      throw new Error(
        'Verification data could not be read. The original file is unchanged; restore a valid backup before saving or running commands.',
      )
    }
  }
  private write(state: VerificationState) {
    const text = JSON.stringify(schema.parse({ ...state, version: 1 }), null, 2) + '\n'
    if (Buffer.byteLength(text) > MAX_BYTES)
      throw new Error('Verification history exceeds its storage limit.')
    atomicWriteFileSync(this.file(state.toolId), text)
  }
  save(input: SaveVerificationInput) {
    const clean = z
      .object({ toolId: id, expectedRevision: uuid.nullable(), steps })
      .strict()
      .parse(input)
    return withFileLockSync(this.file(clean.toolId), () => {
      const state = this.get(clean.toolId)
      if ((state.workflow?.revision || null) !== clean.expectedRevision)
        throw new Error(
          'Verification commands changed elsewhere. Your draft is preserved. Reload saved commands before saving again.',
        )
      if (state.runs.some((run) => verificationActive(run.status)))
        throw new Error(
          'Finish or cancel the current verification before editing its workflow.',
        )
      state.workflow = { revision: randomUUID(), steps: clean.steps }
      this.write(state)
      return state.workflow
    })
  }
  begin(run: VerificationRun) {
    return withFileLockSync(this.file(run.toolId), () => {
      const state = this.get(run.toolId)
      if (state.runs.some((item) => verificationActive(item.status)))
        throw new Error(
          'A verification is already active for this project. Finish or cancel it first.',
        )
      if (state.workflow?.revision !== run.workflowRevision)
        throw new Error('Saved commands changed. Review them again before running.')
      const removed = state.runs.slice(9)
      state.runs = [runSchema.parse(run), ...state.runs.slice(0, 9)]
      this.write(state)
      // History commits before old logs are pruned. Failure to prune cannot invalidate a run.
      for (const item of removed) {
        try {
          fs.rmSync(this.logRoot(item.id), { recursive: true, force: true })
        } catch {
          /* History is committed; a log-pruning error must not invalidate this run. */
        }
      }
    })
  }
  update(run: VerificationRun) {
    withFileLockSync(this.file(run.toolId), () => {
      const state = this.get(run.toolId)
      const index = state.runs.findIndex((item) => item.id === run.id)
      if (index < 0) throw new Error('Verification run is no longer retained.')
      state.runs[index] = runSchema.parse(run)
      this.write(state)
    })
  }
  logRoot(runId: string) {
    return path.join(this.root, 'runs', uuid.parse(runId))
  }
}
