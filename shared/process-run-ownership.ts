/** Receipt identity and listener ownership shared by lifecycle decisions. */
import type { RunReceipt } from './contracts'
import { findPortOccupants } from './ports'
import { invalidateProcessSnapshot, verifyOccupantsOwnedBy } from './process-ownership'
import type { ExternalOwner } from './process-reconcile'
import type { ProcessRuntimeSupport } from './process-runtime-support'
import type { ReceiptStore } from './receipt-store'

export class ProcessRunOwnership {
  constructor(private readonly receipts: ReceiptStore | undefined, private readonly runtime: ProcessRuntimeSupport) { }
  findActiveReceipt(toolId: string, port?: number): RunReceipt | undefined {
    try {
      return (
        this.receipts?.findActiveProcess(toolId, port) ??
        // Port drift (edited config, log-sniffed port) must not break ownership:
        // ancestry against the receipt pid is the real proof, not port equality.
        this.receipts?.findActiveProcess(toolId)
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.runtime.appendLog(toolId, 'system', `Receipt lookup failed: ${message}`)
      return undefined
    }
  }

  async trustedExternalOwner(
    toolId: string,
    port: number,
    occupants: number[],
  ): Promise<ExternalOwner | null> {
    try {
      const receipt = this.findActiveReceipt(toolId, port)
      if (!receipt?.pid) return null
      const owned = await verifyOccupantsOwnedBy(occupants, receipt.pid)
      if (!owned) return null
      if (receipt.port !== port) {
        this.runtime.appendLog(
          toolId,
          'system',
          `Adopting via receipt with port ${receipt.port ?? 'unset'} (tool now configured for ${port}).`,
        )
        this.runtime.markReceiptRunning(receipt.id, { port })
      }
      return {
        ownerPid: receipt.pid,
        receiptId: receipt.id,
        receiptPort: receipt.port,
        startedBy: receipt.startedBy,
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.runtime.appendLog(toolId, 'system', `Ownership check failed: ${message}`)
      return null
    }
  }

  async ownsListener(port: number, pid?: number, occupants?: number[]): Promise<boolean> {
    if (!pid) return false
    invalidateProcessSnapshot()
    return verifyOccupantsOwnedBy(occupants ?? await findPortOccupants(port), pid)
  }
}
