import type { IpcContext } from './context'
import { handle } from './typed'

/** Settings → Companion: status, pairing, paired devices, certificate export. */
export function registerCompanionIpc(ctx: IpcContext): void {
  const { companion } = ctx

  handle('companion:status', () => companion.status())
  handle('companion:beginPairing', () => companion.beginPairing())
  handle('companion:cancelPairing', () => companion.cancelPairing())
  handle('companion:revokeDevice', (_e, id) => companion.revokeDevice(id))
  handle('companion:renameDevice', (_e, id, name) => companion.renameDevice(id, name))
  handle('companion:exportCertificate', () => companion.exportCertificate(ctx.getMainWindow()))
}
