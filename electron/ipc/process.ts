import { dialog } from 'electron'
import fs from 'node:fs'
import { buildErrorReport, buildReceiptReport } from '../../shared/launch-diagnostics'
import { receiptsToCsv, receiptsToJson } from '../../shared/receipt-export'
import type { IpcContext } from './context'
import { handle } from './typed'

/** Tool processes (start / stop / logs / error report) and run receipts. */
export function registerProcessIpc(ctx: IpcContext): void {
  const { store, processes, receipts } = ctx

  handle('process:states', () => processes.getStates())
  handle('process:start', (_e, id, options) => processes.start(id, options))
  handle('process:stop', (_e, id) => processes.stop(id))
  handle('process:restart', (_e, id) => processes.restart(id))
  handle('process:logs', (_e, id, runId) => processes.getLogs(id, runId))
  // Paste-ready failure report for "Copy report for your AI tool".
  handle('process:errorReport', async (_e, id, runId) => {
    const tool = store.get(id)
    if (!tool) return null
    if (runId) {
      const receipt = receipts.get(runId)
      if (!receipt || receipt.toolId !== id) throw new Error('This run is no longer available for the selected tool.')
      return buildReceiptReport(tool, receipt, processes.getLogs(id, runId))
    }
    const state = await processes.getState(id)
    return buildErrorReport(tool, state, processes.getLogs(id))
  })

  handle('receipts:list', (_e, opts) => receipts.list(opts || {}))
  handle('receipts:clear', (_e, opts) => receipts.clear(opts || {}))
  handle('receipts:export', async (_e, opts): Promise<{ saved: boolean; path?: string }> => {
    const format = opts?.format === 'csv' ? 'csv' : 'json'
    const list = receipts.list({
      toolId: opts?.toolId,
      outcomes: opts?.outcomes,
      query: opts?.query,
      limit: 400,
    })
    const content = format === 'csv' ? receiptsToCsv(list) : receiptsToJson(list)
    const stamp = new Date().toISOString().slice(0, 10)
    const saveOpts: Electron.SaveDialogOptions = {
      title: 'Export run receipts',
      defaultPath: `shelf-receipts-${stamp}.${format}`,
      filters:
        format === 'csv'
          ? [{ name: 'CSV', extensions: ['csv'] }]
          : [{ name: 'JSON', extensions: ['json'] }],
    }
    // Parent window is optional — export still works if the UI is hidden to tray.
    const mainWindow = ctx.getMainWindow()
    const result = mainWindow
      ? await dialog.showSaveDialog(mainWindow, saveOpts)
      : await dialog.showSaveDialog(saveOpts)
    if (result.canceled || !result.filePath) return { saved: false }
    fs.writeFileSync(result.filePath, content, 'utf8')
    return { saved: true, path: result.filePath }
  })
}
