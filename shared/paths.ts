import os from 'node:os'
import path from 'node:path'

/**
 * Canonical library root: ~/Library/Application Support/Shelf
 * Shared by Electron GUI and the MCP server so both see the same tools.
 */
export function resolveShelfDataRoot(): string {
  return path.join(os.homedir(), 'Library', 'Application Support', 'Shelf')
}

/** macOS Application Support parent (…/Library/Application Support). */
export function resolveAppDataRoot(): string {
  return path.join(os.homedir(), 'Library', 'Application Support')
}
