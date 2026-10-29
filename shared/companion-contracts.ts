/**
 * Companion (2.4): what the desktop, the paired phone, and the Companion
 * server agree on. Browser-safe — the companion web app imports this file.
 */
import type {
  Collection,
  CollectionActionResult,
  LogLine,
  RunReceipt,
  ToolHealth,
  ToolRuntimeState,
} from './contracts'
import type { MorningEvent } from './morning-board'

/** Default Companion port: outside every range Shelf hands to tools. */
export const COMPANION_DEFAULT_PORT = 48620
/** The WebSocket subprotocol the phone names; its device token rides beside it. */
export const COMPANION_WS_PROTOCOL = 'shelf-companion'
/** How long a pairing QR stays valid. */
export const COMPANION_PAIRING_TTL_MS = 2 * 60 * 1000

export interface CompanionInterface {
  /** macOS interface name, e.g. en0 or utun4. */
  name: string
  /** IPv4 address. */
  address: string
  /** True for a Tailscale (CGNAT 100.64.0.0/10) address on a utun interface. */
  tailscale: boolean
}

export interface PairedDevice {
  id: string
  name: string
  /** sha256 hex of the bearer token; the token itself is never stored. */
  tokenHash: string
  pairedAt: string
  lastSeenAt?: string
  lastSeenFrom?: string
}

export type PairedDeviceView = Omit<PairedDevice, 'tokenHash'>

export interface CompanionDevicesFile {
  version: 1
  devices: PairedDevice[]
}

export interface CompanionPairingView {
  /** https://<address>:<port>/pair#<code>.<fingerprint> — shown as a QR on the Mac only. */
  url: string
  expiresAt: string
}

/** What Settings → Companion shows. Pushed on `companion:status`. */
export interface CompanionStatus {
  enabled: boolean
  running: boolean
  /** The companion web app's origin while running. */
  url: string | null
  bindAddress: string | null
  port: number
  interfaces: CompanionInterface[]
  tailscaleDetected: boolean
  certFingerprint: string | null
  keepAwakeActive: boolean
  connectedClients: number
  /** Why the server is not running although enabled, in plain words. */
  error: string | null
  devices: PairedDeviceView[]
  pairing: CompanionPairingView | null
}

/**
 * The tool as the phone sees it. No env, no commands, no notes: the
 * Companion controls tools, it does not edit them, and a phone must never
 * receive a value the desktop masks in its own logs.
 */
export interface CompanionTool {
  id: string
  name: string
  description?: string
  tags: string[]
  favorite: boolean
  port?: number
  url?: string
  iconLucide?: string
  iconColor?: string
  iconBackground?: string
  hasProject: boolean
  lastLaunchedAt?: string
  /** The user allowed preview from paired phones (tool editor, Advanced). */
  remotePreview: boolean
  /** The preview proxy is listening for this tool right now. */
  previewReady: boolean
}

/** Where the phone should open the preview: a one-time grant URL on the proxy port. */
export interface CompanionPreviewGrant {
  url: string
  expiresAt: string
}

export interface CompanionOverview {
  appVersion: string
  generatedAt: string
  tools: CompanionTool[]
  collections: Collection[]
  states: ToolRuntimeState[]
  health: ToolHealth[]
  board: MorningEvent[]
  keepAwakeActive: boolean
}

export interface CompanionPairRequest {
  code: string
  name?: string
}

export interface CompanionPairResponse {
  token: string
  device: PairedDeviceView
}

export type CompanionWsMessage =
  | { type: 'hello'; states: ToolRuntimeState[]; device: PairedDeviceView }
  | { type: 'process:update'; state: ToolRuntimeState }
  | { type: 'logs:line'; line: LogLine }
  | { type: 'receipts:update'; receipt: RunReceipt }
  | { type: 'library:changed' }

export type CompanionCollectionResult = CollectionActionResult
