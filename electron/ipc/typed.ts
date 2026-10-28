import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import type { IpcArgs, IpcInvokeChannel, IpcResult } from '../../shared/ipc-channels'

type Awaitable<T> = T | Promise<T>

/**
 * `ipcMain.handle` typed from the shared channel map: the handler's
 * arguments and result come from the `ShelfApi` method the channel is bound
 * to, so a handler that drifts from the renderer contract fails to compile.
 */
export function handle<K extends IpcInvokeChannel>(
  channel: K,
  handler: (event: IpcMainInvokeEvent, ...args: IpcArgs<K>) => Awaitable<IpcResult<K>>,
): void {
  ipcMain.handle(
    channel,
    handler as (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown,
  )
}
