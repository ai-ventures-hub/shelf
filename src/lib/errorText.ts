/** User-facing text for a failed bridge call, without Electron's IPC prefix. */
export function errorText(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err)
  return message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')
}
