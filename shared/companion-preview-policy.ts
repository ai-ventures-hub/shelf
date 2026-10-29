/**
 * Static rules for remote preview (Companion Phase B), shared by the proxy,
 * the main process, and the tool editor. Browser-safe: no Node imports.
 */

export function isLoopbackHost(host: string): boolean {
  const lower = host.trim().toLowerCase()
  return lower === 'localhost' || lower === '::1' || lower === '[::1]' || lower.startsWith('127.')
}

/** Host part of a tool's url, or null when the url is missing or unparsable. */
export function toolUrlHost(url: string | undefined): string | null {
  if (!url?.trim()) return null
  try {
    return new URL(url).hostname
  } catch {
    return null
  }
}

/**
 * Why a tool cannot be previewed remotely, or null when it can. Only the
 * static facts: whether it is running is the caller's business.
 */
export function previewBlocker(tool: { port?: number; url?: string }): string | null {
  if (!tool.port) return 'The tool needs a port before it can be previewed.'
  const host = toolUrlHost(tool.url)
  if (host && !isLoopbackHost(host)) {
    return `The tool's URL points at ${host}, not this Mac, so there is nothing to proxy.`
  }
  return null
}
