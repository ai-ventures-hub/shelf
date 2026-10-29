/**
 * Companion (2.4) glue for the main process: owns the server's lifetime
 * against the preferences, the certificate, the keep-awake blocker, and the
 * status the Settings pane shows. The server itself (shared/companion-server)
 * knows nothing about Electron.
 */
import { app, dialog, powerSaveBlocker, type BrowserWindow } from 'electron'
import fs from 'node:fs'
import { buildActivityBoard } from '../shared/activity-board'
import type { CapabilityGapStore } from '../shared/capability-gap-store'
import { ensureCompanionCertificate, type CompanionCertificate } from '../shared/companion-cert'
import type { CompanionStatus, PairedDeviceView } from '../shared/companion-contracts'
import {
  listCompanionInterfaces,
  resolveBindAddress,
  validateCompanionPort,
} from '../shared/companion-net'
import { previewBlocker, PreviewProxy, toolUrlHost, type PreviewTarget } from '../shared/companion-preview'
import { CompanionServer, type CompanionHost } from '../shared/companion-server'
import { CompanionDeviceStore } from '../shared/companion-store'
import type { UiPrefs } from '../shared/contracts'
import type { DesignProfileStore } from '../shared/design-profile-store'
import { buildErrorReport, buildReceiptReport } from '../shared/launch-diagnostics'
import type { LibraryStore } from '../shared/library-store'
import type { PrefsStore } from '../shared/prefs-store'
import type { ProcessManager } from '../shared/process-manager'
import type { ReceiptStore } from '../shared/receipt-store'
import { startCollection, stopCollection } from '../shared/collection-launch'
import type { ToolDraftStore } from '../shared/tool-draft-store'
import { deriveLibraryHealth } from '../shared/tool-health'
import type { VerificationRunner } from '../shared/verification-runner'

export interface CompanionManagerDeps {
  prefs: PrefsStore
  store: LibraryStore
  processes: ProcessManager
  receipts: ReceiptStore
  verification: VerificationRunner
  capabilityGaps: CapabilityGapStore
  designProfiles: DesignProfileStore
  toolDrafts: ToolDraftStore
  sendToRenderer: (channel: string, ...args: unknown[]) => void
  dataRoot: string
  /** Built renderer output: `<staticRoot>/companion/index.html`, `<staticRoot>/assets`. */
  staticRoot: string
  iconPngPath: string
}

/** Release the power-save blocker this long after the last phone disconnects. */
const KEEP_AWAKE_GRACE_MS = 60_000

export function prefsPatchAffectsCompanion(patch: Partial<UiPrefs>): boolean {
  return (
    patch.companionEnabled !== undefined ||
    patch.companionBindAddress !== undefined ||
    patch.companionPort !== undefined ||
    patch.companionKeepAwake !== undefined
  )
}

export class CompanionManager {
  private server: CompanionServer | null = null
  /** Phase B: one listener per running tool with remotePreview on. */
  private preview: PreviewProxy | null = null
  private previewSync: Promise<void> = Promise.resolve()
  private previewErrors = new Map<string, string>()
  private readonly devices: CompanionDeviceStore
  private cert: CompanionCertificate | null = null
  private error: string | null = null
  private blockerId: number | null = null
  private releaseTimer: ReturnType<typeof setTimeout> | null = null
  private clientCount = 0
  /** Serializes start/stop so two quick pref flips cannot interleave. */
  private pending: Promise<void> = Promise.resolve()
  /** What the running server was started with, to know when a pref change needs a restart. */
  private running: { address: string; port: number } | null = null

  constructor(private readonly deps: CompanionManagerDeps) {
    this.devices = new CompanionDeviceStore(deps.dataRoot)
  }

  /** Bring the server in line with prefs.json. Safe to call on every prefs change. */
  applyPrefs(): Promise<void> {
    this.pending = this.pending.then(() => this.reconcile()).catch((err) => {
      this.error = err instanceof Error ? err.message : String(err)
      this.publish()
    })
    return this.pending
  }

  private async reconcile(): Promise<void> {
    const prefs = this.deps.prefs.get()
    if (!prefs.companionKeepAwake) this.releaseBlocker()
    if (!prefs.companionEnabled) {
      await this.stopServer()
      this.error = null
      this.publish()
      return
    }
    const interfaces = listCompanionInterfaces()
    const bind = resolveBindAddress(prefs.companionBindAddress, interfaces)
    const port = validateCompanionPort(prefs.companionPort)
    if (!bind.ok) {
      await this.stopServer()
      this.error = bind.reason
      this.publish()
      return
    }
    if (port === null) {
      await this.stopServer()
      this.error = 'Choose a port between 1024 and 65535.'
      this.publish()
      return
    }
    if (this.running && this.running.address === bind.address && this.running.port === port) {
      this.error = null
      this.publish()
      return
    }
    await this.stopServer()
    try {
      this.cert = this.cert || ensureCompanionCertificate(this.deps.dataRoot, interfaces.map((item) => item.address))
      const server = new CompanionServer({
        host: this.host(),
        devices: this.devices,
        tls: { key: this.cert.key, cert: this.cert.cert, fingerprint: this.cert.fingerprint },
        staticRoot: this.deps.staticRoot,
        iconPngPath: this.deps.iconPngPath,
        onClientsChanged: (count) => this.onClientsChanged(count),
        onDevicesChanged: () => this.publish(),
        log: (message) => console.log(`[shelf] ${message}`),
      })
      await server.listen(bind.address, port)
      this.server = server
      this.running = { address: bind.address, port }
      this.error = null
      this.preview = new PreviewProxy({
        bindAddress: bind.address,
        tls: { key: this.cert.key, cert: this.cert.cert },
        log: (message) => console.log(`[shelf] ${message}`),
      })
      this.syncPreviews()
    } catch (err) {
      this.server = null
      this.running = null
      const detail = err instanceof Error ? err.message : String(err)
      this.error = /EADDRINUSE/.test(detail)
        ? `Port ${port} is already in use on ${bind.address}. Choose another port.`
        : detail
    }
    this.publish()
  }

  private async stopServer(): Promise<void> {
    const server = this.server
    this.server = null
    this.running = null
    const preview = this.preview
    this.preview = null
    this.previewErrors.clear()
    if (preview) await preview.releaseAll()
    if (server) await server.close()
    this.onClientsChanged(0)
  }

  // ---- preview proxy (Phase B) ----------------------------------------------

  /**
   * Bring the preview listeners in line with the library and the process
   * table: one per tool that is running, has remotePreview on, and serves on
   * loopback. Called on every process transition and library change; the
   * work is serialized so a quick stop/start cannot interleave.
   */
  syncPreviews(): void {
    this.previewSync = this.previewSync.then(() => this.reconcilePreviews()).catch((err) => {
      console.error('[shelf] preview sync failed:', err)
    })
  }

  private async reconcilePreviews(): Promise<void> {
    const proxy = this.preview
    if (!proxy) return
    const states = new Map(this.deps.processes.peekStates().map((state) => [state.toolId, state]))
    const wanted = new Map<string, PreviewTarget>()
    for (const tool of this.deps.store.list()) {
      if (!tool.remotePreview || previewBlocker(tool)) continue
      const state = states.get(tool.id)
      if (state?.status !== 'running') continue
      const port = state.port ?? tool.port
      if (!port) continue
      const backend = (toolUrlHost(tool.url) && tool.url?.toLowerCase().startsWith('https:')) ? 'https' : 'http'
      wanted.set(tool.id, { toolId: tool.id, port, backend })
    }
    for (const toolId of proxy.activeToolIds()) {
      if (!wanted.has(toolId)) {
        await proxy.release(toolId)
        this.previewErrors.delete(toolId)
      }
    }
    for (const target of wanted.values()) {
      try {
        await proxy.ensure(target)
        this.previewErrors.delete(target.toolId)
      } catch (err) {
        this.previewErrors.set(target.toolId, err instanceof Error ? err.message : String(err))
      }
    }
  }

  async shutdown(): Promise<void> {
    await this.stopServer()
    this.releaseBlocker()
  }

  status(): CompanionStatus {
    const prefs = this.deps.prefs.get()
    const interfaces = listCompanionInterfaces()
    const listening = this.server?.listening || null
    return {
      enabled: prefs.companionEnabled,
      running: Boolean(listening),
      url: listening?.url || null,
      bindAddress: listening?.address || null,
      port: prefs.companionPort,
      interfaces,
      tailscaleDetected: interfaces.some((item) => item.tailscale),
      certFingerprint: this.cert?.fingerprintDisplay || null,
      keepAwakeActive: this.blockerId !== null,
      connectedClients: this.clientCount,
      error: this.error,
      devices: this.devices.list(),
      pairing: this.server?.pairingState() || null,
    }
  }

  beginPairing(): CompanionStatus {
    if (!this.server) throw new Error(this.error || 'Turn Companion on before pairing a device.')
    this.server.beginPairing()
    this.publish()
    return this.status()
  }

  cancelPairing(): CompanionStatus {
    this.server?.cancelPairing()
    this.publish()
    return this.status()
  }

  revokeDevice(id: string): CompanionStatus {
    this.devices.revoke(id)
    this.server?.dropClientsOf(id)
    this.preview?.revokeDevice(id)
    this.publish()
    return this.status()
  }

  renameDevice(id: string, name: string): CompanionStatus {
    this.devices.rename(id, name)
    this.publish()
    return this.status()
  }

  /** Save the certificate so the phone can install and trust it. */
  async exportCertificate(window: BrowserWindow | null): Promise<{ saved: boolean; path?: string }> {
    const cert = this.cert || ensureCompanionCertificate(
      this.deps.dataRoot,
      listCompanionInterfaces().map((item) => item.address),
    )
    this.cert = cert
    const options: Electron.SaveDialogOptions = {
      title: 'Save the Companion certificate',
      defaultPath: 'Shelf Companion.crt',
      filters: [{ name: 'Certificate', extensions: ['crt', 'pem'] }],
    }
    const result = window ? await dialog.showSaveDialog(window, options) : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return { saved: false }
    fs.writeFileSync(result.filePath, cert.cert, 'utf8')
    return { saved: true, path: result.filePath }
  }

  broadcast(channel: string, payload: unknown): void {
    this.server?.broadcast(channel, payload)
    // A tool starting or stopping is exactly when a preview listener comes or goes.
    if (channel === 'process:update' && this.preview) this.syncPreviews()
  }

  notifyLibraryChanged(): void {
    this.server?.notifyLibraryChanged()
    if (this.preview) this.syncPreviews()
  }

  private publish(): void {
    this.deps.sendToRenderer('companion:status', this.status())
  }

  // ---- keep awake -------------------------------------------------------

  private onClientsChanged(count: number): void {
    this.clientCount = count
    const wanted = this.deps.prefs.get().companionKeepAwake
    if (count > 0 && wanted) {
      if (this.releaseTimer) clearTimeout(this.releaseTimer)
      this.releaseTimer = null
      if (this.blockerId === null) this.blockerId = powerSaveBlocker.start('prevent-app-suspension')
    } else if (count === 0 && this.blockerId !== null && !this.releaseTimer) {
      this.releaseTimer = setTimeout(() => {
        this.releaseTimer = null
        if (this.clientCount === 0) this.releaseBlocker()
        this.publish()
      }, KEEP_AWAKE_GRACE_MS)
      this.releaseTimer.unref?.()
    }
    this.publish()
  }

  private releaseBlocker(): void {
    if (this.releaseTimer) clearTimeout(this.releaseTimer)
    this.releaseTimer = null
    if (this.blockerId !== null && powerSaveBlocker.isStarted(this.blockerId)) powerSaveBlocker.stop(this.blockerId)
    this.blockerId = null
  }

  // ---- what the server may do -------------------------------------------

  private host(): CompanionHost {
    const { store, processes, receipts, verification, capabilityGaps, designProfiles, toolDrafts } = this.deps
    const originFor = (device: PairedDeviceView) => ({
      origin: { kind: 'companion' as const, client: device.name },
      // The phone is elsewhere; opening the tool's URL on the Mac would surprise nobody usefully.
      openUrlWhenReady: false,
    })
    return {
      appVersion: app.getVersion(),
      listTools: () => store.list(),
      listCollections: () => store.listCollections(),
      getStates: () => processes.getStates(),
      peekStates: () => processes.peekStates(),
      health: async () => deriveLibraryHealth(store.list(), processes.peekStates()),
      board: () => buildActivityBoard({ store, verification, receipts, capabilityGaps, designProfiles, toolDrafts }),
      start: (toolId, device) => processes.start(toolId, originFor(device)),
      stop: (toolId) => processes.stop(toolId),
      restart: (toolId, device) => processes.restart(toolId, originFor(device)),
      logs: (toolId, runId) => processes.getLogs(toolId, runId),
      errorReport: async (toolId, runId) => {
        const tool = store.get(toolId)
        if (!tool) return null
        if (runId) {
          const receipt = receipts.get(runId)
          if (!receipt || receipt.toolId !== toolId) throw new Error('This run is no longer available for the selected tool.')
          return buildReceiptReport(tool, receipt, processes.getLogs(toolId, runId))
        }
        const state = await processes.getState(toolId)
        return buildErrorReport(tool, state, processes.getLogs(toolId))
      },
      receipts: (toolId) => receipts.list({ toolId, limit: 50 }),
      startCollection: (collectionId, device) => startCollection(collectionId, { store, processes }, originFor(device)),
      stopCollection: (collectionId) => stopCollection(collectionId, { store, processes }),
      keepAwakeActive: () => this.blockerId !== null,
      previewReady: (toolId) => Boolean(this.preview?.listening(toolId)),
      previewGrant: async (toolId, device) => {
        const tool = store.get(toolId)
        if (!tool) throw new Error('That tool is no longer in the library.')
        if (!tool.remotePreview) throw new Error('Remote preview is off for this tool. Turn it on in the tool editor on your Mac (Advanced).')
        const blocker = previewBlocker(tool)
        if (blocker) throw new Error(blocker)
        const state = processes.peekState(toolId)
        if (state.status !== 'running') throw new Error('Start the tool first; preview follows once it is running.')
        if (!this.preview) throw new Error('Companion is not running.')
        if (!this.preview.listening(toolId)) {
          // The listener may still be coming up after the start; give it one sync.
          this.syncPreviews()
          await this.previewSync
        }
        const failure = this.previewErrors.get(toolId)
        if (failure) throw new Error(failure)
        return this.preview.issueTicket(toolId, device.id)
      },
    }
  }
}
