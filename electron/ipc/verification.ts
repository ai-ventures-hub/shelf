import { prepareProjectHandoff } from '../../shared/project-handoff'
import { prepareVerificationHandoff } from '../../shared/verification-handoff'
import type { IpcContext } from './context'
import { handle } from './typed'

/** Verification workflows plus per-project memory and handoffs. */
export function registerVerificationIpc(ctx: IpcContext): void {
  const { store, verification, projectMemory, receipts, designProfiles } = ctx

  handle('verification:activity', () => verification.activity())
  handle('verification:get', (_e, id) => verification.get(id))
  handle('verification:save', (_e, input) => verification.save(input))
  handle('verification:suggest', (_e, id) => verification.suggest(id))
  handle('verification:start', (_e, input) => {
    if (ctx.isShuttingDown()) throw new Error('Shelf is preparing to quit or update. Try again after it finishes.')
    return verification.start(input)
  })
  handle('verification:cancel', (_e, id, runId) => verification.cancel(id, runId))
  handle('verification:logs', (_e, id, runId, stepId) => verification.logs(id, runId, stepId))
  handle('verification:handoff', (_e, id, runId) =>
    prepareVerificationHandoff({ library: store, memory: projectMemory, receipts, design: designProfiles }, id, runId))

  handle('context:getMemory', (_e, id) => {
    if (!store.get(id)) throw new Error('This tool is no longer in the library.')
    return projectMemory.get(id)
  })
  handle('context:saveMemory', (_e, input) => {
    if (!store.get(input?.toolId)) throw new Error('This tool is no longer in the library.')
    return projectMemory.save(input)
  })
  handle('context:handoff', (_e, id, options) =>
    prepareProjectHandoff({ library: store, memory: projectMemory, receipts, design: designProfiles }, id, options))
}
