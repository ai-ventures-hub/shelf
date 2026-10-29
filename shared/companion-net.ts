/**
 * Where the Companion server may listen. Pure functions over an interface
 * list so the smoke suite can pin the policy without a real network.
 */
import os from 'node:os'
import type { CompanionInterface } from './companion-contracts'

export const TAILSCALE_PREF = 'tailscale'

/** Tailscale hands out CGNAT addresses: 100.64.0.0/10. */
export function isTailscaleAddress(address: string): boolean {
  const parts = address.split('.').map(Number)
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false
  return parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127
}

export function isLoopbackAddress(address: string): boolean {
  const lower = address.trim().toLowerCase()
  return lower === 'localhost' || lower === '::1' || lower === '[::1]' || lower.startsWith('127.')
}

export function isUnspecifiedAddress(address: string): boolean {
  const lower = address.trim().toLowerCase()
  return lower === '0.0.0.0' || lower === '::' || lower === '[::]' || lower === ''
}

/** Every IPv4 interface the server could bind: never loopback, never all-interfaces. */
export function listCompanionInterfaces(
  table: NodeJS.Dict<os.NetworkInterfaceInfo[]> = os.networkInterfaces(),
): CompanionInterface[] {
  const found: CompanionInterface[] = []
  for (const [name, infos] of Object.entries(table)) {
    for (const info of infos || []) {
      if (info.internal) continue
      if (info.family !== 'IPv4' && (info.family as unknown) !== 4) continue
      if (isLoopbackAddress(info.address) || isUnspecifiedAddress(info.address)) continue
      found.push({
        name,
        address: info.address,
        tailscale: name.startsWith('utun') && isTailscaleAddress(info.address),
      })
    }
  }
  // Tailscale first, then LAN interfaces in name order (en0 before en5).
  return found.sort((a, b) => Number(b.tailscale) - Number(a.tailscale) || a.name.localeCompare(b.name))
}

export type BindAddressCheck = { ok: true; address: string } | { ok: false; reason: string }

/**
 * An address the server may bind right now: a current, non-loopback,
 * non-wildcard IPv4 on this Mac. Anything else is refused with a reason the
 * Settings pane can show.
 */
export function validateBindAddress(address: string, interfaces: CompanionInterface[]): BindAddressCheck {
  const trimmed = (address || '').trim()
  if (isUnspecifiedAddress(trimmed)) {
    return { ok: false, reason: 'Shelf never listens on every interface. Choose Tailscale or one network.' }
  }
  if (isLoopbackAddress(trimmed)) {
    return { ok: false, reason: 'Loopback cannot reach a phone. Choose Tailscale or one network.' }
  }
  const match = interfaces.find((item) => item.address === trimmed)
  if (!match) {
    return { ok: false, reason: `${trimmed} is not an address on this Mac right now.` }
  }
  return { ok: true, address: match.address }
}

/** Turn the preference ('tailscale' or an explicit IPv4) into a bindable address. */
export function resolveBindAddress(pref: string, interfaces: CompanionInterface[]): BindAddressCheck {
  if ((pref || TAILSCALE_PREF).trim().toLowerCase() === TAILSCALE_PREF) {
    const tailscale = interfaces.find((item) => item.tailscale)
    if (!tailscale) {
      return {
        ok: false,
        reason: 'Tailscale is not running on this Mac. Start it, or choose a network in Settings → Companion.',
      }
    }
    return { ok: true, address: tailscale.address }
  }
  return validateBindAddress(pref, interfaces)
}

export function validateCompanionPort(port: unknown): number | null {
  if (typeof port !== 'number' || !Number.isInteger(port) || port < 1024 || port > 65535) return null
  return port
}
