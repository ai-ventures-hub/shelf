/**
 * The phone's side of the Companion protocol: the device token, JSON calls,
 * and the live WebSocket. The token lives in localStorage on the phone only.
 */
import {
  COMPANION_WS_PROTOCOL,
  type CompanionOverview,
  type CompanionPairResponse,
  type CompanionWsMessage,
} from '../shared/companion-contracts'
import type { CollectionActionResult, LogLine, RunReceipt, ToolRuntimeState } from '../shared/contracts'

const TOKEN_KEY = 'shelf-companion-token'
const DEVICE_KEY = 'shelf-companion-device'

export function getToken(): string | null {
  try { return localStorage.getItem(TOKEN_KEY) } catch { return null }
}

export function setPaired(result: CompanionPairResponse): void {
  try {
    localStorage.setItem(TOKEN_KEY, result.token)
    localStorage.setItem(DEVICE_KEY, JSON.stringify(result.device))
  } catch { /* private mode: the session still works until the tab closes */ }
}

export function clearPaired(): void {
  try {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(DEVICE_KEY)
  } catch { /* nothing to clear */ }
}

export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = getToken()
  const headers: Record<string, string> = { accept: 'application/json' }
  if (token) headers.authorization = `Bearer ${token}`
  if (body !== undefined) headers['content-type'] = 'application/json'
  const response = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  const text = await response.text()
  let parsed: unknown = null
  try { parsed = text ? JSON.parse(text) : null } catch { parsed = null }
  if (!response.ok) {
    const message = parsed && typeof parsed === 'object' && 'error' in parsed && typeof (parsed as { error: unknown }).error === 'string'
      ? (parsed as { error: string }).error
      : `Request failed (${response.status})`
    throw new ApiError(response.status, message)
  }
  return parsed as T
}

export const api = {
  pair: (code: string, name: string) => call<CompanionPairResponse>('POST', '/api/pair', { code, name }),
  unpair: () => call<{ ok: true }>('DELETE', '/api/me'),
  overview: () => call<CompanionOverview>('GET', '/api/overview'),
  logs: (toolId: string, runId?: string) =>
    call<LogLine[]>('GET', `/api/tools/${encodeURIComponent(toolId)}/logs${runId ? `?runId=${encodeURIComponent(runId)}` : ''}`),
  report: (toolId: string, runId?: string) =>
    call<{ report: string | null }>('GET', `/api/tools/${encodeURIComponent(toolId)}/report${runId ? `?runId=${encodeURIComponent(runId)}` : ''}`),
  receipts: (toolId: string) => call<RunReceipt[]>('GET', `/api/tools/${encodeURIComponent(toolId)}/receipts`),
  start: (toolId: string) => call<ToolRuntimeState>('POST', `/api/tools/${encodeURIComponent(toolId)}/start`),
  stop: (toolId: string) => call<ToolRuntimeState>('POST', `/api/tools/${encodeURIComponent(toolId)}/stop`),
  restart: (toolId: string) => call<ToolRuntimeState>('POST', `/api/tools/${encodeURIComponent(toolId)}/restart`),
  startCollection: (id: string) => call<CollectionActionResult>('POST', `/api/collections/${encodeURIComponent(id)}/start`),
  stopCollection: (id: string) => call<CollectionActionResult>('POST', `/api/collections/${encodeURIComponent(id)}/stop`),
}

/**
 * Live state stream with reconnects. The token travels as a second
 * subprotocol so it never appears in a URL.
 */
export function connectLive(onMessage: (message: CompanionWsMessage) => void, onState: (open: boolean) => void): () => void {
  let socket: WebSocket | null = null
  let closed = false
  let attempt = 0
  let timer: ReturnType<typeof setTimeout> | null = null

  const open = () => {
    const token = getToken()
    if (closed || !token) return
    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`
    const ws = new WebSocket(url, [COMPANION_WS_PROTOCOL, token])
    socket = ws
    ws.onopen = () => { attempt = 0; onState(true) }
    ws.onmessage = (event) => {
      try { onMessage(JSON.parse(String(event.data)) as CompanionWsMessage) } catch { /* ignore a bad frame */ }
    }
    ws.onclose = (event) => {
      onState(false)
      if (closed || event.code === 4001) return
      attempt += 1
      timer = setTimeout(open, Math.min(30_000, 1000 * 2 ** Math.min(attempt, 5)))
    }
    ws.onerror = () => { /* onclose follows */ }
  }
  open()
  return () => {
    closed = true
    if (timer) clearTimeout(timer)
    socket?.close()
  }
}
