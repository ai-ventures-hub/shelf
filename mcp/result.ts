import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js'
import { sanitizeOutput, maskSecrets } from '../shared/types'

let observeRequest: (() => void) | undefined
export function setRequestObserver(observer: () => void): void { observeRequest = observer }

/** Shared MCP tool response helpers (stdout is JSON-RPC only). */

function observe(): void {
  try { observeRequest?.() } catch { /* observation is advisory */ }
}

/** Compact JSON: agents parse it, nobody reads the indentation. */
export function textResult(payload: unknown) {
  observe()
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(sanitizeOutput(payload)) }],
  }
}

/** Plain text (markdown, log tails) — no JSON-escaped string wrapper. */
export function plainTextResult(text: string, knownValues: readonly string[] = []) {
  observe()
  return {
    content: [{ type: 'text' as const, text: maskSecrets(text, knownValues) }],
  }
}

export function errorResult(message: string) {
  return {
    content: [{ type: 'text' as const, text: maskSecrets(message) }],
    isError: true,
  }
}

/** Not-found with the next step, shared by every id-taking tool. */
export function toolNotFound(id: string) {
  const shown = id.length > 80 ? `${id.slice(0, 80)}…` : id
  return errorResult(`Tool not found: ${shown}. Call shelf_list_tools and pass an exact id from it.`)
}

/**
 * Tool annotations (MCP 2025-03-26+). Clients presume an unannotated tool is
 * destructive and open-world, so every tool declares one of these.
 */
export const READ_ONLY: ToolAnnotations = {
  readOnlyHint: true,
  // Implied by readOnlyHint per spec, but both default to the alarming
  // value, so clients that read them in isolation get them explicitly.
  // (idempotentHint only means something for writes.)
  destructiveHint: false,
  openWorldHint: false,
}

/** Writes Shelf's own files only; safe to repeat with the same arguments. */
export const LOCAL_WRITE: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
}

/** Removes or stops something; repeating it has no further effect. */
export const DESTRUCTIVE: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: false,
}

/** Runs the user's own project commands (arbitrary local processes). */
export const RUNS_COMMANDS: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
}
