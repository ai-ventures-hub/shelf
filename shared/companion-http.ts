/** Accept only origin-form request targets, including on WebSocket upgrades. */
export function companionRequestUrl(target: string | undefined, origin: string): URL | null {
  if (!target?.startsWith('/') || target.startsWith('//')) return null
  try {
    const url = new URL(target, origin)
    return url.origin === origin ? url : null
  } catch {
    return null
  }
}
