import { sanitizeOutput, maskSecrets } from '../shared/types'

let observeRequest: (() => void) | undefined
export function setRequestObserver(observer: () => void): void { observeRequest = observer }

/** Shared MCP tool response helpers (stdout is JSON-RPC only). */

export function textResult(payload: unknown) {
  try { observeRequest?.() } catch { /* observation is advisory */ }
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(sanitizeOutput(payload), null, 2) }],
  }
}

export function errorResult(message: string) {
  return {
    content: [{ type: 'text' as const, text: maskSecrets(message) }],
    isError: true,
  }
}
