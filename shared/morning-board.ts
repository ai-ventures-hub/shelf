import type { CapabilityGap, DesignProfile, LaunchOrigin, RunReceipt } from './types'

export type MorningKind = 'launch' | 'gap' | 'design' | 'verification' | 'client' | 'draft'

/** One row on the activity list. Derived. Nothing here is written back. */
export interface MorningEvent {
  id: string
  at: string
  kind: MorningKind
  title: string
  detail: string
  /** Normalized client, or "shelf" for GUI and tray launches. */
  client?: string
  toolId?: string
  href?: string
}

export interface MorningVerification {
  toolId: string
  toolName: string
  status: string
  at: string
  message?: string
}

export interface MorningDraft {
  id: string
  name: string
  at: string
  client?: string
}

export interface MorningClient {
  kind: string
  lastSeenAt: string
}

export interface MorningSources {
  receipts: RunReceipt[]
  gaps: CapabilityGap[]
  profiles: DesignProfile[]
  verifications: MorningVerification[]
  clients: MorningClient[]
  drafts: MorningDraft[]
}

const LIMIT = 80

/** Fold a self-reported MCP client name into the same buckets Shelf already records. */
export function normalizeClientName(name: string | undefined): string | undefined {
  if (!name) return undefined
  const normalized = name.toLowerCase()
  if (/codex/.test(normalized)) return 'codex'
  if (/cursor/.test(normalized)) return 'cursor'
  if (/claude.?code/.test(normalized)) return 'claude-code'
  if (/claude/.test(normalized)) return 'claude'
  return undefined
}

function clientFromOrigin(origin: LaunchOrigin | undefined): string | undefined {
  if (!origin) return undefined
  if (origin.kind === 'gui' || origin.kind === 'tray') return 'shelf'
  return normalizeClientName(origin.client) || 'mcp'
}

function push(events: MorningEvent[], event: MorningEvent | null) {
  if (!event || !Number.isFinite(Date.parse(event.at))) return
  events.push(event)
}

/**
 * Sort the evidence Shelf already stores. Launch commands are intentionally
 * not copied onto the row. A receipt can contain a masked command, and this
 * list is for scanning, not for re-running it.
 */
export function buildMorningBoard(sources: MorningSources): MorningEvent[] {
  const events: MorningEvent[] = []

  for (const receipt of sources.receipts) {
    const client = clientFromOrigin(receipt.startedBy)
    push(events, {
      id: `receipt:${receipt.id}`,
      at: receipt.startedAt,
      kind: 'launch',
      title: receipt.toolName,
      detail: client
        ? `${receipt.outcome} · ${client}`
        : receipt.outcome,
      client,
      toolId: receipt.toolId,
      href: `/tools/${receipt.toolId}/runs`,
    })
  }

  for (const gap of sources.gaps) {
    if (gap.status !== 'open' && gap.status !== 'planned') continue
    push(events, {
      id: `gap:${gap.id}`,
      at: gap.lastRequestedAt,
      kind: 'gap',
      title: gap.task,
      detail: gap.status === 'planned' ? 'Planned' : 'No tool matched',
      href: '/gaps',
    })
  }

  for (const profile of sources.profiles) {
    if (profile.origin !== 'agent') continue
    push(events, {
      id: `design:${profile.id}`,
      at: profile.updatedAt,
      kind: 'design',
      title: profile.name,
      detail: 'Agent draft, waiting for you to edit it',
      href: `/design/${profile.id}`,
    })
  }

  for (const run of sources.verifications) {
    if (run.status === 'passed' || run.status === 'pending' || run.status === 'running') continue
    push(events, {
      id: `verify:${run.toolId}:${run.at}:${run.status}`,
      at: run.at,
      kind: 'verification',
      title: run.toolName,
      detail: run.message ? `${run.status} · ${run.message}` : run.status,
      toolId: run.toolId,
      href: `/tools/${run.toolId}/verify`,
    })
  }

  for (const client of sources.clients) {
    push(events, {
      id: `client:${client.kind}`,
      at: client.lastSeenAt,
      kind: 'client',
      title: client.kind,
      detail: 'Last seen on the MCP connection',
      client: normalizeClientName(client.kind) || client.kind,
      href: '/mcp',
    })
  }

  for (const draft of sources.drafts) {
    const client = normalizeClientName(draft.client)
    push(events, {
      id: `draft:${draft.id}`,
      at: draft.at,
      kind: 'draft',
      title: draft.name,
      detail: client ? `${client} asked to register this` : 'Waiting for you to accept it',
      client,
      href: '/drafts',
    })
  }

  return events
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, LIMIT)
}
