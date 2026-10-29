/**
 * Paired Companion devices: `<dataRoot>/companion/devices.json`.
 *
 * Only token hashes are stored. Same discipline as the other JSON stores:
 * atomic writes under a file lock, and a corrupt file is set aside as a
 * timestamped backup before being reset.
 */
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { atomicWriteFileSync, withFileLockSync } from './atomic-file'
import type { CompanionDevicesFile, PairedDevice, PairedDeviceView } from './companion-contracts'
import { resolveShelfDataRoot } from './paths'

export const MAX_PAIRED_DEVICES = 20
const MAX_NAME = 60

export function companionDir(root = resolveShelfDataRoot()): string {
  return path.join(root, 'companion')
}

/** Bearer tokens are 32 random bytes, base64url; only their sha256 is kept. */
export function mintDeviceToken(): string {
  return randomBytes(32).toString('base64url')
}

export function hashDeviceToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

/** Constant-time compare of two hex digests of equal length. */
export function sameDigest(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'))
}

export function deviceView(device: PairedDevice): PairedDeviceView {
  const { tokenHash: _hash, ...view } = device
  return view
}

export function sanitizeDeviceName(raw: unknown, fallback = 'Paired device'): string {
  const text = typeof raw === 'string' ? raw.replace(/[\u0000-\u001f\u007f]/g, '').trim() : ''
  return (text || fallback).slice(0, MAX_NAME)
}

export class CompanionDeviceStore {
  private readonly filePath: string

  constructor(root = resolveShelfDataRoot()) {
    const dir = companionDir(root)
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
    this.filePath = path.join(dir, 'devices.json')
    withFileLockSync(this.filePath, () => {
      if (!fs.existsSync(this.filePath)) {
        this.write({ version: 1, devices: [] })
        return
      }
      try {
        const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as Partial<CompanionDevicesFile>
        if (!Array.isArray(parsed.devices)) throw new Error('missing devices array')
      } catch {
        const stamp = new Date().toISOString().replace(/[:.]/g, '-')
        fs.copyFileSync(this.filePath, path.join(dir, `devices.corrupt-backup-${stamp}.json`))
        this.write({ version: 1, devices: [] })
      }
    })
  }

  list(): PairedDeviceView[] {
    return this.read().devices.map(deviceView)
  }

  /** Register a device for a freshly minted token. Returns the view, never the token. */
  create(name: string, token: string): PairedDeviceView {
    return withFileLockSync(this.filePath, () => {
      const file = this.read()
      if (file.devices.length >= MAX_PAIRED_DEVICES) {
        throw new Error(`Shelf pairs at most ${MAX_PAIRED_DEVICES} devices. Revoke one first.`)
      }
      const device: PairedDevice = {
        id: randomUUID(),
        name: sanitizeDeviceName(name),
        tokenHash: hashDeviceToken(token),
        pairedAt: new Date().toISOString(),
      }
      file.devices.push(device)
      this.write(file)
      return deviceView(device)
    })
  }

  /** The device a bearer token belongs to, or null. Constant-time per candidate. */
  authenticate(token: string): PairedDeviceView | null {
    if (typeof token !== 'string' || token.length < 16 || token.length > 128) return null
    const digest = hashDeviceToken(token)
    const match = this.read().devices.find((device) => sameDigest(device.tokenHash, digest))
    return match ? deviceView(match) : null
  }

  /** Record a sighting; throttled by callers so prefs-style disk writes stay rare. */
  touch(id: string, from: string | undefined): void {
    withFileLockSync(this.filePath, () => {
      const file = this.read()
      const device = file.devices.find((item) => item.id === id)
      if (!device) return
      device.lastSeenAt = new Date().toISOString()
      if (from) device.lastSeenFrom = from
      this.write(file)
    })
  }

  rename(id: string, name: string): PairedDeviceView {
    return withFileLockSync(this.filePath, () => {
      const file = this.read()
      const device = file.devices.find((item) => item.id === id)
      if (!device) throw new Error('That device is no longer paired.')
      device.name = sanitizeDeviceName(name, device.name)
      this.write(file)
      return deviceView(device)
    })
  }

  /** Invalidate a device's token. Takes effect on its next request. */
  revoke(id: string): boolean {
    return withFileLockSync(this.filePath, () => {
      const file = this.read()
      const before = file.devices.length
      file.devices = file.devices.filter((item) => item.id !== id)
      if (file.devices.length === before) return false
      this.write(file)
      return true
    })
  }

  private read(): CompanionDevicesFile {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as Partial<CompanionDevicesFile>
      return {
        version: 1,
        devices: Array.isArray(parsed.devices)
          ? parsed.devices.filter((item): item is PairedDevice =>
              Boolean(item && typeof item.id === 'string' && typeof item.tokenHash === 'string'))
          : [],
      }
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      throw new Error(`Companion device list is unreadable: ${detail}`)
    }
  }

  private write(file: CompanionDevicesFile): void {
    // atomicWriteFileSync already writes 0600.
    atomicWriteFileSync(this.filePath, JSON.stringify(file, null, 2))
  }
}
