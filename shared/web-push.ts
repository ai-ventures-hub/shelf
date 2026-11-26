/**
 * Web Push from the Mac to a paired phone, with node:crypto only.
 *
 * The phone's browser subscribes with its vendor's push service (Apple's for
 * an iPhone) and hands Shelf an endpoint URL plus two keys. To notify, Shelf
 * POSTs to that endpoint. That is an outbound internet request from the Mac,
 * so it happens only while the user has phone notifications turned on, and
 * the payload is encrypted for the phone alone (RFC 8291): the push service
 * relays bytes it cannot read. Requests are signed with a key pair made on
 * this Mac (VAPID, RFC 8292); there is no Shelf account or server involved.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import https from 'node:https'
import path from 'node:path'
import { atomicWriteFileSync } from './atomic-file'

export interface PushSubscriptionKeys {
  /** The phone's P-256 public key, base64url, uncompressed (65 bytes). */
  p256dh: string
  /** The phone's 16-byte auth secret, base64url. */
  auth: string
}

export interface PushSubscriptionInput {
  endpoint: string
  keys: PushSubscriptionKeys
}

export interface VapidKeys {
  /** base64url, uncompressed P-256 point: what the phone subscribes with. */
  publicKey: string
  /** base64url, 32-byte private scalar. Never leaves this Mac. */
  privateKey: string
}

export interface PushMessage {
  title: string
  body: string
  /** Where the phone app opens when the alert is tapped, e.g. "/#/tools/<id>". */
  url?: string
  /** Alerts with the same tag replace each other on the phone. */
  tag?: string
}

export type PushOutcome = 'sent' | 'gone' | 'failed'

/** Push services Shelf will talk to. A subscription pointing anywhere else is refused. */
const PUSH_HOSTS = ['web.push.apple.com', 'fcm.googleapis.com', 'updates.push.services.mozilla.com']
const PUSH_HOST_SUFFIXES = ['.push.apple.com', '.notify.windows.com']
/** Identifies the sender to the push service, as VAPID requires. */
const VAPID_SUBJECT = 'https://shelfmcp.com'
const RECORD_SIZE = 4096
const MAX_PLAINTEXT = 3000

const b64u = (data: Buffer | ArrayBuffer | Uint8Array) => Buffer.from(data as ArrayBuffer).toString('base64url')
const fromB64u = (text: string) => Buffer.from(text, 'base64url')

export function isAllowedPushEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint)
    if (url.protocol !== 'https:' || url.username || url.password) return false
    const host = url.hostname.toLowerCase()
    return PUSH_HOSTS.includes(host) || PUSH_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))
  } catch {
    return false
  }
}

/** A subscription as the phone sent it, checked; throws with the reason. */
export function parsePushSubscription(raw: unknown): PushSubscriptionInput {
  const value = raw as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } } | null
  const endpoint = typeof value?.endpoint === 'string' ? value.endpoint.trim() : ''
  const p256dh = typeof value?.keys?.p256dh === 'string' ? value.keys.p256dh : ''
  const auth = typeof value?.keys?.auth === 'string' ? value.keys.auth : ''
  if (!endpoint || endpoint.length > 2048 || !isAllowedPushEndpoint(endpoint)) {
    throw new Error('That is not a push service Shelf sends to.')
  }
  const point = fromB64u(p256dh)
  if (point.length !== 65 || point[0] !== 4) throw new Error('The subscription key is not valid.')
  if (fromB64u(auth).length !== 16) throw new Error('The subscription secret is not valid.')
  return { endpoint, keys: { p256dh: b64u(point), auth: b64u(fromB64u(auth)) } }
}

export function generateVapidKeys(): VapidKeys {
  const ecdh = crypto.createECDH('prime256v1')
  ecdh.generateKeys()
  return { publicKey: b64u(ecdh.getPublicKey()), privateKey: b64u(ecdh.getPrivateKey()) }
}

/** The Mac's signing keys, created on first use beside the Companion certificate (0600). */
export function ensureVapidKeys(companionDir: string): VapidKeys {
  const file = path.join(companionDir, 'vapid.json')
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<VapidKeys>
    if (typeof parsed.publicKey === 'string' && typeof parsed.privateKey === 'string'
      && fromB64u(parsed.publicKey).length === 65 && fromB64u(parsed.privateKey).length === 32) {
      return { publicKey: parsed.publicKey, privateKey: parsed.privateKey }
    }
  } catch {
    // Missing or unreadable: make a new pair. Phones subscribe again.
  }
  const keys = generateVapidKeys()
  fs.mkdirSync(companionDir, { recursive: true, mode: 0o700 })
  atomicWriteFileSync(file, JSON.stringify(keys, null, 2))
  return keys
}

/** RFC 8292 Authorization header for one push service origin. */
export function vapidAuthorization(endpoint: string, keys: VapidKeys, now = Date.now()): string {
  const publicPoint = fromB64u(keys.publicKey)
  const header = b64u(Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const claims = b64u(Buffer.from(JSON.stringify({
    aud: new URL(endpoint).origin,
    exp: Math.floor(now / 1000) + 12 * 60 * 60,
    sub: VAPID_SUBJECT,
  })))
  const key = crypto.createPrivateKey({
    format: 'jwk',
    key: {
      kty: 'EC',
      crv: 'P-256',
      d: keys.privateKey,
      x: b64u(publicPoint.subarray(1, 33)),
      y: b64u(publicPoint.subarray(33, 65)),
    },
  })
  const signature = crypto.sign('sha256', Buffer.from(`${header}.${claims}`), { key, dsaEncoding: 'ieee-p1363' })
  return `vapid t=${header}.${claims}.${b64u(signature)}, k=${keys.publicKey}`
}

/**
 * RFC 8291 message encryption (aes128gcm, one record). `fixed` pins the
 * sender key and salt so the published test vector can be reproduced.
 */
export function encryptPushPayload(
  subscription: PushSubscriptionInput,
  plaintext: Buffer,
  fixed?: { senderPrivateKey: Buffer; salt: Buffer },
): Buffer {
  if (plaintext.length > MAX_PLAINTEXT) throw new Error('The notification is too long.')
  const receiverPublic = fromB64u(subscription.keys.p256dh)
  const authSecret = fromB64u(subscription.keys.auth)
  const sender = crypto.createECDH('prime256v1')
  if (fixed) sender.setPrivateKey(fixed.senderPrivateKey)
  else sender.generateKeys()
  const senderPublic = sender.getPublicKey()
  const shared = sender.computeSecret(receiverPublic)
  const salt = fixed?.salt ?? crypto.randomBytes(16)

  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), receiverPublic, senderPublic])
  const ikm = Buffer.from(crypto.hkdfSync('sha256', shared, authSecret, keyInfo, 32))
  const contentKey = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16))
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12))

  const cipher = crypto.createCipheriv('aes-128-gcm', contentKey, nonce)
  // 0x02 marks the last (here the only) record.
  const sealed = Buffer.concat([cipher.update(Buffer.concat([plaintext, Buffer.from([2])])), cipher.final(), cipher.getAuthTag()])
  const recordSize = Buffer.alloc(4)
  recordSize.writeUInt32BE(RECORD_SIZE)
  return Buffer.concat([salt, recordSize, Buffer.from([senderPublic.length]), senderPublic, sealed])
}

/**
 * Send one alert. 'gone' means the phone unsubscribed (or reinstalled) and
 * the subscription should be dropped; 'failed' is worth trying again later.
 */
export function sendWebPush(
  subscription: PushSubscriptionInput,
  message: PushMessage,
  keys: VapidKeys,
  opts: { ttlSeconds?: number; urgent?: boolean } = {},
): Promise<PushOutcome> {
  if (!isAllowedPushEndpoint(subscription.endpoint)) return Promise.resolve('gone')
  let body: Buffer
  let authorization: string
  try {
    body = encryptPushPayload(subscription, Buffer.from(JSON.stringify(message)))
    authorization = vapidAuthorization(subscription.endpoint, keys)
  } catch {
    return Promise.resolve('gone')
  }
  return new Promise<PushOutcome>((resolve) => {
    const request = https.request(
      subscription.endpoint,
      {
        method: 'POST',
        timeout: 15_000,
        headers: {
          authorization,
          'content-encoding': 'aes128gcm',
          'content-type': 'application/octet-stream',
          'content-length': String(body.length),
          ttl: String(opts.ttlSeconds ?? 12 * 60 * 60),
          urgency: opts.urgent ? 'high' : 'normal',
        },
      },
      (response) => {
        response.resume()
        const status = response.statusCode || 0
        resolve(status >= 200 && status < 300 ? 'sent' : status === 404 || status === 410 ? 'gone' : 'failed')
      },
    )
    request.on('timeout', () => request.destroy())
    request.on('error', () => resolve('failed'))
    request.end(body)
  })
}
